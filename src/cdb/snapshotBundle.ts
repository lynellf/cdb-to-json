/**
 * Snapshot bundle acquisition for safe database reading.
 *
 * Captures main, -wal, and -shm members before opening SQLite.
 * Produces a private copy bundle and a deterministic hash.
 */

import { copyFile, mkdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

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
}

const MAX_RETRIES = 3;
const MEMBER_NAMES = ["main", "-wal", "-shm"] as const;

/**
 * Get the path for a database sidecar file.
 */
function getSidecarPath(mainPath: string, suffix: string): string {
  if (suffix === "main") return mainPath;
  return mainPath + suffix;
}

/**
 * Determine if a filename has a .cdb extension (case-insensitive, exact final extension).
 */
/**
 * Acquire a stable snapshot bundle of the source database.
 *
 * 1. Stat the main file and detect present -wal/-shm sidecars.
 * 2. Copy all present members to a private staging directory.
 * 3. Re-check source member identities (size, mtime) for stability.
 * 4. Retry bounded times if source mutates during acquisition.
 * 5. Compute the canonical bundle hash.
 */
export async function acquireSnapshotBundle(
  sourcePath: string,
  stagingRoot: string | null,
  maxSnapshotBytes?: number,
  diagnostics?: DiagnosticCollector
): Promise<SnapshotBundle> {
  // Create a unique staging directory
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
    // Capture member identities
    const members: {
      name: string;
      path: string;
      present: boolean;
      bytes: Buffer | null;
      size: number;
    }[] = [];

    let totalBytes = 0;

    try {
      for (const name of MEMBER_NAMES) {
        const memberPath = getSidecarPath(sourcePath, name);
        const memberStats = await lstat(memberPath).catch(() => null);

        if (memberStats?.isFile()) {
          const bytes = await readFile(memberPath);
          members.push({
            name,
            path: memberPath,
            present: true,
            bytes,
            size: memberStats.size,
          });
          totalBytes += bytes.length;
        } else {
          members.push({
            name,
            path: memberPath,
            present: false,
            bytes: null,
            size: 0,
          });
        }
      }
    } catch (error) {
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to read source members: ${error instanceof Error ? error.message : String(error)}`
      );
      // Clean up staging directory
      await rmStagingDir(stagingDir);
      throw error;
    }

    // Check snapshot byte budget
    if (maxSnapshotBytes !== undefined && totalBytes > maxSnapshotBytes) {
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

    // Verify source stability by re-stating members
    let stable = true;
    for (const member of members) {
      if (!member.present) continue;
      try {
        const newStats = await lstat(member.path);
        if (newStats.size !== member.size) {
          stable = false;
          break;
        }
      } catch {
        if (member.present) {
          // File disappeared — mutation detected
          stable = false;
          break;
        }
      }
    }

    if (!stable && attempt < MAX_RETRIES - 1) {
      // Source mutated; retry
      continue;
    }

    if (!stable) {
      diagnostics?.error(
        DiagnosticCode.SOURCE_MUTATED_DURING_READ,
        `Source database members changed during snapshot acquisition after ${MAX_RETRIES} retries`,
        { details: { sourcePath } }
      );
      await rmStagingDir(stagingDir);
      throw new Error(`Source mutated during snapshot acquisition: ${sourcePath}`);
    }

    // Copy present members to staging directory
    const mainPath = join(stagingDir, "main.db");
    let walPath: string | null = null;
    let shmPath: string | null = null;

    for (const member of members) {
      if (!member.present || !member.bytes) continue;

      const destPath = join(stagingDir, `${member.name === "main" ? "main.db" : member.name}`);
      try {
        await copyFile(member.path, destPath);
      } catch (error) {
        diagnostics?.error(
          DiagnosticCode.CDB_OPEN_FAILED,
          `Failed to copy source member: ${error instanceof Error ? error.message : String(error)}`
        );
        await rmStagingDir(stagingDir);
        throw error;
      }

      if (member.name === "main") {
        // Already set
      } else if (member.name === "-wal") {
        walPath = destPath;
      } else if (member.name === "-shm") {
        shmPath = destPath;
      }
    }

    // Compute the canonical bundle hash
    const bundleMembers: SnapshotMember[] = [];
    for (const member of members) {
      bundleMembers.push({
        name: member.name,
        present: member.present,
        bytesBase64: member.bytes ? member.bytes.toString("base64") : null,
      });
    }

    // Sorted keys: array order is fixed by MEMBER_NAMES
    const canonicalJson = JSON.stringify(bundleMembers);
    const bundleHash = createHash("sha256").update(canonicalJson, "utf-8").digest("hex");

    // Capture the original main file size separately from the bundle total.
    // This preserves the provenance contract: sha256 covers the bundle
    // (main+WAL+SHM) while sizeBytes always reflects the original .cdb.
    const mainMember = members.find((m) => m.name === "main");
    const mainFileSize = mainMember?.size ?? 0;

    return {
      stagingDir,
      mainPath,
      walPath,
      shmPath,
      bundleHash,
      totalBytes,
      mainFileSize,
    };
  }

  // Should not reach here
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