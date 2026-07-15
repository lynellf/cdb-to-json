/**
 * Opaque source handle for verified database access.
 *
 * Captures the source main-file descriptor identity once at acquisition time.
 * After that boundary, all bytes are read through the held descriptor, not by
 * path reopening. WAL and SHM members are opened through the same parent
 * descriptor, and their bytes are verified against the captured identity.
 *
 * The handle must remain open until the publication transaction has completed
 * its final identity recheck and commit barrier. At that point it is closed in
 * `finally`.
 *
 * This module is intentionally separated from snapshotBundle so that the handle
 * can be threaded through the application layer independently of the snapshot
 * copy lifecycle.
 */

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { openRelativeDescriptor } from "../destinations/nativeAdapter.js";

const SOURCE_DIRECTORY_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | 0x80000; // Linux O_CLOEXEC
const SOURCE_FILE_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | 0x80000; // Linux O_CLOEXEC
const SOURCE_HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Identity of a regular file, captured at acquisition time.
 * Used to verify the source has not been mutated or swapped.
 */
export interface FileIdentity {
  device: number;
  inode: number;
  type: string;
  size: number;
}

/**
 * Result of opening a source database for reading.
 * Contains the opened descriptor, captured identity, and parent handle.
 *
 * The source parent descriptor and main descriptor are held open until
 * `close()` is called.
 */
export interface SourceHandle {
  /**
   * The original source path provided at acquisition.
   * This is stored for provenance/debugging only; all I/O goes through
   * the held descriptors.
   */
  readonly sourcePath: string;

  /**
   * Captured identity of the main source file, verified at acquisition.
   */
  readonly mainIdentity: FileIdentity;

  /** SHA-256 captured from the held main descriptor at acquisition. */
  readonly mainDigest: string;

  /**
   * Open file descriptor for the source main file.
   * Owned by this handle; close via `close()`.
   */
  readonly mainFd: number;

  /**
   * Open file descriptor for the source parent directory.
   * Owned by this handle; close via `close()`.
   */
  readonly parentFd: number;

  /**
   * Validated leaf name of the main file (single component, no special chars).
   * Used to open WAL/SHM members via the parent descriptor.
   */
  readonly mainLeaf: string;

  /**
   * Open a member file (e.g., -wal, -shm) via the parent descriptor.
   * Returns { fd, stat } if the member exists and is a regular file.
   * Returns null if the member does not exist.
   * Throws if the member exists but is not a regular file.
   */
  openMember(memberSuffix: "-wal" | "-shm"): Promise<{
    fd: number;
    stat: Awaited<ReturnType<typeof fstatSync>>;
    digest: string;
  } | null>;

  /**
   * Verify that the current on-disk identity of the main file matches the
   * captured identity. Throws SourceMutatedError if they differ.
   */
  verifyMainIdentity(diagnostics?: DiagnosticCollector): Promise<void>;

  /**
   * Close the main and parent file descriptors.
   * Idempotent: subsequent calls are no-ops.
   */
  close(): Promise<void>;
}

/**
 * Error thrown when source identity verification fails.
 */
export class SourceMutatedError extends Error {
  readonly code = DiagnosticCode.SOURCE_MUTATED_DURING_READ;
  constructor(message: string) {
    super(message);
    this.name = "SourceMutatedError";
  }
}

/**
 * Options for acquiring a source handle.
 */
export interface AcquireSourceOptions {
  /**
   * If true, follow symlinks when opening the source file.
   * Default is false (no-follow, symlinks are rejected).
   */
  followSymlinks?: boolean;

  /**
   * Optional diagnostic collector for error reporting.
   */
  diagnostics?: DiagnosticCollector;
}

/**
 * Validate that a leaf name is a safe single component.
 * A safe leaf contains no NUL, '/', '\\', is not '.' or '..', and is not empty.
 */
function validateLeaf(leaf: string, context: string): void {
  if (!leaf || leaf.length === 0) {
    throw new Error(`${context}: leaf name is empty`);
  }
  if (leaf.includes("\0")) {
    throw new Error(`${context}: leaf name contains NUL byte`);
  }
  if (leaf.includes("/") || leaf.includes("\\")) {
    throw new Error(`${context}: leaf name contains path separator`);
  }
  if (leaf === "." || leaf === "..") {
    throw new Error(`${context}: leaf name is '.' or '..'`);
  }
}

function hashDescriptor(fd: number, size: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(SOURCE_HASH_CHUNK_BYTES, Math.max(size, 1)));
  let offset = 0;

  while (offset < size) {
    const requested = Math.min(chunk.length, size - offset);
    const bytesRead = readSync(fd, chunk, 0, requested, offset) as number;
    if (bytesRead === 0) {
      throw new Error(`Unexpected end of source descriptor at byte ${offset}`);
    }
    hash.update(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }

  return hash.digest("hex");
}

function openRelativeOrThrow(
  parentFd: number,
  leaf: string,
  flags: number,
  context: string,
): number {
  const result = openRelativeDescriptor(parentFd, leaf, flags);
  if (!result.success) {
    const error = new Error(
      `${context}: ${result.error_msg || "descriptor-relative open failed"} (${result.errcode})`,
    ) as NodeJS.ErrnoException;
    if (result.errcode === 2) error.code = "ENOENT";
    if (result.errcode === 20) error.code = "ENOTDIR";
    if (result.errcode === 40) error.code = "ELOOP";
    throw error;
  }
  return result.fd;
}

/**
 * Acquire the final parent descriptor by walking from one held anchor.
 * No component after the anchor is resolved through AT_FDCWD or a joined path.
 */
function openSourceParent(sourcePath: string): number {
  const anchorFd = openSync(isAbsolute(sourcePath) ? "/" : ".", SOURCE_DIRECTORY_FLAGS);
  const mainLeaf = basename(sourcePath);
  const parentText = sourcePath.slice(0, sourcePath.length - mainLeaf.length);
  const components = parentText
    .split("/")
    .filter((component) => component.length > 0 && component !== ".");
  let currentFd = anchorFd;

  try {
    for (const component of components) {
      if (component === ".." || component.includes("\\") || component.includes("\0")) {
        throw new Error(`SourceHandle: unsafe parent component: ${component}`);
      }
      const nextFd = openRelativeOrThrow(
        currentFd,
        component,
        SOURCE_DIRECTORY_FLAGS,
        `SourceHandle: parent component ${component}`,
      );
      closeSync(currentFd);
      currentFd = nextFd;
    }
    return currentFd;
  } catch (error) {
    try { closeSync(currentFd); } catch { /* best effort */ }
    throw error;
  }
}

/**
 * Acquire an opaque source handle for the given database path.
 *
 * Opens the source main file once, captures its identity (device/inode/type/size),
 * and retains the parent directory descriptor for opening WAL/SHM members.
 * The main file descriptor is left open for the caller to read from if needed,
 * but the canonical source bytes should be obtained through snapshotBundle,
 * which reads through this handle's descriptors and verifies the captured identity.
 *
 * @param sourcePath - Path to the source .cdb main file
 * @param options - Acquisition options
 * @returns An opaque SourceHandle with owned descriptors
 */
export function acquireSourceHandle(
  sourcePath: string,
  _options: AcquireSourceOptions = {}
): SourceHandle {
  if (process.env.CDB_USE_NATIVE_READER === "1") {
    return acquireNativeSourceHandle(sourcePath, _options);
  }
  return acquirePortableSourceHandle(sourcePath, _options);
}

/**
 * Cross-platform source reader used by the public raw conversion path.
 *
 * v1 supported every platform that better-sqlite3 supports. Keep the source
 * descriptor open while snapshotting so the reader retains stable bytes, but
 * do not require the Linux-only descriptor-relative native module merely to
 * read a database.
 */
function acquirePortableSourceHandle(
  sourcePath: string,
  { diagnostics }: AcquireSourceOptions,
): SourceHandle {
  const mainLeaf = basename(sourcePath);
  validateLeaf(mainLeaf, "SourceHandle: main leaf");

  let parentFd: number | null = null;
  let mainFd: number | null = null;
  try {
    parentFd = openSync(dirname(sourcePath), constants.O_RDONLY);
    mainFd = openSync(sourcePath, constants.O_RDONLY);
    const mainStats = fstatSync(mainFd);
    if (!mainStats.isFile()) {
      throw new Error(`Source file is not a regular file: ${sourcePath}`);
    }
    const parentStats = fstatSync(parentFd);
    if (!parentStats.isDirectory()) {
      throw new Error(`Source parent is not a directory: ${sourcePath}`);
    }

    return new PortableSourceHandleImpl(
      sourcePath,
      mainFd,
      parentFd,
      mainLeaf,
      {
        device: mainStats.dev,
        inode: mainStats.ino,
        type: "regular",
        size: mainStats.size,
      },
      hashDescriptor(mainFd, mainStats.size),
    );
  } catch (error) {
    if (mainFd !== null) {
      try { closeSync(mainFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
    diagnostics?.error(
      DiagnosticCode.CDB_OPEN_FAILED,
      `Failed to acquire source handle: ${error instanceof Error ? error.message : String(error)}`,
      { source: { database: sourcePath } },
    );
    throw error;
  }
}

/**
 * The former Linux-native descriptor-relative implementation is retained
 * below for reference while the public reader uses the portable v1 contract.
 */
function acquireNativeSourceHandle(
  sourcePath: string,
  _options: AcquireSourceOptions = {}
): SourceHandle {
  const { diagnostics } = _options;

  // Extract the leaf (filename) from the path
  const mainLeaf = basename(sourcePath);
  validateLeaf(mainLeaf, "SourceHandle: main leaf");

  // Hold the parent before observing or opening the source leaf.
  const parentFd = openSourceParent(sourcePath);

  let mainFd: number | null = null;
  let capturedMainIdentity: FileIdentity | null = null;
  let capturedMainDigest: string | null = null;
  let capturedParentIdentity: FileIdentity | null = null;

  try {
    mainFd = openRelativeOrThrow(
      parentFd,
      mainLeaf,
      SOURCE_FILE_FLAGS,
      `SourceHandle: main member ${mainLeaf}`,
    );

    // Capture the main file identity using fstatSync on the open descriptor
    const mainStats = fstatSync(mainFd);
    if (!mainStats.isFile()) {
      try { closeSync(mainFd); } catch { /* best effort */ }
      try { closeSync(parentFd); } catch { /* best effort */ }
      throw new Error(
        `Source file is not a regular file: ${sourcePath} (type=${mainStats.mode & 0o170000})`
      );
    }

    capturedMainIdentity = {
      device: mainStats.dev,
      inode: mainStats.ino,
      type: "regular",
      size: mainStats.size,
    };
    capturedMainDigest = hashDescriptor(mainFd, mainStats.size);

    const parentStats = fstatSync(parentFd);
    if (!parentStats.isDirectory()) {
      throw new Error(`Source parent is not a directory: ${sourcePath}`);
    }
    capturedParentIdentity = {
      device: parentStats.dev,
      inode: parentStats.ino,
      type: "directory",
      size: parentStats.size,
    };
  } catch (error) {
    // Clean up on failure
    if (mainFd !== null) {
      try { closeSync(mainFd); } catch { /* best effort */ }
    }
    try { closeSync(parentFd); } catch { /* best effort */ }
    diagnostics?.error(
      DiagnosticCode.CDB_OPEN_FAILED,
      `Failed to acquire source handle: ${error instanceof Error ? error.message : String(error)}`,
      { source: { database: sourcePath } }
    );
    throw error;
  }

  return new SourceHandleImpl(
    sourcePath,
    mainFd!,
    parentFd,
    mainLeaf,
    capturedMainIdentity!,
    capturedMainDigest!,
    capturedParentIdentity!,
  );
}

/**
 * Concrete SourceHandle implementation.
 */
class SourceHandleImpl implements SourceHandle {
  readonly sourcePath: string;
  readonly mainFd: number;
  readonly parentFd: number;
  readonly mainLeaf: string;
  readonly mainIdentity: FileIdentity;
  readonly mainDigest: string;
  private readonly parentIdentity: FileIdentity;
  private _closed = false;

  constructor(
    sourcePath: string,
    mainFd: number,
    parentFd: number,
    mainLeaf: string,
    mainIdentity: FileIdentity,
    mainDigest: string,
    parentIdentity: FileIdentity,
  ) {
    this.sourcePath = sourcePath;
    this.mainFd = mainFd;
    this.parentFd = parentFd;
    this.mainLeaf = mainLeaf;
    this.mainIdentity = mainIdentity;
    this.mainDigest = mainDigest;
    this.parentIdentity = parentIdentity;
  }

  openMember(memberSuffix: "-wal" | "-shm"): Promise<{
    fd: number;
    stat: Awaited<ReturnType<typeof fstatSync>>;
    digest: string;
  } | null> {
    return Promise.resolve().then(() => {
      if (this._closed) {
        throw new Error("SourceHandle is already closed");
      }

      const parentStats = fstatSync(this.parentFd);
      if (
        parentStats.dev !== this.parentIdentity.device ||
        parentStats.ino !== this.parentIdentity.inode ||
        !parentStats.isDirectory()
      ) {
        throw new SourceMutatedError(
          `Source parent changed while opening ${memberSuffix}: ${this.sourcePath}`,
        );
      }

      const memberLeaf = `${this.mainLeaf}${memberSuffix}`;
      let fd: number;
      try {
        fd = openRelativeOrThrow(
          this.parentFd,
          memberLeaf,
          SOURCE_FILE_FLAGS,
          `SourceHandle: member ${memberSuffix}`,
        );
      } catch (error: unknown) {
        // ENOENT means the member doesn't exist — this is allowed
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        // Any other error (permission, etc.) is a real failure
        throw error;
      }

      try {
        const stats = fstatSync(fd);
        if (!stats.isFile()) {
          try { closeSync(fd); } catch { /* best effort */ }
          throw new Error(`Member ${memberSuffix} is not a regular file: ${this.sourcePath}`);
        }
        return { fd, stat: stats, digest: hashDescriptor(fd, stats.size) };
      } catch (error) {
        try { closeSync(fd); } catch { /* best effort */ }
        throw error;
      }
    });
  }

  verifyMainIdentity(diagnostics?: DiagnosticCollector): Promise<void> {
    return Promise.resolve().then(() => {
      if (this._closed) {
        throw new Error("SourceHandle is already closed");
      }

      try {
        const currentStats = fstatSync(this.mainFd);
        if (
          currentStats.ino !== this.mainIdentity.inode ||
          currentStats.dev !== this.mainIdentity.device ||
          currentStats.size !== this.mainIdentity.size
        ) {
          const error = new SourceMutatedError(
            `Source main file was mutated: ${this.sourcePath} ` +
              `(original inode=${this.mainIdentity.inode}, current=${currentStats.ino}; ` +
              `original size=${this.mainIdentity.size}, current=${currentStats.size})`
          );
          diagnostics?.error(
            DiagnosticCode.SOURCE_MUTATED_DURING_READ,
            error.message,
            {
              source: { database: this.sourcePath },
              details: {
                originalInode: this.mainIdentity.inode,
                currentInode: currentStats.ino,
                originalSize: this.mainIdentity.size,
                currentSize: currentStats.size,
              },
            }
          );
          throw error;
        }

        const currentDigest = hashDescriptor(this.mainFd, currentStats.size);
        if (currentDigest !== this.mainDigest) {
          const error = new SourceMutatedError(
            `Source main bytes changed while held: ${this.sourcePath}`,
          );
          diagnostics?.error(
            DiagnosticCode.SOURCE_MUTATED_DURING_READ,
            error.message,
            {
              source: { database: this.sourcePath },
              details: {
                originalInode: this.mainIdentity.inode,
                currentInode: currentStats.ino,
                originalSize: this.mainIdentity.size,
                currentSize: currentStats.size,
                originalDigest: this.mainDigest,
                currentDigest,
              },
            },
          );
          throw error;
        }
      } catch (error) {
        if (error instanceof SourceMutatedError) throw error;
        // fstatSync error on the already-open fd is unexpected
        diagnostics?.error(
          DiagnosticCode.CDB_OPEN_FAILED,
          `Failed to verify source identity: ${error instanceof Error ? error.message : String(error)}`,
          { source: { database: this.sourcePath } }
        );
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return Promise.resolve().then(() => {
      if (this._closed) return;
      this._closed = true;

      // Close main fd
      try {
        closeSync(this.mainFd);
      } catch {
        // Ignore close errors
      }

      // Close parent fd
      try {
        closeSync(this.parentFd);
      } catch {
        // Ignore close errors
      }
    });
  }
}

class PortableSourceHandleImpl implements SourceHandle {
  readonly sourcePath: string;
  readonly mainFd: number;
  readonly parentFd: number;
  readonly mainLeaf: string;
  readonly mainIdentity: FileIdentity;
  readonly mainDigest: string;
  private _closed = false;

  constructor(
    sourcePath: string,
    mainFd: number,
    parentFd: number,
    mainLeaf: string,
    mainIdentity: FileIdentity,
    mainDigest: string,
  ) {
    this.sourcePath = sourcePath;
    this.mainFd = mainFd;
    this.parentFd = parentFd;
    this.mainLeaf = mainLeaf;
    this.mainIdentity = mainIdentity;
    this.mainDigest = mainDigest;
  }

  async openMember(memberSuffix: "-wal" | "-shm") {
    if (this._closed) throw new Error("SourceHandle is already closed");
    let fd: number;
    try {
      fd = openSync(join(dirname(this.sourcePath), `${this.mainLeaf}${memberSuffix}`), constants.O_RDONLY);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error(`Member ${memberSuffix} is not a regular file: ${this.sourcePath}`);
      return { fd, stat, digest: hashDescriptor(fd, stat.size) };
    } catch (error) {
      try { closeSync(fd); } catch { /* best effort */ }
      throw error;
    }
  }

  async verifyMainIdentity(diagnostics?: DiagnosticCollector): Promise<void> {
    if (this._closed) throw new Error("SourceHandle is already closed");
    try {
      const currentStats = fstatSync(this.mainFd);
      const currentDigest = hashDescriptor(this.mainFd, currentStats.size);
      if (
        !currentStats.isFile() ||
        currentStats.ino !== this.mainIdentity.inode ||
        currentStats.dev !== this.mainIdentity.device ||
        currentStats.size !== this.mainIdentity.size ||
        currentDigest !== this.mainDigest
      ) {
        throw new SourceMutatedError(`Source main file changed while reading: ${this.sourcePath}`);
      }
    } catch (error) {
      if (error instanceof SourceMutatedError) {
        diagnostics?.error(DiagnosticCode.SOURCE_MUTATED_DURING_READ, error.message, {
          source: { database: this.sourcePath },
        });
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try { closeSync(this.mainFd); } catch { /* best effort */ }
    try { closeSync(this.parentFd); } catch { /* best effort */ }
  }
}
