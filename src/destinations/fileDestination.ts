/**
 * Descriptor-relative atomic file destination.
 *
 * This is the modern publication boundary. It owns a visible lock and
 * named temporary sibling, writes only through descriptors bound to the held
 * parent directory, and publishes with renameat2.
 *
 * Force replacement (--force) backs up the existing final before replacing it,
 * using the same descriptor-relative atomic publication path.
 */

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  atomicRenameDescriptor,
  atomicRenameReplace,
  openRelativeDescriptor,
  unlinkRelativeDescriptor,
} from "./nativeAdapter.js";
import { splitAbsolutePath } from "./pathUtils.js";
import type { Writer } from "../application/convertCatalog.js";

const O_CLOEXEC = 0x80000; // Linux O_CLOEXEC; Node typings omit it.
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC;
const TEMP_FLAGS =
  constants.O_RDWR |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW |
  O_CLOEXEC;

export class FileDestinationError extends Error {
  readonly code:
    | "OUTPUT_EXISTS"
    | "OUTPUT_DIRECTORY_EXISTS"
    | "OUTPUT_WRITE_FAILED"
    | "OUTPUT_RECOVERY_REQUIRED"
    | "UNSAFE_DESTINATION_FILESYSTEM";

  constructor(
    code: FileDestinationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FileDestinationError";
    this.code = code;
  }
}

function recoveryError(message: string): FileDestinationError {
  return new FileDestinationError(
    "OUTPUT_RECOVERY_REQUIRED",
    message,
  );
}

interface NativeResult {
  success: boolean;
  errcode: number;
  error_msg: string;
}

interface DescriptorIdentity {
  device: number;
  inode: number;
  size: number;
  digest: string;
}

function validateLeaf(leaf: string): void {
  if (
    leaf.length === 0 ||
    leaf === "." ||
    leaf === ".." ||
    leaf.includes("\0") ||
    leaf.includes("/") ||
    leaf.includes("\\")
  ) {
    throw new FileDestinationError("OUTPUT_WRITE_FAILED", `Invalid output leaf: ${leaf}`);
  }
}

function nativeError(result: NativeResult, context: string): FileDestinationError {
  const code = result.errcode === 17 ? "OUTPUT_EXISTS" : "OUTPUT_WRITE_FAILED";
  return new FileDestinationError(
    code,
    `${context}: ${result.error_msg || "native operation failed"} (${result.errcode})`,
  );
}


/** Open an existing directory tree through held no-follow descriptors. */
export function openDirectoryTree(directoryPath: string): number {
  const absolute = resolve(directoryPath);
  const components = absolute.split("/").filter((component) => component.length > 0);
  let currentFd = openSync("/", DIRECTORY_FLAGS);

  try {
    for (const component of components) {
      validateLeaf(component);
      const opened = openRelativeDescriptor(currentFd, component, DIRECTORY_FLAGS);
      if (!opened.success) {
        throw nativeError(opened, `open output directory component ${component}`);
      }
      const nextFd = opened.fd;
      closeSync(currentFd);
      currentFd = nextFd;
    }
    return currentFd;
  } catch (error) {
    try {
      closeSync(currentFd);
    } catch {
      // Best effort cleanup.
    }
    throw error;
  }
}

function hashDescriptor(fd: number, size: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(size, 1)));
  let offset = 0;
  while (offset < size) {
    const requested = Math.min(buffer.length, size - offset);
    const bytesRead = readSync(fd, buffer, 0, requested, offset) as number;
    if (bytesRead === 0) throw new Error("Unexpected end of output descriptor");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest("hex");
}

function captureIdentity(fd: number): DescriptorIdentity {
  const stats = fstatSync(fd);
  if (!stats.isFile()) throw new Error("Output is not a regular file");
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    digest: hashDescriptor(fd, stats.size),
  };
}

function sameIdentity(left: DescriptorIdentity, right: DescriptorIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.digest === right.digest
  );
}

function inspectFinal(parentFd: number, leaf: string): DescriptorIdentity | null {
  const opened = openRelativeDescriptor(parentFd, leaf, READ_FLAGS);
  if (!opened.success) {
    if (opened.errcode === 2) return null;
    throw nativeError(opened, `inspect output final ${leaf}`);
  }
  try {
    return captureIdentity(opened.fd);
  } finally {
    closeSync(opened.fd);
  }
}

function removeRelative(parentFd: number, leaf: string): void {
  const result = unlinkRelativeDescriptor(parentFd, leaf);
  if (!result.success && result.errcode !== 2) {
    throw nativeError(result, `remove output private leaf ${leaf}`);
  }
}

function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fd, content, offset, content.length - offset, null);
    if (written === 0) throw new Error("Output descriptor made no progress");
    offset += written;
  }
}

export interface AtomicFileDestination extends Writer {
  /** Publish the staged sibling, or throw while preserving the old final. */
  commit(): void;
  /** Remove private state without publishing. */
  abort(): void;
}

/**
 * Create a secure atomic file writer. Parent directories must already exist;
 * every component is opened with the native no-symlink descriptor boundary.
 *
 * When force=true, backs up the existing final before replacing it.
 */
export function createAtomicFileDestination(
  outputPath: string,
  options: { force?: boolean } = {},
): AtomicFileDestination {
  const force = options.force ?? false;

  const { parentPath, leaf } = splitAbsolutePath(outputPath);
  let parentFd: number | null = null;
  let lockFd: number | null = null;
  let tempFd: number | null = null;
  let tempExists = false;
  let finished = false;
  let priorFinal: DescriptorIdentity | null = null;
  let backupLeaf: string | null = null;
  const tempLeaf = `.cdb-to-json-${randomUUID()}.tmp`;
  const lockLeaf = `.cdb-to-json-${leaf}.lock`;

  try {
    parentFd = openDirectoryTree(parentPath);

    const lock = openRelativeDescriptor(parentFd, lockLeaf, TEMP_FLAGS, 0o600);
    if (!lock.success) throw nativeError(lock, "acquire output lock");
    lockFd = lock.fd;
    writeAll(lockFd, Buffer.from(JSON.stringify({ owner: randomUUID() }), "utf8"));
    fsyncSync(lockFd);

    // Capture existing final if present (for force replacement or rollback)
    priorFinal = inspectFinal(parentFd, leaf);

    if (priorFinal !== null && !force) {
      throw new FileDestinationError(
        "OUTPUT_EXISTS",
        `Output file already exists: ${outputPath}`,
      );
    }

    // If force mode and prior exists, create a backup
    if (priorFinal !== null && force) {
      const backupId = randomUUID().replace(/-/g, "").slice(0, 16);
      backupLeaf = `.cdb-to-json-${backupId}.bak`;

      // Copy the existing final to a backup file
      const backupResult = openRelativeDescriptor(parentFd, backupLeaf, TEMP_FLAGS, 0o600);
      if (!backupResult.success) throw nativeError(backupResult, "create backup file");
      let backupFd: number = backupResult.fd;

      // Copy content from existing final to backup
      const srcFd = openRelativeDescriptor(parentFd, leaf, READ_FLAGS);
      if (!srcFd.success) throw nativeError(srcFd, "open existing final for backup");
      try {
        const size = priorFinal.size;
        const bufSize = Math.min(1024 * 1024, Math.max(size, 1));
        const buf = Buffer.allocUnsafe(bufSize);
        let offset = 0;
        while (offset < size) {
          const chunk = Math.min(bufSize, size - offset);
          const read = readSync(srcFd.fd, buf, 0, chunk, offset) as number;
          if (read === 0) break;
          const written = writeSync(backupFd, buf, 0, read, null);
          if (written === 0) throw new Error("Backup write made no progress");
          offset += read;
        }
        fsyncSync(backupFd);
      } finally {
        closeSync(srcFd.fd);
      }
      closeSync(backupFd);
    }

    const temp = openRelativeDescriptor(parentFd, tempLeaf, TEMP_FLAGS, 0o600);
    if (!temp.success) throw nativeError(temp, "create output temporary");
    tempFd = temp.fd;
    tempExists = true;

    const writer: AtomicFileDestination = {
      write(data: string): void {
        if (finished || tempFd === null) {
          throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Output writer is closed");
        }
        writeAll(tempFd, Buffer.from(data, "utf8"));
      },

      commit(): void {
        if (finished) return;
        if (parentFd === null || tempFd === null) {
          throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Output writer is unavailable");
        }

        try {
          fsyncSync(tempFd);
          const staged = captureIdentity(tempFd);
          closeSync(tempFd);
          tempFd = null;

          // Use atomicRenameReplace for force mode (flags=0), atomicRenameDescriptor for no-force (RENAME_NOREPLACE)
          const published = force
            ? atomicRenameReplace(parentFd, tempLeaf, parentFd, leaf)
            : atomicRenameDescriptor(parentFd, tempLeaf, parentFd, leaf);
          if (!published.success) throw nativeError(published, "publish output final");
          tempExists = false;
          fsyncSync(parentFd);

          const committed = inspectFinal(parentFd, leaf);
          if (committed === null || !sameIdentity(staged, committed)) {
            throw new FileDestinationError(
              "OUTPUT_WRITE_FAILED",
              "Published output identity did not match staged bytes",
            );
          }

          finished = true;

          // Success: remove the backup if force mode was used
          // Do this before closing parentFd
          if (backupLeaf !== null) {
            try { removeRelative(parentFd, backupLeaf); } catch { /* best effort */ }
            backupLeaf = null;
          }
        } catch (error) {
          // On failure with force mode, attempt to restore from backup
          if (force && backupLeaf !== null && priorFinal !== null) {
            try {
              const restored = atomicRenameDescriptor(parentFd, backupLeaf, parentFd, leaf);
              if (!restored.success) {
                throw recoveryError(
                  `Publication failed and backup restoration also failed: ${restored.error_msg}`,
                );
              }
              fsyncSync(parentFd);
              // Verify restored identity matches prior
              const verified = inspectFinal(parentFd, leaf);
              if (verified === null || !sameIdentity(priorFinal, verified)) {
                throw recoveryError("Backup restoration produced identity mismatch");
              }
              // Clean up the backup after successful restore
              try { removeRelative(parentFd, backupLeaf); } catch { /* best effort */ }
              backupLeaf = null;
            } catch (restoreError) {
              if (restoreError instanceof FileDestinationError) {
                throw restoreError;
              }
              throw recoveryError(
                `Publication failed and backup restoration threw: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
              );
            }
          }
          throw error instanceof FileDestinationError
            ? error
            : new FileDestinationError(
              "OUTPUT_WRITE_FAILED",
              error instanceof Error ? error.message : String(error),
            );
        } finally {
          if (finished) {
            try {
              removeRelative(parentFd!, lockLeaf);
            } catch {
              // Lock cleanup is best effort after a committed final.
            }
            try {
              fsyncSync(parentFd!);
            } catch {
              // Best effort directory durability.
            }
            try {
              closeSync(parentFd!);
            } catch {
              // Best effort cleanup.
            }
            parentFd = null;
            if (lockFd !== null) {
              try { closeSync(lockFd); } catch { /* best effort */ }
              lockFd = null;
            }
          }
        }
      },

      abort(): void {
        if (finished) return;
        finished = true;
        if (tempFd !== null) {
          try { closeSync(tempFd); } catch { /* best effort */ }
          tempFd = null;
        }
        if (parentFd !== null) {
          if (tempExists) {
            try { removeRelative(parentFd, tempLeaf); } catch { /* best effort */ }
          }
          try { removeRelative(parentFd, lockLeaf); } catch { /* best effort */ }
          // Note: do NOT remove backup on abort - user may want to recover
          try { closeSync(parentFd); } catch { /* best effort */ }
          parentFd = null;
        }
        if (lockFd !== null) {
          try { closeSync(lockFd); } catch { /* best effort */ }
          lockFd = null;
        }
      },
    };

    return writer;
  } catch (error) {
    if (tempFd !== null) {
      try { closeSync(tempFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      try { removeRelative(parentFd, tempLeaf); } catch { /* best effort */ }
      try { removeRelative(parentFd, lockLeaf); } catch { /* best effort */ }
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
    if (lockFd !== null) {
      try { closeSync(lockFd); } catch { /* best effort */ }
    }
    throw error;
  }
}
