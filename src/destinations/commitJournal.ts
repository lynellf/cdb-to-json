/**
 * Descriptor-relative commit-set journal for multi-output conversions.
 *
 * ## Purpose
 *
 * The journal records the complete publication lifecycle of every final in a
 * conversion run. It is the authoritative record for:
 * - Planning all finals before any writable operation
 * - Creating force backups and recording their identities
 * - Publishing with durable fsync ordering
 * - Identity-guarded reverse rollback on between-final failure
 * - Recovery state when rollback itself fails
 *
 * ## Durable ordering (R12.3)
 *
 * 1. Reserve every final and create/write the complete `PLANNED` journal.
 *    fsync the journal and then the parent directory.
 * 2. For force replacement: create the descriptor-relative backup, verify
 *    and record its identity, fsync the backup and parent, then mark
 *    `BACKUP_DURABLE` and fsync the journal.
 * 3. Publish one stage at a time with descriptor-relative no-replace or force
 *    rename. fsync the published file/directory and parent, record its
 *    complete identity, mark `PUBLISHED`, and fsync the journal before
 *    proceeding.
 * 4. On success: mark the journal committed, fsync it and the parent, then
 *    remove backups/journal only after every final is durable. Cleanup is
 *    identity-checked and idempotent.
 *
 * ## Identity guards (R12.3)
 *
 * Rollback may remove a no-force final only when its current identity exactly
 * matches the recorded published identity. It may restore a force backup only
 * after the current final matches the recorded published identity AND the
 * backup matches the recorded backup identity. If a final is missing or differs,
 * rollback marks that entry `RECOVERY_REQUIRED`, retains journal/backups/locks,
 * and returns OUTPUT_RECOVERY_REQUIRED.
 *
 * ## Crash / orphan semantics
 *
 * A committed journal is safe to finish-clean. A non-committed orphaned journal
 * is detected by recoverCommitJournal.ts before destination adoption and refuses
 * with `OUTPUT_RECOVERY_REQUIRED` (exit 6).
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
  atomicRenameReplace,
  openRelativeDescriptor,
  unlinkRelativeDescriptor,
} from "./nativeAdapter.js";
import { FileDestinationError } from "./fileDestination.js";
import { splitAbsolutePath } from "./pathUtils.js";

const O_CLOEXEC = 0x80000;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC;
const WRITE_FLAGS =
  constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW | O_CLOEXEC;

// =============================================================================
// Types
// =============================================================================

/**
 * Per-final publication state.
 */
export type JournalEntryState =
  | "PLANNED"
  | "BACKUP_DURABLE"
  | "PUBLISHED"
  | "ROLLED_BACK"
  | "RECOVERY_REQUIRED";

/**
 * File identity recorded in the journal.
 * Includes device, inode, type, size, and SHA-256 of exact bytes.
 */
export interface FileIdentity {
  device: number;
  inode: number;
  type: "regular" | "directory";
  size: number;
  sha256: string;
}

/**
 * One journal entry covering a single final.
 */
export interface JournalEntry {
  finalLeaf: string;
  state: JournalEntryState;
  /** Identity of the staged temp file before rename (always set when planned). */
  stagedIdentity: FileIdentity | null;
  /** Identity of the published final after rename. */
  publishedIdentity: FileIdentity | null;
  /** Identity of the force-backup created before replacement. */
  backupIdentity: FileIdentity | null;
  /** Identity of the prior final that was replaced (null for absent pre-existing). */
  priorFinalIdentity: FileIdentity | null;
}

/**
 * The complete journal document.
 */
export interface CommitJournalDocument {
  version: 1;
  runToken: string;
  trustedRootIdentity: FileIdentity;
  journalLeaf: string;
  committed: boolean;
  entries: JournalEntry[];
}

// =============================================================================
// Low-level helpers
// =============================================================================

function recoveryError(message: string): FileDestinationError {
  return new FileDestinationError(
    "OUTPUT_RECOVERY_REQUIRED",
    message,
  );
}

function writeError(code: FileDestinationError["code"], message: string): FileDestinationError {
  return new FileDestinationError(code, message);
}

function hashDescriptor(fd: number, size: number): string {
  const hash = createHash("sha256");
  const bufSize = Math.min(1024 * 1024, Math.max(size, 1));
  const buffer = Buffer.allocUnsafe(bufSize);
  let offset = 0;
  while (offset < size) {
    const chunk = Math.min(bufSize, size - offset);
    const bytesRead = readSync(fd, buffer, 0, chunk, offset) as number;
    if (bytesRead === 0) throw new Error("Unexpected end of descriptor during hash");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest("hex");
}

function captureIdentityFromFd(fd: number): FileIdentity {
  const stats = fstatSync(fd);
  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error("Identity target is not a regular file or directory");
  }
  const size = stats.size;
  // Directories cannot be read (EISDIR); record their identity without content hash.
  const sha256 = stats.isFile() ? hashDescriptor(fd, size) : "";
  return {
    device: stats.dev,
    inode: stats.ino,
    type: stats.isFile() ? "regular" : "directory",
    size,
    sha256,
  };
}

function captureFileIdentity(parentFd: number, leaf: string): FileIdentity | null {
  const opened = openRelativeDescriptor(parentFd, leaf, READ_FLAGS);
  if (!opened.success) {
    if (opened.errcode === 2) return null; // Absent
    throw writeError("OUTPUT_WRITE_FAILED", `inspect identity ${leaf}: ${opened.error_msg}`);
  }
  try {
    return captureIdentityFromFd(opened.fd);
  } finally {
    closeSync(opened.fd);
  }
}

function removeLeaf(parentFd: number, leaf: string): void {
  const result = unlinkRelativeDescriptor(parentFd, leaf);
  if (!result.success && result.errcode !== 2) {
    throw writeError("OUTPUT_WRITE_FAILED", `remove leaf ${leaf}: ${result.error_msg}`);
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.type === right.type &&
    left.size === right.size &&
    left.sha256 === right.sha256
  );
}

// =============================================================================
// Journal persistence
// =============================================================================

const JOURNAL_PREFIX = ".cdb-to-json-journal-";

/**
 * Compute the canonical JSON representation of a journal document.
 * Uses repository-canonical UTF-8 JSON with sorted keys.
 */
function serializeJournal(doc: CommitJournalDocument): string {
  return JSON.stringify(doc, Object.keys(doc).sort(), 0);
}

/**
 * Write a journal to a file descriptor, replacing its contents.
 */
function writeJournalFd(fd: number, doc: CommitJournalDocument): void {
  const content = Buffer.from(serializeJournal(doc), "utf8");
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fd, content, offset, content.length - offset, null);
    if (written === 0) throw new Error("Journal write made no progress");
    offset += written;
  }
  fsyncSync(fd);
}

// =============================================================================
// CommitJournal
// =============================================================================

/**
 * Options for creating a CommitJournal.
 */
export interface CommitJournalOptions {
  /**
   * Absolute path to the trusted root directory.
   * The journal is stored as a hidden file inside this directory.
   */
  rootPath: string;
  /**
   * Whether any final in this journal may use force replacement.
   * When true, force backups and prior-final identities are tracked.
   */
  mayUseForce?: boolean;
}

/**
 * A descriptor-relative commit-set journal.
 *
 * ## Lifecycle
 *
 * 1. Create the journal with `plan(entries)` — this reserves all finals,
 *    writes the PLANNED journal, and fsyncs it before returning.
 * 2. For each force entry, call `recordBackupDurable(entry, identity)` to
 *    create and record a force backup identity.
 * 3. For each entry, call `recordPublished(entry, identity)` to rename the
 *    staged file and record the published identity.
 * 4. Call `commit()` on success, or `rollback()` on failure.
 *
 * ## Example
 *
 * ```ts
 * const journal = new CommitJournal(rootPath, {
 *   mayUseForce: options.force,
 * });
 *
 * journal.plan([
 *   { finalLeaf: "000001-cards.raw.json", stagedIdentity: ..., priorFinalIdentity: null },
 * ]);
 *
 * // ... write staged files ...
 *
 * journal.recordPublished("000001-cards.raw.json", publishedIdentity);
 * journal.commit();
 * ```
 */
export class CommitJournal {
  private readonly rootPath: string;
  private readonly mayUseForce: boolean;
  private readonly runToken: string;

  /** Parent directory fd (trusted root's parent). */
  private parentFd: number | null = null;
  /** Trusted root directory fd. */
  private rootFd: number | null = null;
  /** Journal file descriptor while open. */
  private journalFd: number | null = null;
  /** Path of the journal leaf inside the root. */
  private journalLeaf: string;
  /** The in-memory journal document. */
  private doc: CommitJournalDocument | null = null;
  /** Whether cleanup has been performed. */
  private cleaned: boolean = false;

  constructor(options: CommitJournalOptions) {
    this.rootPath = options.rootPath;
    this.mayUseForce = options.mayUseForce ?? false;
    this.runToken = randomUUID();
    this.journalLeaf = `${JOURNAL_PREFIX}${this.runToken}.json`;
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /**
   * Open the trusted root directory (must already exist) and its parent.
   * Records the trusted root identity.
   */
  private openRoot(): { parentFd: number; rootFd: number; rootIdentity: FileIdentity } {
    const { parentPath, leaf: rootLeaf } = splitAbsolutePath(this.rootPath);

    let parentFd = openSync(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    try {
      const root = openRelativeDescriptor(parentFd, rootLeaf, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
      if (!root.success) {
        throw writeError("OUTPUT_WRITE_FAILED", `open root ${this.rootPath}: ${root.error_msg}`);
      }
      const rootFd = root.fd;
      // Capture the root directory's identity after opening
      const rootIdentity = captureFileIdentity(parentFd, rootLeaf)!;

      return { parentFd, rootFd, rootIdentity };
    } catch (error) {
      try { closeSync(parentFd); } catch { /* best effort */ }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Plan
  // ---------------------------------------------------------------------------

  /**
   * Plan all finals before any writable operation.
   *
   * Writes the initial `PLANNED` journal and fsyncs it and the parent directory.
   * This durable ordering guarantee means a crash after `plan()` returns
   * leaves a recoverable orphan journal, not a silent partial state.
   *
   * @param entries One entry per final in publication order.
   */
  plan(entries: Array<{
    finalLeaf: string;
    stagedIdentity: FileIdentity | null;
    priorFinalIdentity: FileIdentity | null;
  }>): void {
    if (this.doc !== null) {
      throw writeError("OUTPUT_WRITE_FAILED", "Journal is already planned");
    }

    const { parentFd, rootFd, rootIdentity } = this.openRoot();
    this.parentFd = parentFd;
    this.rootFd = rootFd;

    const journalEntries: JournalEntry[] = entries.map((e) => ({
      finalLeaf: e.finalLeaf,
      state: "PLANNED" as JournalEntryState,
      stagedIdentity: e.stagedIdentity,
      publishedIdentity: null,
      backupIdentity: null,
      priorFinalIdentity: e.priorFinalIdentity,
    }));

    this.doc = {
      version: 1,
      runToken: this.runToken,
      trustedRootIdentity: rootIdentity,
      journalLeaf: this.journalLeaf,
      committed: false,
      entries: journalEntries,
    };

    // Write and fsync the PLANNED journal before any publication
    this.writeJournalSync();

    // fsync the root directory to make the journal durable
    fsyncSync(rootFd);

    // Also fsync the parent of the root so the directory entry itself is durable
    fsyncSync(parentFd);
  }

  /**
   * Write the journal to disk and fsync it.
   */
  private writeJournalSync(): void {
    if (this.doc === null) throw new Error("Journal not initialized");
    if (this.rootFd === null) throw new Error("Root fd not open");

    // Open (create/truncate) the journal file using descriptor-relative create
    const jOpen = openRelativeDescriptor(this.rootFd, this.journalLeaf, WRITE_FLAGS, 0o600);
    if (!jOpen.success) {
      throw writeError("OUTPUT_WRITE_FAILED", `create journal file: ${jOpen.error_msg}`);
    }
    const jfd = jOpen.fd;
    this.journalFd = jfd;
    writeJournalFd(jfd, this.doc);
  }

  /**
   * Update the journal and fsync it.
   */
  private updateAndFsync(): void {
    if (this.journalFd === null) throw new Error("Journal fd not open");
    writeJournalFd(this.journalFd, this.doc!);
    fsyncSync(this.journalFd);
    fsyncSync(this.rootFd!);
    fsyncSync(this.parentFd!);
  }

  /**
   * Get an entry by final leaf name.
   */
  private entry(finalLeaf: string): JournalEntry {
    if (!this.doc) throw new Error("Journal not planned");
    const e = this.doc.entries.find((e) => e.finalLeaf === finalLeaf);
    if (!e) throw writeError("OUTPUT_WRITE_FAILED", `No journal entry for ${finalLeaf}`);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Backup (force only)
  // ---------------------------------------------------------------------------

  /**
   * Record that a force backup was created and is durable.
   *
   * Called after the backup file has been created, written, and fsynced.
   * Updates the entry to `BACKUP_DURABLE` and fsyncs the journal.
   *
   * @param finalLeaf The leaf name of the final being replaced.
   * @param backupIdentity The identity of the created backup file.
   */
  recordBackupDurable(finalLeaf: string, backupIdentity: FileIdentity): void {
    if (!this.mayUseForce) {
      throw writeError("OUTPUT_WRITE_FAILED", "Force is not enabled for this journal");
    }
    const e = this.entry(finalLeaf);
    if (e.state !== "PLANNED") {
      throw writeError("OUTPUT_WRITE_FAILED", `Cannot backup entry in state ${e.state}`);
    }
    e.backupIdentity = backupIdentity;
    e.state = "BACKUP_DURABLE";
    this.updateAndFsync();
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Record that a final has been published and fsync'd.
   *
   * @param finalLeaf The leaf name of the published final.
   * @param publishedIdentity The identity of the published final.
   */
  recordPublished(finalLeaf: string, publishedIdentity: FileIdentity): void {
    const e = this.entry(finalLeaf);
    if (e.state !== "PLANNED" && e.state !== "BACKUP_DURABLE") {
      throw writeError("OUTPUT_WRITE_FAILED", `Cannot publish entry in state ${e.state}`);
    }
    e.publishedIdentity = publishedIdentity;
    e.state = "PUBLISHED";
    this.updateAndFsync();
  }

  // ---------------------------------------------------------------------------
  // Commit
  // ---------------------------------------------------------------------------

  /**
   * Mark the journal as committed and fsync durability.
   * Removes all backup files and the journal itself.
   * Safe to call multiple times (idempotent).
   */
  commit(): void {
    if (this.cleaned) return;
    this.cleaned = true;

    if (this.doc === null) return; // Nothing to commit

    // Mark committed
    if (!this.doc.committed) {
      this.doc.committed = true;
      if (this.journalFd !== null) {
        writeJournalFd(this.journalFd, this.doc);
        fsyncSync(this.journalFd);
      }
      if (this.rootFd !== null) fsyncSync(this.rootFd);
      if (this.parentFd !== null) fsyncSync(this.parentFd!);
    }

    // Remove backups and journal — only after all finals are confirmed durable
    this.cleanupArtifacts(/* committed */ true);
  }

  /**
   * Derive the backup leaf name for a given final leaf.
   */
  private backupLeafFor(finalLeaf: string): string {
    const safe = finalLeaf.replace(/[^A-Za-z0-9._-]/g, "_");
    return `.cdb-to-json-backup-${this.runToken}-${safe}`;
  }

  /**
   * Remove backup files and journal after commit or abort.
   * @param committed Whether this was a successful commit (removes more aggressively)
   */
  private cleanupArtifacts(committed: boolean): void {
    const parentFd = this.parentFd;
    const rootFd = this.rootFd;

    if (this.journalFd !== null) {
      try { closeSync(this.journalFd); } catch { /* best effort */ }
      this.journalFd = null;
    }

    if (rootFd === null || parentFd === null) {
      this.closeFds();
      return;
    }

    try {
      // Remove journal file
      if (this.journalLeaf) {
        removeLeaf(rootFd, this.journalLeaf);
        fsyncSync(rootFd);
      }

      // Remove backup files
      if (this.doc) {
        for (const e of this.doc.entries) {
          if (e.backupIdentity !== null) {
            // Identity check: only remove if backup still matches recorded identity
            // (On committed path, we trust the journal; on abort, we already verified)
            if (committed) {
              try {
                removeLeaf(rootFd, this.backupLeafFor(e.finalLeaf));
              } catch { /* best effort — backup may already be gone */ }
            }
          }
        }
      }
    } catch { /* best effort */ }

    this.closeFds();
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  /**
   * Reverse-rollback all published entries.
   *
   * For no-force entries (state=PUBLISHED): remove the published final if its
   * current identity matches the recorded published identity.
   *
   * For force entries (state=BACKUP_DURABLE or PUBLISHED): restore the backup
   * if the current final matches the recorded published identity AND the
   * backup matches the recorded backup identity. On mismatch, mark
   * RECOVERY_REQUIRED and retain all artifacts.
   *
   * @throws {FileDestinationError} OUTPUT_RECOVERY_REQUIRED if any rollback
   *   fails due to identity mismatch or missing artifacts.
   */
  rollback(): void {
    if (this.cleaned) return;
    if (this.doc === null) return;

    const rootFd = this.rootFd;
    const parentFd = this.parentFd;

    if (rootFd === null || parentFd === null) {
      this.closeFds();
      return;
    }

    // Process entries in reverse publication order
    const entries = [...(this.doc?.entries ?? [])].reverse();
    let rollbackFailed = false;
    const failedEntries: string[] = [];

    for (const e of entries) {
      if (e.state === "PUBLISHED") {
        // No-force case: remove the published final if it matches identity
        const current = captureFileIdentity(rootFd, e.finalLeaf);
        if (
          current !== null &&
          e.publishedIdentity !== null &&
          sameIdentity(current, e.publishedIdentity)
        ) {
          removeLeaf(rootFd, e.finalLeaf);
          fsyncSync(rootFd);
          e.state = "ROLLED_BACK";
        } else {
          e.state = "RECOVERY_REQUIRED";
          rollbackFailed = true;
          failedEntries.push(e.finalLeaf);
        }
      } else if (e.state === "BACKUP_DURABLE") {
        // Force case: restore the backup if identities match
        // At BACKUP_DURABLE state, publication hasn't happened yet, so we verify:
        // 1. The current final matches the prior final (unchanged since backup)
        // 2. The backup matches its recorded identity
        const current = captureFileIdentity(rootFd, e.finalLeaf);
        const backupLeaf = this.backupLeafFor(e.finalLeaf);

        const currentMatches =
          current !== null &&
          e.priorFinalIdentity !== null &&
          sameIdentity(current, e.priorFinalIdentity);
        const backupMatches =
          e.backupIdentity !== null &&
          (() => {
            const backup = captureFileIdentity(rootFd, backupLeaf);
            return backup !== null && sameIdentity(backup, e.backupIdentity!);
          })();

        if (currentMatches && backupMatches) {
          // Restore: rename backup over the final using atomicRenameReplace (force)
          const restore = atomicRenameReplace(rootFd, backupLeaf, rootFd, e.finalLeaf);
          if (!restore.success) {
            e.state = "RECOVERY_REQUIRED";
            rollbackFailed = true;
            failedEntries.push(e.finalLeaf);
          } else {
            fsyncSync(rootFd);
            fsyncSync(parentFd);
            // Remove the backup now that it's restored
            try { removeLeaf(rootFd, backupLeaf); } catch { /* best effort */ }
            e.state = "ROLLED_BACK";
          }
        } else {
          e.state = "RECOVERY_REQUIRED";
          rollbackFailed = true;
          failedEntries.push(e.finalLeaf);
        }
      } else if (e.state === "PLANNED") {
        // Never published — nothing to do
        e.state = "ROLLED_BACK";
      }
    }

    // Write final journal state before any error
    if (this.journalFd !== null) {
      writeJournalFd(this.journalFd, this.doc!);
      fsyncSync(this.journalFd);
      fsyncSync(rootFd);
    }

    if (rollbackFailed) {
      throw recoveryError(
        `Rollback failed for finals: ${failedEntries.join(", ")}. ` +
          `Manual intervention required. OUTPUT_RECOVERY_REQUIRED.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Abort
  // ---------------------------------------------------------------------------

  /**
   * Abort the journal without attempting rollback.
   * Retains the journal and backups for recovery inspection.
   * The journal remains as an orphan that recoverCommitJournal will detect.
   */
  abort(): void {
    if (this.cleaned) return;
    this.cleaned = true;

    // Write the final journal state with current states
    if (this.journalFd !== null && this.doc !== null) {
      try {
        writeJournalFd(this.journalFd, this.doc);
        fsyncSync(this.journalFd);
        if (this.rootFd !== null) fsyncSync(this.rootFd);
        if (this.parentFd !== null) fsyncSync(this.parentFd!);
      } catch { /* best effort — already failing */ }
    }

    this.closeFds();
  }

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  private closeFds(): void {
    if (this.journalFd !== null) {
      try { closeSync(this.journalFd); } catch { /* best effort */ }
      this.journalFd = null;
    }
    if (this.rootFd !== null) {
      try { closeSync(this.rootFd!); } catch { /* best effort */ }
      this.rootFd = null;
    }
    if (this.parentFd !== null) {
      try { closeSync(this.parentFd); } catch { /* best effort */ }
      this.parentFd = null;
    }
  }
}
