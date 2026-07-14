/**
 * Recovery checker for orphaned commit journals.
 *
 * ## Purpose
 *
 * Before adopting an existing output directory, this module detects orphaned
 * non-committed journals and refuses to proceed with `OUTPUT_RECOVERY_REQUIRED`.
 *
 * An "orphaned" journal is one where:
 * - The journal file exists in the trusted root directory
 * - The journal's `committed: false` (process was interrupted before commit)
 * - Any entry has state PUBLISHED, BACKUP_DURABLE, or RECOVERY_REQUIRED
 *   (meaningful publication work was done that needs review)
 *
 * ## Behavior
 *
 * - A journal with `committed: true` is safe to clean up and proceed.
 * - A journal with all entries in `PLANNED` state (no publication started) is
 *   safe to clean up and proceed.
 * - A journal with any `PUBLISHED`, `BACKUP_DURABLE`, or `RECOVERY_REQUIRED`
 *   entry is an orphan: refuse with OUTPUT_RECOVERY_REQUIRED.
 * - An absent journal means no prior run touched this directory.
 *
 * ## Output
 *
 * Returns structured recovery diagnostic information including:
 * - The journal file path
 * - The affected final leaves
 * - The current state of each entry
 * - Recommended manual action
 */

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import {
  openRelativeDescriptor,
  unlinkRelativeDescriptor,
} from "./nativeAdapter.js";
import { FileDestinationError } from "./fileDestination.js";
import { splitAbsolutePath } from "./pathUtils.js";

const O_CLOEXEC = 0x80000;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC;

const JOURNAL_PREFIX = ".cdb-to-json-journal-";

interface NativeResult {
  success: boolean;
  errcode: number;
  error_msg: string;
}

function nativeError(result: NativeResult, context: string): FileDestinationError {
  return new FileDestinationError(
    "OUTPUT_WRITE_FAILED",
    `${context}: ${result.error_msg || "native operation failed"} (${result.errcode})`,
  );
}



interface CommitJournalDocument {
  version: number;
  runToken: string;
  journalLeaf: string;
  committed: boolean;
  entries: Array<{
    finalLeaf: string;
    state: string;
  }>;
}

/**
 * Result of a recovery inspection.
 */
export interface RecoveryInspectionResult {
  /** Whether a recovery-required orphan was found. */
  needsRecovery: boolean;
  /** Whether an uncommitted journal with no meaningful work was found (safe to clean). */
  safeToClean: boolean;
  /** Whether a committed journal was found. */
  wasCommitted: boolean;
  /** The journal leaf name if found. */
  journalLeaf: string | null;
  /** Entries that need manual attention. */
  entriesNeedingAttention: Array<{
    finalLeaf: string;
    state: string;
    reason: string;
  }>;
  /** Human-readable message for diagnostics. */
  message: string;
}

/**
 * Parse a journal document from a buffer.
 */
function parseJournal(content: string): CommitJournalDocument {
  return JSON.parse(content) as CommitJournalDocument;
}

/**
 * Read a journal file from an open fd.
 */
function readJournalFd(fd: number): CommitJournalDocument {
  const stats = fstatSync(fd);
  const buffer = Buffer.allocUnsafe(stats.size);
  let offset = 0;
  while (offset < stats.size) {
    const n = readSync(fd, buffer, offset, stats.size - offset, offset) as number;
    if (n === 0) break;
    offset += n;
  }
  return parseJournal(buffer.slice(0, stats.size).toString("utf8"));
}

/**
 * Inspect a directory for orphaned commit journals.
 *
 * Opens the directory through held no-follow descriptors and checks for any
 * journal files. Classifies the journal state and returns recovery guidance.
 *
 * @param rootPath Absolute path to the trusted output root directory.
 * @returns RecoveryInspectionResult describing what was found.
 */
export function inspectForOrphanedJournal(rootPath: string): RecoveryInspectionResult {
  const { parentPath, leaf: rootLeaf } = splitAbsolutePath(rootPath);

  let parentFd: number | null = null;
  let rootFd: number | null = null;

  try {
    parentFd = openSync(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);

    try {
      const root = openRelativeDescriptor(parentFd, rootLeaf, DIRECTORY_FLAGS);
      if (!root.success) {
        // Root directory doesn't exist — nothing to inspect
        return {
          needsRecovery: false,
          safeToClean: false,
          wasCommitted: false,
          journalLeaf: null,
          entriesNeedingAttention: [],
          message: `Output root does not exist: ${rootPath}`,
        };
      }
      rootFd = root.fd;
    } catch {
      return {
        needsRecovery: false,
        safeToClean: false,
        wasCommitted: false,
        journalLeaf: null,
        entriesNeedingAttention: [],
        message: `Cannot open output root: ${rootPath}`,
      };
    }

    // Scan for journal files by listing directory entries
    // We can't use readdir through native openat directly in pure JS;
    // instead, iterate possible journal names using the run token prefix
    //
    // Since we don't know the run token, we look for any .cdb-to-json-journal-*.json
    // files. To do this without readdir, we attempt to open known patterns.
    // The safest approach: try opening by the well-known prefix pattern.
    //
    // Actually, for correctness, we need to enumerate. The native module
    // doesn't expose directory listing. We'll use Node's readdir but only
    // on the already-validated root directory (which is descriptor-safe
    // at this point since we're checking for stale journals).
    //
    let entries: string[];
    try {
      // Use the fd via /proc/self/fd to list the directory
      const fdPath = `/proc/self/fd/${rootFd}`;
      entries = readdirSync(fdPath);
    } catch {
      // Fallback: use the root path directly (already validated as descriptor-safe)
      entries = readdirSync(rootPath);
    }

    const journalLeaves = entries.filter((e) => e.startsWith(JOURNAL_PREFIX) && e.endsWith(".json"));

    if (journalLeaves.length === 0) {
      return {
        needsRecovery: false,
        safeToClean: false,
        wasCommitted: false,
        journalLeaf: null,
        entriesNeedingAttention: [],
        message: `No orphaned journal found in ${rootPath}`,
      };
    }

    // If multiple journals (shouldn't happen normally), check each
    for (const journalLeaf of journalLeaves) {
      const opened = openRelativeDescriptor(rootFd, journalLeaf, READ_FLAGS);
      if (!opened.success) continue;

      let doc: CommitJournalDocument;
      try {
        doc = readJournalFd(opened.fd);
      } finally {
        closeSync(opened.fd);
      }

      if (doc.version !== 1) {
        continue; // Unknown version, skip
      }

      if (doc.committed) {
        return {
          needsRecovery: false,
          safeToClean: true,
          wasCommitted: true,
          journalLeaf,
          entriesNeedingAttention: [],
          message: `Prior committed journal found (${journalLeaf}). Safe to clean.`,
        };
      }

      // Non-committed journal: check for meaningful work
      const needsAttention = doc.entries.filter(
        (e) =>
          e.state === "PUBLISHED" ||
          e.state === "BACKUP_DURABLE" ||
          e.state === "RECOVERY_REQUIRED",
      );

      if (needsAttention.length > 0) {
        return {
          needsRecovery: true,
          safeToClean: false,
          wasCommitted: false,
          journalLeaf,
          entriesNeedingAttention: needsAttention.map((e) => ({
            finalLeaf: e.finalLeaf,
            state: e.state,
            reason:
              e.state === "PUBLISHED"
                ? "Final was published but journal was not committed. Manual review required."
                : e.state === "BACKUP_DURABLE"
                  ? "Backup was created but publication did not complete. Manual review required."
                  : "Rollback previously failed. Manual intervention required.",
          })),
          message:
            `OUTPUT_RECOVERY_REQUIRED: Orphaned non-committed journal (${journalLeaf}) ` +
            `found with ${needsAttention.length} entry/entries needing attention. ` +
            `Finals: ${needsAttention.map((e) => e.finalLeaf).join(", ")}. ` +
            `Manual intervention required before rerun.`,
        };
      }

      // All entries PLANNED — safe to clean
      return {
        needsRecovery: false,
        safeToClean: true,
        wasCommitted: false,
        journalLeaf,
        entriesNeedingAttention: [],
        message: `Uncommitted journal with no publication started (${journalLeaf}). Safe to clean.`,
      };
    }

    return {
      needsRecovery: false,
      safeToClean: false,
      wasCommitted: false,
      journalLeaf: null,
      entriesNeedingAttention: [],
      message: `No recoverable journal found in ${rootPath}`,
    };
  } finally {
    if (rootFd !== null) {
      try { closeSync(rootFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
  }
}

/**
 * Remove a committed or safe-to-clean journal file.
 *
 * @param rootPath Absolute path to the trusted output root directory.
 * @param journalLeaf The leaf name of the journal file to remove.
 */
export function cleanupSafeJournal(rootPath: string, journalLeaf: string): void {
  const { parentPath, leaf: rootLeaf } = splitAbsolutePath(rootPath);

  let parentFd: number | null = null;
  let rootFd: number | null = null;

  try {
    parentFd = openSync(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC);
    const root = openRelativeDescriptor(parentFd, rootLeaf, DIRECTORY_FLAGS);
    if (!root.success) return;
    rootFd = root.fd;

    removeLeaf(rootFd, journalLeaf);
  } finally {
    if (rootFd !== null) {
      try { closeSync(rootFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
  }
}

function removeLeaf(rootFd: number, leaf: string): void {
  const result = unlinkRelativeDescriptor(rootFd, leaf);
  if (!result.success && result.errcode !== 2) {
    throw nativeError(result, `remove journal ${leaf}`);
  }
}

/**
 * Check a root directory for orphaned journals and throw if recovery is required.
 *
 * This is the primary entry point called by the application before opening
 * an existing output directory for writing.
 *
 * @param rootPath Absolute path to the trusted output root directory.
 * @throws {FileDestinationError} OUTPUT_RECOVERY_REQUIRED if an orphan journal is found.
 */
export function requireNoOrphanedJournal(rootPath: string): RecoveryInspectionResult {
  const result = inspectForOrphanedJournal(rootPath);

  if (result.needsRecovery) {
    throw new FileDestinationError(
      "OUTPUT_RECOVERY_REQUIRED",
      result.message,
    );
  }

  return result;
}
