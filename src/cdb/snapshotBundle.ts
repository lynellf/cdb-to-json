/**
 * Snapshot bundle acquisition for safe database reading.
 *
 * Reads source main, -wal, and -shm members through a bound SourceHandle,
 * copies them to a private staging directory, and verifies the captured
 * source identity after the copy is complete.
 *
 * All bytes are read through the handle's descriptors, not by path reopening.
 * A final identity verification ensures the source has not been mutated or
 * swapped after handle acquisition and before snapshot copy.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readSync, closeSync, fstatSync } from "node:fs";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { SourceHandle } from "./sourceHandle.js";

/**
 * Snapshot member information.
 */
export interface SnapshotMember {
  name: string;
  present: boolean;
  bytesBase64: string | null;
}

/**
 * Result of snapshot bundle acquisition.
 */
export interface SnapshotBundle {
  /** The temporary staging directory containing copies */
  stagingDir: string;
  /** Path to the copied main database */
  mainPath: string;
  /** Path to the copied -wal file (if present) */
  walPath: string | null;
  /** Path to the copied -shm file (if present) */
  shmPath: string | null;
  /** Canonical SHA-256 hash of the bundle */
  bundleHash: string;
  /** Total bytes of all present members (main + WAL + SHM) */
  totalBytes: number;
  /** Size of the original main source file in bytes */
  mainFileSize: number;
  /** Reference to the bound SourceHandle (remains open for identity recheck) */
  sourceHandle: SourceHandle;
}

const MAX_RETRIES = 3;

/**
 * Read exactly n bytes from a file descriptor at the given offset.
 */
function readExactly(fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = readSync(fd, buf, offset, size - offset, offset) as number;
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buf;
}

/**
 * Acquire a stable snapshot bundle of the source database through a bound handle.
 *
 * 1. Read all present source members (main, -wal, -shm) through the SourceHandle's
 *    descriptors. Bytes are captured from the open descriptors, not by path reopening.
 * 2. Copy all present members to a private staging directory.
 * 3. Re-check WAL/SHM member size stability (they may change during the read window).
 * 4. Retry bounded times if source mutates during acquisition.
 * 5. Verify the captured source main identity matches the current on-disk state.
 * 6. Compute the canonical bundle hash.
 *
 * The SourceHandle is retained in the returned bundle for final identity recheck
 * after snapshot is fully consumed. The caller is responsible for closing the
 * handle's main/parent descriptors after all reader activity is complete.
 *
 * @param sourcePathOrHandle - Either a SourceHandle (preferred) or a source path string
 *                             (backward-compatible, creates transient handle internally).
 * @param stagingRoot - Root directory for staging output, or null for system tmpdir.
 * @param maxSnapshotBytes - Optional maximum bundle size in bytes.
 * @param diagnostics - Optional diagnostic collector.
 */
export async function acquireSnapshotBundle(
  sourcePathOrHandle: string | SourceHandle,
  stagingRoot: string | null,
  maxSnapshotBytes?: number,
  diagnostics?: DiagnosticCollector
): Promise<SnapshotBundle> {
  if (typeof sourcePathOrHandle === "string") {
    // Backward-compatible path-based call (for quarantined callers).
    // Creates a transient SourceHandle and closes it after acquisition.
    const { acquireSourceHandle } = await import("./sourceHandle.js");
    const handle = acquireSourceHandle(sourcePathOrHandle, { diagnostics });
    try {
      return await acquireSnapshotBundleImpl(handle, stagingRoot, maxSnapshotBytes, diagnostics);
    } finally {
      // For backward compatibility, close the transient handle.
      // The proper SourceHandle lifecycle keeps the handle open through the
      // publication barrier and closes it in the application's finally block.
      handle.close();
    }
  }
  return await acquireSnapshotBundleImpl(sourcePathOrHandle, stagingRoot, maxSnapshotBytes, diagnostics);
}

/**
 * Internal implementation of acquireSnapshotBundle.
 */
async function acquireSnapshotBundleImpl(
  sourceHandle: SourceHandle,
  stagingRoot: string | null,
  maxSnapshotBytes: number | undefined,
  diagnostics: DiagnosticCollector | undefined
): Promise<SnapshotBundle> {
  const stagingDir = join(
    stagingRoot ?? tmpdir(),
    `cdb-snapshot-${randomUUID()}`
  );

  try {
    await mkdir(stagingDir, { recursive: true });
  } catch {
    throw new Error(`Failed to create snapshot staging directory: ${stagingDir}`);
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    type MemberEntry = {
      name: string;
      fd: number | null;
      present: boolean;
      bytes: Buffer | null;
      size: number;
    };
    const members: MemberEntry[] = [];
    let totalBytes = 0;

    try {
      // Read main through the handle's fd (already open)
      const mainStats = fstatSync(sourceHandle.mainFd);
      const mainSize = typeof mainStats.size === "bigint" ? Number(mainStats.size) : mainStats.size;
      const mainBytes = readExactly(sourceHandle.mainFd, mainSize);
      members.push({
        name: "main",
        fd: sourceHandle.mainFd,
        present: true,
        bytes: mainBytes,
        size: mainSize,
      });
      totalBytes += mainBytes.length;

      // Open WAL through handle
      const walResult = await sourceHandle.openMember("-wal");
      if (walResult !== null) {
        const { fd: walFd, stat: walStats } = walResult;
        const walSize = typeof walStats.size === "bigint" ? Number(walStats.size) : walStats.size;
        const walBytes = readExactly(walFd, walSize);
        members.push({
          name: "-wal",
          fd: walFd,
          present: true,
          bytes: walBytes,
          size: walSize,
        });
        totalBytes += walBytes.length;
      } else {
        members.push({ name: "-wal", fd: null, present: false, bytes: null, size: 0 });
      }

      // Open SHM through handle
      const shmResult = await sourceHandle.openMember("-shm");
      if (shmResult !== null) {
        const { fd: shmFd, stat: shmStats } = shmResult;
        const shmSize = typeof shmStats.size === "bigint" ? Number(shmStats.size) : shmStats.size;
        const shmBytes = readExactly(shmFd, shmSize);
        members.push({
          name: "-shm",
          fd: shmFd,
          present: true,
          bytes: shmBytes,
          size: shmSize,
        });
        totalBytes += shmBytes.length;
      } else {
        members.push({ name: "-shm", fd: null, present: false, bytes: null, size: 0 });
      }
    } catch (error) {
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to read source members through handle: ${error instanceof Error ? error.message : String(error)}`
      );
      for (const m of members) {
        if (m.fd !== null && m.name !== "main") {
          try { closeSync(m.fd); } catch { /* best effort */ }
        }
      }
      await rmStagingDir(stagingDir);
      throw error;
    }

    if (maxSnapshotBytes !== undefined && totalBytes > maxSnapshotBytes) {
      for (const m of members) {
        if (m.fd !== null && m.name !== "main") {
          try { closeSync(m.fd); } catch { /* best effort */ }
        }
      }
      diagnostics?.error(
        DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
        `Snapshot bundle size (${totalBytes}) exceeds maxSnapshotBytes (${maxSnapshotBytes})`,
        { details: { limitCode: "MAX_SNAPSHOT_EXCEEDED", totalBytes, maxSnapshotBytes } }
      );
      await rmStagingDir(stagingDir);
      throw new Error(
        `Snapshot bundle size (${totalBytes} bytes) exceeds maxSnapshotBytes (${maxSnapshotBytes} bytes)`
      );
    }

    // Verify source stability by re-stating WAL/SHM member sizes.
    let stable = true;
    for (const member of members) {
      if (!member.present || member.fd === null) continue;
      if (member.name !== "main") {
        try {
          const newStats = fstatSync(member.fd);
          if (newStats.size !== member.size) {
            stable = false;
            break;
          }
        } catch {
          stable = false;
          break;
        }
      }
    }

    if (!stable && attempt < MAX_RETRIES - 1) {
      for (const m of members) {
        if (m.fd !== null && m.name !== "main") {
          try { closeSync(m.fd); } catch { /* best effort */ }
        }
      }
      continue;
    }

    if (!stable) {
      for (const m of members) {
        if (m.fd !== null && m.name !== "main") {
          try { closeSync(m.fd); } catch { /* best effort */ }
        }
      }
      diagnostics?.error(
        DiagnosticCode.SOURCE_MUTATED_DURING_READ,
        `Source database members changed during snapshot acquisition after ${MAX_RETRIES} retries`,
        { source: { database: sourceHandle.sourcePath } }
      );
      await rmStagingDir(stagingDir);
      throw new Error(`Source mutated during snapshot acquisition: ${sourceHandle.sourcePath}`);
    }

    // Close WAL/SHM descriptors after successful read and stability check.
    // The main fd is owned by the SourceHandle and is not closed here.
    for (const m of members) {
      if (m.fd !== null && m.name !== "main") {
        try { closeSync(m.fd); } catch { /* best effort */ }
      }
    }

    // Write captured bytes to the staging directory.
    const mainPath = join(stagingDir, "main.db");
    let walPath: string | null = null;
    let shmPath: string | null = null;

    const { writeFile } = await import("node:fs/promises");
    for (const member of members) {
      if (!member.present || !member.bytes) continue;

      const destPath = join(stagingDir, `${member.name === "main" ? "main.db" : member.name}`);
      try {
        await writeFile(destPath, member.bytes);
      } catch (error) {
        diagnostics?.error(
          DiagnosticCode.CDB_OPEN_FAILED,
          `Failed to write snapshot member: ${error instanceof Error ? error.message : String(error)}`
        );
        await rmStagingDir(stagingDir);
        throw error;
      }

      if (member.name === "main") {
        // mainPath already set above
      } else if (member.name === "-wal") {
        walPath = destPath;
      } else if (member.name === "-shm") {
        shmPath = destPath;
      }
    }

    // Compute the canonical bundle hash from the captured bytes.
    const bundleMembers: SnapshotMember[] = [];
    for (const member of members) {
      bundleMembers.push({
        name: member.name,
        present: member.present,
        bytesBase64: member.bytes ? member.bytes.toString("base64") : null,
      });
    }

    const canonicalJson = JSON.stringify(bundleMembers);
    const bundleHash = createHash("sha256").update(canonicalJson, "utf-8").digest("hex");
    const mainMember = members.find((m) => m.name === "main");
    const mainFileSize = mainMember?.bytes?.length ?? 0;

    // CRITICAL: Verify the source identity AFTER capturing bytes.
    await sourceHandle.verifyMainIdentity(diagnostics);

    return {
      stagingDir,
      mainPath,
      walPath,
      shmPath,
      bundleHash,
      totalBytes,
      mainFileSize,
      sourceHandle,
    };
  }

  await rmStagingDir(stagingDir);
  throw new Error("Failed to acquire snapshot bundle");
}

/**
 * Remove staging directory and any contents.
 */
async function rmStagingDir(dir: string): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
