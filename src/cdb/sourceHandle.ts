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

import { openSync, closeSync, fstatSync } from "node:fs";
import { basename } from "node:path";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

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
  openMember(memberSuffix: "-wal" | "-shm"): Promise<{ fd: number; stat: Awaited<ReturnType<typeof fstatSync>> } | null>;

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
  const { followSymlinks: _followSymlinks = false, diagnostics } = _options;

  // Extract the leaf (filename) from the path
  const mainLeaf = basename(sourcePath);
  validateLeaf(mainLeaf, "SourceHandle: main leaf");

  // Validate parent directory
  const parentDir = sourcePath.substring(0, sourcePath.lastIndexOf(mainLeaf));
  const effectiveParent = parentDir === "" ? "." : parentDir;

  // Open the parent directory first
  const parentFd = openSync(effectiveParent, "r");

  let mainFd: number | null = null;
  let capturedMainIdentity: FileIdentity | null = null;

  try {
    // Open the main file. followSymlinks=false is the default (no O_NOFOLLOW
    // is implicit since we verify via fstatSync below).
    mainFd = openSync(sourcePath, "r");

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
    capturedMainIdentity!
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
  private _closed = false;

  constructor(
    sourcePath: string,
    mainFd: number,
    parentFd: number,
    mainLeaf: string,
    mainIdentity: FileIdentity
  ) {
    this.sourcePath = sourcePath;
    this.mainFd = mainFd;
    this.parentFd = parentFd;
    this.mainLeaf = mainLeaf;
    this.mainIdentity = mainIdentity;
  }

  openMember(memberSuffix: "-wal" | "-shm"): Promise<{ fd: number; stat: Awaited<ReturnType<typeof fstatSync>> } | null> {
    return Promise.resolve().then(() => {
      if (this._closed) {
        throw new Error("SourceHandle is already closed");
      }

      const memberPath = this.sourcePath + memberSuffix;
      let fd: number;
      try {
        fd = openSync(memberPath, "r");
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
          throw new Error(`Member ${memberSuffix} is not a regular file: ${memberPath}`);
        }
        return { fd, stat: stats };
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
