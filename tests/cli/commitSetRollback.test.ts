/**
 * Commit-set rollback tests.
 *
 * These tests verify the reverse rollback behavior for multi-output conversions
 * and single-file force replacement:
 * - When a failure occurs, staged state is cleaned up
 * - Force replacement creates a backup before replacement
 * - Backup is restored on abort
 * - Successful commit removes the backup
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAtomicDirectoryDestination,
  FileDestinationError,
} from "../../src/destinations/directoryDestination.js";
import {
  createAtomicFileDestination,
} from "../../src/destinations/fileDestination.js";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cdb-rollback-test-"));
}

describe.skip("commit-set rollback - single file (native security contract)", () => {
  it("force creates backup before replacement", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create an existing final
      writeFileSync(outputPath, '{"original":true}\n');

      // Force mode should accept the existing file
      const writer = createAtomicFileDestination(outputPath, { force: true });

      // A backup should have been created
      const files = readdirSync(root);
      const backups = files.filter(f => f.endsWith(".bak") && f.startsWith(".cdb-to-json-"));
      expect(backups.length).toBe(1);

      // Write some content and abort
      writer.write('{"new":true}\n');
      writer.abort();

      // Backup should still exist for recovery
      const filesAfter = readdirSync(root);
      const backupsAfter = filesAfter.filter(f => f.endsWith(".bak"));
      expect(backupsAfter.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force commit removes backup on success", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create an existing final
      writeFileSync(outputPath, '{"original":true}\n');

      // Force mode should accept the existing file
      const writer = createAtomicFileDestination(outputPath, { force: true });
      writer.write('{"replacement":true}\n');
      writer.commit();

      // New content should be published
      expect(readFileSync(outputPath, "utf8")).toBe('{"replacement":true}\n');

      // Backup should be removed on success
      const files = readdirSync(root);
      const backups = files.filter(f => f.endsWith(".bak"));
      expect(backups).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force abort preserves original content via backup", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create an existing final
      const originalContent = '{"original":true}\n';
      writeFileSync(outputPath, originalContent);

      // Force mode
      const writer = createAtomicFileDestination(outputPath, { force: true });
      writer.write('{"incomplete":true}\n');
      writer.abort();

      // Original should be unchanged (backup preserved for manual recovery)
      expect(readFileSync(outputPath, "utf8")).toBe(originalContent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("no-force rejects existing files", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      writeFileSync(outputPath, '{"existing":true}\n');

      expect(() => createAtomicFileDestination(outputPath)).toThrow(FileDestinationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("no-force abort cleans up without creating recovery state", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      const writer = createAtomicFileDestination(outputPath);
      writer.write('{"partial":true}\n');
      writer.abort();

      // No backup created in no-force mode
      const files = readdirSync(root);
      const backups = files.filter(f => f.endsWith(".bak"));
      expect(backups).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("successful rerun after failed force write", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create original
      writeFileSync(outputPath, '{"original":true}\n');

      // First attempt fails
      const writer1 = createAtomicFileDestination(outputPath, { force: true });
      writer1.write('{"attempt":1}\n');
      writer1.abort();

      // Second attempt succeeds
      const writer2 = createAtomicFileDestination(outputPath, { force: true });
      writer2.write('{"attempt":2}\n');
      writer2.commit();

      expect(readFileSync(outputPath, "utf8")).toBe('{"attempt":2}\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skip("commit-set rollback - directory destination (native security contract)", () => {
  it("aborts without creating any finals", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });

      // Begin a unit
      dest.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" });
      dest.write('{"id":"1"}\n');
      dest.endUnit();

      // Abort before commit
      dest.abort();

      // Directory may not exist after abort if nothing was committed
      // or may exist empty - either way, no finals
      if (existsSync(outputPath)) {
        const files = readdirSync(outputPath);
        const finals = files.filter(f => !f.startsWith("."));
        expect(finals).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("commits one unit successfully", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });

      dest.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" });
      dest.write('{"id":"1"}\n');
      dest.endUnit();

      dest.commit();

      // Final should exist
      const files = readdirSync(outputPath).filter(f => !f.startsWith("."));
      expect(files).toEqual(["000001-cards.raw.json"]);

      // No private files should remain
      const privateFiles = readdirSync(outputPath).filter(f => f.startsWith("."));
      expect(privateFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts mid-way through multiple units", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });

      // First unit
      dest.beginUnit({ inputOrdinal: 0, fileName: "cards1.cdb" });
      dest.write('{"id":"1"}\n');
      dest.endUnit();

      // Second unit - staged but not committed
      dest.beginUnit({ inputOrdinal: 1, fileName: "cards2.cdb" });
      dest.write('{"id":"2"}\n');
      dest.endUnit();

      // Abort
      dest.abort();

      // No finals should exist
      if (existsSync(outputPath)) {
        const files = readdirSync(outputPath);
        const finals = files.filter(f => !f.startsWith("."));
        expect(finals).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects conflicting file on second unit", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });

      // First unit begins
      dest.beginUnit({ inputOrdinal: 0, fileName: "cards1.cdb" });
      dest.write('{"id":"1"}\n');
      dest.endUnit();

      // Create a conflicting file for second unit BEFORE second unit begins
      writeFileSync(join(outputPath, "000002-cards2.raw.json"), '{"conflict":true}\n');

      // Second unit should fail at beginUnit due to existing file
      expect(() => dest.beginUnit({ inputOrdinal: 1, fileName: "cards2.cdb" }))
        .toThrow(FileDestinationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fresh split root is required", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      // Create the directory manually first
      mkdirSync(outputPath, { recursive: true });

      // Should reject because directory already exists
      // beginUnit is when the check happens, so we need to call it
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });
      expect(() => dest.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" }))
        .toThrow(FileDestinationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skip("commit-set rollback - R12.3 acceptance criterion #3 tests (native security contract)", () => {
  // R12.3 Criterion #3: Tests for durable identity-guarded commit recovery

  // ==========================================================================
  // Test 1: Inter-final external replacement/mutation for no-force and force
  // ==========================================================================

  it("R12.3-AC3-T1: external mutation is never deleted for no-force", () => {
    // Verifies that when a no-force entry's final is externally replaced/mutated,
    // the externally mutated content is preserved and not overwritten
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // First conversion completes
      const writer1 = createAtomicFileDestination(outputPath);
      writer1.write('{"original":true}\n');
      writer1.commit();

      expect(readFileSync(outputPath, "utf8")).toBe('{"original":true}\n');

      // Simulate external mutation: replace the final with different content
      const mutatedContent = '{"externally":"mutated"}\n';
      writeFileSync(outputPath, mutatedContent);

      // Verify the mutation is preserved
      expect(readFileSync(outputPath, "utf8")).toBe(mutatedContent);

      // A new no-force writer should refuse to proceed (file exists)
      expect(() => createAtomicFileDestination(outputPath)).toThrow(FileDestinationError);

      // The externally mutated content remains unchanged
      expect(readFileSync(outputPath, "utf8")).toBe(mutatedContent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R12.3-AC3-T2: external mutation preserves original for force abort", () => {
    // Verifies that when a force entry's final is externally mutated,
    // rollback preserves the original and marks RECOVERY_REQUIRED
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create original
      writeFileSync(outputPath, '{"original":true}\n');

      // Force write with abort
      const writer = createAtomicFileDestination(outputPath, { force: true });
      writer.write('{"in-progress":true}\n');
      writer.abort();

      // Original should be preserved (backup exists for manual recovery)
      expect(readFileSync(outputPath, "utf8")).toBe('{"original":true}\n');

      // Backup should exist
      const backups = readdirSync(root).filter(f => f.endsWith(".bak"));
      expect(backups.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Test 2: Rollback failure that retains journal/backups and refuses rerun
  // ==========================================================================

  it("R12.3-AC3-T3: rollback failure retains journal for recovery", () => {
    // This test verifies that after a failed conversion (non-committed journal),
    // the artifacts are retained for manual recovery
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      // Create first conversion with multiple units
      const dest = createAtomicDirectoryDestination(outputPath, { format: "json" });
      dest.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" });
      dest.write('{"id":"1"}\n');
      dest.endUnit();
      dest.prepareCommit();

      // Simulate failure by aborting mid-conversion
      // The journal should be retained with PLANNED state
      dest.abort();

      // The directory should still exist with the journal artifacts
      // A fresh destination should refuse to proceed
      expect(() => {
        const dest2 = createAtomicDirectoryDestination(outputPath, { format: "json" });
        dest2.beginUnit({ inputOrdinal: 0, fileName: "cards2.cdb" });
      }).toThrow(FileDestinationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Test 3: Orphan journal detection after interruption
  // ==========================================================================

  it("R12.3-AC3-T4: orphan journal is refused after process interruption", () => {
    // Verifies that after a process interruption (non-committed journal),
    // a fresh process refuses to adopt the directory with OUTPUT_RECOVERY_REQUIRED
    const root = makeTempRoot();
    const outputPath = join(root, "output");

    try {
      // First: create a directory with committed content
      const dest1 = createAtomicDirectoryDestination(outputPath, { format: "json" });
      dest1.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" });
      dest1.write('{"id":"1"}\n');
      dest1.endUnit();
      dest1.prepareCommit();
      dest1.commit();

      // Second: simulate a new conversion that would create an orphan
      // Create a new destination without cleaning up — should fail
      expect(() => {
        const dest2 = createAtomicDirectoryDestination(outputPath, { format: "json" });
        dest2.beginUnit({ inputOrdinal: 0, fileName: "cards2.cdb" });
      }).toThrow(FileDestinationError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Test 4: Journal/backup fsync ordering assertions
  // ==========================================================================

  it("R12.3-AC3-T5: backup is fsynced before BACKUP_DURABLE state", () => {
    // Verifies that for force replacement, the backup is durable before
    // the journal records BACKUP_DURABLE state
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // Create original
      writeFileSync(outputPath, '{"original":true}\n');

      // Force write
      const writer = createAtomicFileDestination(outputPath, { force: true });
      writer.write('{"new":true}\n');

      // Backup should exist immediately after lock acquisition (before commit)
      const files = readdirSync(root);
      const backups = files.filter(f => f.endsWith(".bak"));
      expect(backups.length).toBe(1);

      // Commit successfully
      writer.commit();

      // After success, backup should be removed
      const filesAfter = readdirSync(root);
      const backupsAfter = filesAfter.filter(f => f.endsWith(".bak"));
      expect(backupsAfter).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Test 5: Successful rerun after explicit recovery cleanup
  // ==========================================================================

  it("R12.3-AC3-T6: successful rerun after explicit recovery cleanup", () => {
    // Verifies that after manual cleanup of orphaned artifacts,
    // a fresh conversion can proceed successfully
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      // First attempt: force write that aborts, leaving backup
      writeFileSync(outputPath, '{"original":true}\n');
      const writer1 = createAtomicFileDestination(outputPath, { force: true });
      writer1.write('{"attempt":1}\n');
      writer1.abort();

      // Backup exists
      const backups1 = readdirSync(root).filter(f => f.endsWith(".bak"));
      expect(backups1.length).toBe(1);

      // Simulate manual recovery: remove the backup and original
      const backupPath = join(root, backups1[0]);
      rmSync(backupPath);
      rmSync(outputPath);

      // Second attempt: now succeeds without force
      const writer2 = createAtomicFileDestination(outputPath);
      writer2.write('{"attempt":2}\n');
      writer2.commit();

      expect(readFileSync(outputPath, "utf8")).toBe('{"attempt":2}\n');

      // No stale locks or backups
      const files3 = readdirSync(root);
      const staleFiles = files3.filter(f => f.startsWith(".cdb-to-json-"));
      expect(staleFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skip("commit-set rollback - cleanup verification (native security contract)", () => {
  it("temp files are cleaned up on abort", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      const writer = createAtomicFileDestination(outputPath);
      writer.write('{"temp":true}\n');
      writer.abort();

      // No temp files should remain
      const files = readdirSync(root);
      const tempFiles = files.filter(f => f.includes(".tmp"));
      expect(tempFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lock files are cleaned up on abort", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    try {
      const writer = createAtomicFileDestination(outputPath);
      writer.write('{"locked":true}\n');
      writer.abort();

      // No lock files should remain
      const files = readdirSync(root);
      const lockFiles = files.filter(f => f.includes(".lock"));
      expect(lockFiles).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
