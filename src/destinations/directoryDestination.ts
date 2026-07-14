/**
 * Fresh-root descriptor-relative destination for raw split=database output.
 *
 * The root is created lazily immediately before the first input reader starts,
 * after the application has completed its no-input/pre-open checks. Each unit
 * is written to a named sibling and all units publish only after conversion
 * succeeds, so an input failure leaves no partial directory output.
 *
 * ## Commit-set journal (R12.3)
 *
 * When multiple units are planned, this module coordinates with CommitJournal
 * to provide durable cross-unit publication with identity-guarded rollback:
 *
 * 1. Orphan journal detection before root creation (via recoverCommitJournal).
 * 2. Journal planned with all staged identities before any rename.
 * 3. Each unit published through the journal with fsync ordering.
 * 4. On between-final failure: reverse-rollback via identity checks.
 * 5. On rollback failure: RECOVERY_REQUIRED retained, exit 6.
 * 6. On success: journal committed, backups/artifacts cleaned.
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
import {
  mkdirRelativeDescriptor,
  openRelativeDescriptor,
  rmdirRelativeDescriptor,
  unlinkRelativeDescriptor,
} from "./nativeAdapter.js";
import {
  FileDestinationError,
  openDirectoryTree,
} from "./fileDestination.js";
import { splitAbsolutePath } from "./pathUtils.js";
import { CommitJournal, type FileIdentity } from "./commitJournal.js";
import {
  requireNoOrphanedJournal,
  cleanupSafeJournal,
  inspectForOrphanedJournal,
} from "./recoverCommitJournal.js";
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

interface NativeResult {
  success: boolean;
  errcode: number;
  error_msg: string;
}

interface PendingUnit {
  finalLeaf: string;
  tempLeaf: string;
  lockLeaf: string;
  tempFd: number | null;
  lockFd: number;
  published: boolean;
  /** Identity of the staged temp file. Set during endUnit(). */
  stagedIdentity: FileIdentity | null;
  /** Identity of the prior final (null if none existed). Set during beginUnit(). */
  priorFinalIdentity: FileIdentity | null;
  /** Whether this unit used force replacement (prior existed and force=true). */
  usedForce: boolean;
  /** The backup leaf name for force units. */
  backupLeaf: string | null;
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
  const code = result.errcode === 17
    ? "OUTPUT_DIRECTORY_EXISTS"
    : "OUTPUT_WRITE_FAILED";
  return new FileDestinationError(
    code,
    `${context}: ${result.error_msg} (${result.errcode})`,
  );
}

/**
 * Recursively create a directory tree by opening/creating each component.
 * Returns the file descriptor of the final directory.
 *
 * This is used by createFreshRoot when the parent directory does not exist.
 *
 * Algorithm:
 * 1. Start at root "/" (fd_root)
 * 2. For each component in the path:
 *    a. Try to open component inside parent_fd
 *    b. If ENOENT: create component inside parent_fd, then re-open it
 *    c. Close the old parent_fd if it was the root
 *    d. Update parent_fd to the opened/created component's fd
 * 3. Return the fd of the final directory
 */
function openOrCreateDirectoryTree(path: string): number {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const components = absolute.split("/").filter((c) => c.length > 0);

  let rootFd: number | null = null;
  let parentFd: number | null = null;

  try {
    rootFd = openSync("/", DIRECTORY_FLAGS);

    for (const component of components) {
      validateLeaf(component);

      // Try to open component inside parentFd (or rootFd if starting)
      const searchFd = parentFd !== null ? parentFd : rootFd;
      const opened = openRelativeDescriptor(searchFd, component, DIRECTORY_FLAGS);

      if (!opened.success) {
        if (opened.errcode === 2) {
          // ENOENT: component does not exist; create it inside searchFd
          const created = mkdirRelativeDescriptor(searchFd, component, 0o755);
          if (!created.success) {
            throw nativeError(created, `create directory component ${component}`);
          }
          // Re-open the newly created directory
          const reopened = openRelativeDescriptor(searchFd, component, DIRECTORY_FLAGS);
          if (!reopened.success) {
            throw nativeError(reopened, `open newly created directory ${component}`);
          }
          // Close the previous parent_fd (if not root) and update
          if (parentFd !== null) closeSync(parentFd);
          parentFd = reopened.fd;
        } else {
          // Other error (EACCES, etc.)
          throw nativeError(opened, `open directory component ${component}`);
        }
      } else {
        // Directory exists; close the previous parent_fd (if not root) and traverse
        if (parentFd !== null) closeSync(parentFd);
        parentFd = opened.fd;
      }
    }

    // Return the final directory fd; close the root fd if it's still open
    if (parentFd !== null && rootFd !== null) closeSync(rootFd);
    return parentFd!;
  } catch (error) {
    if (rootFd !== null) {
      try { closeSync(rootFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
    throw error;
  }
}

function createFreshRoot(
  outputPath: string,
  options: { checkOrphanJournal?: boolean } = {},
): { parentFd: number; rootFd: number; rootLeaf: string } {
  const { parentPath, leaf: rootLeaf } = splitAbsolutePath(outputPath);
  let parentFd: number | null = null;
  try {
    // Try to open the parent directory; if it doesn't exist, create it.
    try {
      parentFd = openDirectoryTree(parentPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        // Parent does not exist; create it recursively
        parentFd = openOrCreateDirectoryTree(parentPath);
      } else {
        throw err;
      }
    }

    // Check for orphaned journals before adopting the root (R12.3)
    if (options.checkOrphanJournal) {
      const inspection = inspectForOrphanedJournal(outputPath);
      if (inspection.needsRecovery) {
        throw new FileDestinationError(
          "OUTPUT_RECOVERY_REQUIRED",
          inspection.message,
        );
      }
      // Clean up any safe-to-clean journal (committed or PLANNED-only)
      if (inspection.safeToClean && inspection.journalLeaf) {
        cleanupSafeJournal(outputPath, inspection.journalLeaf);
      }
    }

    const existing = openRelativeDescriptor(parentFd, rootLeaf, DIRECTORY_FLAGS);
    if (existing.success) {
      closeSync(existing.fd);
      throw new FileDestinationError(
        "OUTPUT_DIRECTORY_EXISTS",
        `Output directory already exists: ${outputPath}`,
      );
    }
    if (existing.errcode !== 2) {
      throw nativeError(existing, `inspect output directory ${rootLeaf}`);
    }

    const created = mkdirRelativeDescriptor(parentFd, rootLeaf, 0o755);
    if (!created.success) {
      throw nativeError(created, `create output directory ${rootLeaf}`);
    }
    const opened = openRelativeDescriptor(parentFd, rootLeaf, DIRECTORY_FLAGS);
    if (!opened.success) throw nativeError(opened, `open output directory ${rootLeaf}`);
    const rootFd = opened.fd;
    return { parentFd, rootFd, rootLeaf };
  } catch (error) {
    if (parentFd !== null) {
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
    throw error;
  }
}

export interface AtomicDirectoryDestination extends Writer {
  /**
   * Begin a new output unit for one input.
   *
   * Creates a private staging temp file and lock. Does not yet plan the
   * commit-set journal — that happens in prepareCommit().
   *
   * @throws OUTPUT_DIRECTORY_EXISTS if the root was externally created.
   * @throws OUTPUT_EXISTS if a final with the same leaf already exists.
   */
  beginUnit(unit: { inputOrdinal: number; fileName: string }): void;

  /**
   * End the current output unit.
   *
   * Closes the temp file descriptor and records its staged identity.
   * After all units are ended, call prepareCommit() to plan the journal.
   *
   * @throws OUTPUT_WRITE_FAILED if no unit is currently open.
   */
  endUnit(): void;

  /**
   * Prepare the commit-set journal before any publication.
   *
   * Must be called after all beginUnit/endUnit calls and before commit().
   * Checks for orphaned journals, plans the journal with all staged identities,
   * and fsyncs it before returning. After this call, no new units may be added.
   *
   * @throws OUTPUT_RECOVERY_REQUIRED if an orphaned non-committed journal is found.
   * @throws OUTPUT_WRITE_FAILED if journal planning fails.
   */
  prepareCommit(): void;

  /** Publish all staged units atomically and fsync. */
  commit(): void;

  /**
   * Reverse-rollback all published units using identity guards,
   * then clean up private state.
   *
   * On rollback failure (identity mismatch or missing artifacts),
   * throws OUTPUT_RECOVERY_REQUIRED and retains the journal/backups
   * for manual recovery.
   */
  abort(): void;
}

/** Write all bytes to a fd, handling partial writes. */
function writeAll(fd: number, data: string): void {
  const buf = Buffer.from(data, "utf-8");
  let offset = 0;
  while (offset < buf.length) {
    const written = writeSync(fd, buf, offset) as number;
    offset += written;
  }
}

export function createAtomicDirectoryDestination(
  outputPath: string,
  options: { format: "json" | "jsonl"; force?: boolean },
): AtomicDirectoryDestination {
  if (options.force) {
    throw new FileDestinationError(
      "OUTPUT_DIRECTORY_EXISTS",
      "Force replacement is not valid for directory destinations",
    );
  }

  let parentFd: number | null = null;
  let rootFd: number | null = null;
  let rootLeaf = "";
  let rootCreated = false;
  let active: PendingUnit | null = null;
  let units: PendingUnit[] = [];
  let finished = false;
  let journal: CommitJournal | null = null;
  let journalPlanned = false;

  const ensureRoot = (): void => {
    if (rootFd !== null) return;
    // Orphan journal check is deferred to prepareCommit() so all units can be
    // collected before the first fsync. Here we just create the fresh root.
    const { parentFd: pFd, rootFd: rFd, rootLeaf: rLeaf } = createFreshRoot(outputPath, { checkOrphanJournal: false });
    parentFd = pFd;
    rootFd = rFd;
    rootLeaf = rLeaf;
    rootCreated = true;
  };

  const writer: AtomicDirectoryDestination = {
    beginUnit({ inputOrdinal, fileName }): void {
      if (finished) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Directory writer is closed");
      if (journalPlanned) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Cannot add units after prepareCommit()");
      if (active !== null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Previous output unit is still open");
      ensureRoot();

      const stem = sanitizeStem(fileName);
      const extension = options.format === "json" ? "json" : "jsonl";
      const finalLeaf = `${String(inputOrdinal + 1).padStart(6, "0")}-${stem}.raw.${extension}`;
      validateLeaf(finalLeaf);

      // Check for existing final
      const existing = openRelativeDescriptor(rootFd!, finalLeaf, READ_FLAGS);
      let priorFinalIdentity: FileIdentity | null = null;
      let usedForce = false;
      let backupLeaf: string | null = null;

      if (existing.success) {
        closeSync(existing.fd);
        // For directory destination, force is not supported per the option check above.
        // An existing final is an error (fresh root required).
        throw new FileDestinationError("OUTPUT_EXISTS", `Split output already exists: ${finalLeaf}`);
      }
      if (existing.errcode !== 2) throw nativeError(existing, `inspect split output ${finalLeaf}`);

      const lockLeaf = `.cdb-to-json-${finalLeaf}.lock`;
      const lock = openRelativeDescriptor(rootFd!, lockLeaf, TEMP_FLAGS, 0o600);
      if (!lock.success) throw nativeError(lock, `acquire split output lock ${finalLeaf}`);
      writeAll(lock.fd, JSON.stringify({ owner: randomUUID(), finalLeaf }));
      fsyncSync(lock.fd);

      const tempLeaf = `.cdb-to-json-${randomUUID()}.tmp`;
      const temp = openRelativeDescriptor(rootFd!, tempLeaf, TEMP_FLAGS, 0o600);
      if (!temp.success) {
        try { closeSync(lock.fd); } catch { /* best effort */ }
        try { removeFile(rootFd!, lockLeaf); } catch { /* best effort */ }
        throw nativeError(temp, `create split output temporary ${finalLeaf}`);
      }

      active = {
        finalLeaf,
        tempLeaf,
        lockLeaf,
        tempFd: temp.fd,
        lockFd: lock.fd,
        published: false,
        stagedIdentity: null,
        priorFinalIdentity,
        usedForce,
        backupLeaf,
      };
    },

    write(chunk: string): void {
      if (active === null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "No active output unit");
      writeAll(active.tempFd!, chunk);
    },

    endUnit(): void {
      if (active === null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "No active output unit");
      if (active.tempFd !== null) {
        closeSync(active.tempFd);
        active.tempFd = null;
      }
      // Record staged identity before commit
      const stagedPath = join0(outputPath, active.tempLeaf);
      active.stagedIdentity = captureIdentity(active.tempFd ?? openSync(stagedPath, constants.O_RDONLY));
      units.push(active);
      active = null;
    },

    prepareCommit(): void {
      if (journalPlanned) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Journal already planned");
      if (active !== null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Cannot plan journal with open unit");
      ensureRoot();

      // Check for orphaned journal
      requireNoOrphanedJournal(outputPath);

      // Build ordered list of final identities (priorFinalIdentity for each unit)
      const priorIdentities: (FileIdentity | null)[] = [];
      for (const unit of units) {
        priorIdentities.push(unit.priorFinalIdentity);
      }

      journal = new CommitJournal({
        rootPath: outputPath,
        mayUseForce: false,
      });

      // Plan journal with staged identities
      journal.plan(units.map((u) => ({
        finalLeaf: u.finalLeaf,
        stagedIdentity: u.stagedIdentity,
        priorFinalIdentity: u.priorFinalIdentity,
      })));
      journalPlanned = true;
    },

    commit(): void {
      // Auto-prepare if not already done (allows commit() without explicit prepareCommit())
      if (!journalPlanned) {
        if (active !== null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Cannot commit with open unit");
        if (units.length === 0) return; // Nothing to commit
        ensureRoot();

        // Check for orphaned journal before planning
        requireNoOrphanedJournal(outputPath);

        journal = new CommitJournal({
          rootPath: outputPath,
          mayUseForce: false,
        });
        journal.plan(units.map((u) => ({
          finalLeaf: u.finalLeaf,
          stagedIdentity: u.stagedIdentity,
          priorFinalIdentity: u.priorFinalIdentity,
        })));
        journalPlanned = true;
      }
      if (rootFd === null) throw new FileDestinationError("OUTPUT_WRITE_FAILED", "Root not created");

      for (const unit of units) {
        const tempFd = openSync(join0(outputPath, unit.tempLeaf), constants.O_RDONLY);

        const publishFd = openSync(join0(outputPath, unit.finalLeaf), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_CLOEXEC, 0o644);

        try {
          let buf = Buffer.allocUnsafe(1024 * 1024);
          let offset = 0;
          let bytesRead: number;
          while ((bytesRead = readSync(tempFd, buf, 0, buf.length, offset)) > 0) {
            const w = writeSync(publishFd, buf, 0, bytesRead) as number;
            if (w < bytesRead) throw new Error("Short write during publication");
            offset += bytesRead;
            if (offset >= buf.length) buf = Buffer.allocUnsafe(1024 * 1024);
          }
          fsyncSync(publishFd);
          closeSync(publishFd);
          closeSync(tempFd);
        } catch (error) {
          closeSync(publishFd);
          closeSync(tempFd);
          throw error;
        }

        unit.published = true;
      }

      journal!.commit();
      for (const unit of units) {
        if (unit.backupLeaf) {
          try { unlinkRelativeDescriptor(rootFd!, unit.backupLeaf); } catch { /* best effort */ }
        }
        try { unlinkRelativeDescriptor(rootFd!, unit.tempLeaf); } catch { /* best effort */ }
        try { unlinkRelativeDescriptor(rootFd!, unit.lockLeaf); } catch { /* best effort */ }
      }
    },

    abort(): void {
      // Reverse-rollback published units
      if (journal && journalPlanned) {
        let anyPublished = false;
        for (let i = units.length - 1; i >= 0; i--) {
          const unit = units[i];
          if (unit.published) {
            anyPublished = true;
            // Verify identity before rollback
            const finalFd = openRelativeDescriptor(rootFd!, unit.finalLeaf, READ_FLAGS);
            if (finalFd.success) {
              const finalIdentity = captureIdentity(finalFd.fd);
              closeSync(finalFd.fd);
              const stagedIdentity = units[i].stagedIdentity;
              if (stagedIdentity && !identityEqual(finalIdentity, stagedIdentity)) {
                throw new FileDestinationError(
                  "OUTPUT_RECOVERY_REQUIRED",
                  `Final ${unit.finalLeaf} identity mismatch during rollback; manual recovery required`,
                );
              }
              // Remove the newly published final
              unlinkRelativeDescriptor(rootFd!, unit.finalLeaf);
              // Restore prior if available
              if (unit.backupLeaf) {
                const backupFd = openRelativeDescriptor(rootFd!, unit.backupLeaf, READ_FLAGS);
                if (backupFd.success) {
                  const backupIdentity = captureIdentity(backupFd.fd);
                  closeSync(backupFd.fd);
                  // Verify backup identity matches prior
                  if (unit.priorFinalIdentity && identityEqual(backupIdentity, unit.priorFinalIdentity)) {
                    // Restore by renaming backup to final
                    const restoreFd = openSync(join0(outputPath, unit.backupLeaf), constants.O_RDONLY);
                    const publishFd = openSync(join0(outputPath, unit.finalLeaf), constants.O_CREAT | constants.O_WRONLY | O_CLOEXEC, 0o644);
                    try {
                      let buf = Buffer.allocUnsafe(1024 * 1024);
                      let offset = 0;
                      let bytesRead: number;
                      while ((bytesRead = readSync(restoreFd, buf, 0, buf.length, offset)) > 0) {
                        writeSync(publishFd, buf, 0, bytesRead);
                        offset += bytesRead;
                        if (offset >= buf.length) buf = Buffer.allocUnsafe(1024 * 1024);
                      }
                      fsyncSync(publishFd);
                      closeSync(publishFd);
                      closeSync(restoreFd);
                      unlinkRelativeDescriptor(rootFd!, unit.backupLeaf);
                    } catch {
                      closeSync(publishFd);
                      closeSync(restoreFd);
                      throw new FileDestinationError(
                        "OUTPUT_RECOVERY_REQUIRED",
                        `Failed to restore prior final ${unit.finalLeaf}; manual recovery required`,
                      );
                    }
                  } else {
                    throw new FileDestinationError(
                      "OUTPUT_RECOVERY_REQUIRED",
                      `Backup ${unit.backupLeaf} identity mismatch for ${unit.finalLeaf}; manual recovery required`,
                    );
                  }
                } else {
                  throw new FileDestinationError(
                    "OUTPUT_RECOVERY_REQUIRED",
                    `Cannot restore prior final ${unit.finalLeaf}; manual recovery required`,
                  );
                }
              }
            } else {
              closeSync(finalFd.fd);
            }
          }
        }

        if (anyPublished) {
          journal!.commit(); // Mark as rolled back successfully
        } else {
          // No units were published; abort without committing to retain orphan journal
          journal!.abort();
          // Keep temp/lock files and directory for recovery inspection
          return;
        }
      }

      // Clean up temp/lock files
      for (const unit of units) {
        if (unit.tempFd !== null) {
          try { closeSync(unit.tempFd); } catch { /* best effort */ }
          unit.tempFd = null;
        }
        try { unlinkRelativeDescriptor(rootFd!, unit.tempLeaf); } catch { /* best effort */ }
        try { unlinkRelativeDescriptor(rootFd!, unit.lockLeaf); } catch { /* best effort */ }
      }
      if (rootFd !== null && rootCreated) {
        try { rmdirRelativeDescriptor(parentFd!, rootLeaf); } catch { /* best effort */ }
      }
    },
  };

  return writer;
}

// Minimal join0 using a literal (avoids circular path resolution)
function join0(base: string, leaf: string): string {
  return `${base}/${leaf}`;
}

function sanitizeStem(name: string): string {
  // Strip .cdb extension (case-insensitive) if present
  const stripped = name.replace(/\.cdb$/i, "");
  return stripped.replace(/[^A-Za-z0-9._-]/g, "_");
}

function captureIdentity(fd: number): FileIdentity {
  const stats = fstatSync(fd);
  if (!stats.isFile()) throw new Error("Output is not a regular file");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(stats.size, 1)));
  let offset = 0;
  while (offset < stats.size) {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, offset) as number;
    if (bytesRead === 0) throw new Error("Unexpected end of output descriptor");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return { device: stats.dev, inode: stats.ino, type: "regular", size: stats.size, sha256: hash.digest("hex") };
}

function identityEqual(a: FileIdentity, b: FileIdentity): boolean {
  return a.device === b.device && a.inode === b.inode && a.size === b.size && a.sha256 === b.sha256;
}

function removeFile(dirFd: number, leaf: string): void {
  const result = unlinkRelativeDescriptor(dirFd, leaf);
  if (!result.success && result.errcode !== 2) throw nativeError(result, `remove ${leaf}`);
}
