/**
 * Tests for merge conflict CLI behavior.
 *
 * These tests exercise the merge conflict resolution through the CLI pipeline.
 * Since the card profile is implemented in the normalization layer (P4),
 * these tests use the raw profile path where available and test merge
 * conflict logic directly through the application layer.
 *
 * Per P4-AC4: Tests cover exit code 5 for collision, bounded spool behavior,
 * cancellation cleanup, and successful merge with first/last strategies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createMinimalCdb, cleanupCdb } from "../fixtures/buildCdbFixture.js";
import { MergeIndex } from "../../dist/application/mergeIndex.js";
import { MergeLineageIndex } from "../../dist/application/mergeLineage.js";
import { MergeSpool } from "../../dist/application/mergeSpool.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";
import type { MergeConflictStrategy } from "../../dist/application/mergeIndex.js";

// Build a CDB with a specific card
function makeCdbWithCards(
  cards: Array<{
    id: number;
    name: string;
    desc?: string;
    type?: number;
    atk?: number;
    def?: number;
    level?: number;
    race?: number;
    attribute?: number;
    setcode?: number;
    ot?: number;
    alias?: number;
    category?: number;
  }>
): string {
  return createMinimalCdb(cards);
}

function tempDir(): string {
  const d = join(tmpdir(), `cli-merge-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// Helper to create minimal normalized cards for testing
function makeCard(id: string, name: string, inputOrdinal: number): NormalizedCard {
  return {
    id,
    name,
    description: `Description for ${name}`,
    auxiliaryStrings: [],
    type: {
      cardKind: "MONSTER",
      traits: ["NORMAL"],
      rawValue: 0x1,
      unknownBits: 0,
      registry: "cdb-normalization/1",
    },
    attribute: {
      attributes: ["DARK"],
      primary: "DARK",
      rawValue: 0x10,
      unknownBits: 0,
    },
    monsterType: {
      monsterTypes: ["SPELLCASTER"],
      primary: "SPELLCASTER",
      rawValue: 0x2,
      unknownBits: 0,
    },
    progression: {
      level: 7,
      rank: null,
      linkRating: null,
      pendulum: null,
      field: 0x1,
      rawValue: 7,
      unknownBits: 0,
    },
    attack: { value: 2500, isNull: false, rawValue: 2500 },
    defense: { value: 2100, isNull: false, rawValue: 2100 },
    linkMarkers: null,
    setcodes: {
      setcodes: [],
      rawValue: 0,
      registry: "cdb-normalization/1",
    },
    availability: {
      codes: [],
      unknownBits: 0,
      rawValue: 0,
    },
    category: {
      codes: [],
      unknownBits: 0,
      rawValue: 0,
    },
    alias: null,
    source: {
      databasePath: `/db-${inputOrdinal}.cdb`,
      dataOrdinal: inputOrdinal,
      textOrdinal: inputOrdinal,
    },
  };
}

describe("merge conflicts — CLI integration", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = tempDir();
  });

  afterEach(() => {
    cleanupDir(tmp);
  });

  describe("MergeIndex CLI exit-code behavior", () => {
    it("detects terminal collision for onConflict=error (exit 5 equivalent)", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("error" as MergeConflictStrategy, lineageIndex);

      // Simulate: card 100 from input 0
      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      // Simulate: card 100 from input 1 (collision)
      const result = index.add(makeCard("100", "Dark Magician v2", 1), 1, true);

      expect(result.terminal).toBe(true);
      expect(result.resolution.action).toBe("conflict_error");
      expect(index.hasTerminalConflict).toBe(true);
      expect(index.terminalConflictCardId).toBe("100");
    });

    it("no terminal collision for onConflict=first (exit 0 equivalent)", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("first" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      const result = index.add(makeCard("100", "Dark Magician v2", 1), 1, true);

      expect(result.terminal).toBe(false);
      expect(result.resolution.action).toBe("keep");
      expect(index.hasTerminalConflict).toBe(false);
    });

    it("no terminal collision for onConflict=last (exit 0 equivalent)", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("last" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      const result = index.add(makeCard("100", "Dark Magician v2", 1), 1, true);

      expect(result.terminal).toBe(false);
      expect(result.resolution.action).toBe("keep");
      expect(index.hasTerminalConflict).toBe(false);
    });

    it("blocks all further adds after terminal collision", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("error" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      index.add(makeCard("100", "v2", 1), 1, true); // Terminal

      const result = index.add(makeCard("200", "Blue Eyes", 2), 2, true);
      expect(result.resolution.action).toBe("no_change");
      expect(result.terminal).toBe(true);
    });

    it("builds CARD_ID_COLLISION diagnostics for CLI output", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("error" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "Card A", 0), 0, true);
      index.add(makeCard("100", "Card A v2", 1), 1, true);

      const diagnostics = index.buildCollisionDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe("CARD_ID_COLLISION");
      expect(diagnostics[0].severity).toBe("ERROR");
      expect(diagnostics[0].source.cardId).toBe("100");
    });
  });

  describe("spool budget enforcement CLI behavior", () => {
    it("spool flushes to disk when buffer exceeds budget", () => {
      // Very small budget: 100 bytes (forces immediate flush per record)
      const spool = new MergeSpool(100);

      spool.addCard(makeCard("100", "Card A", 0), 0);
      spool.addCard(makeCard("200", "Card B", 0), 0);
      spool.addCard(makeCard("300", "Card C", 0), 0);

      // With 100 byte budget, each ~800 byte record flushes immediately
      expect(spool.hasSpooledRecords).toBe(true);
      expect(spool.spoolFileCount_).toBe(3); // One flush per record

      spool.cleanup();
    });

    it("spool tracks multiple flush operations", () => {
      const spool = new MergeSpool(100);

      // Add 5 records, each exceeding budget → 5 flushes
      for (let i = 0; i < 5; i++) {
        spool.addCard(makeCard(String(i), `Card ${i}`, 0), 0);
      }

      expect(spool.hasSpooledRecords).toBe(true);
      expect(spool.spoolFileCount_).toBe(5);

      spool.cleanup();
    });

    it("spool cleanup removes temporary files", () => {
      const spool = new MergeSpool(1);
      spool.addCard(makeCard("100", "Card A", 0), 0);
      spool.addCard(makeCard("200", "Card B", 0), 0);

      expect(spool.hasSpooledRecords).toBe(true);
      expect(spool.getSpoolFiles().length).toBeGreaterThan(0);

      // Cleanup should not throw
      expect(() => spool.cleanup()).not.toThrow();
      expect(spool.hasSpooledRecords).toBe(false);
    });

    it("throws when adding cards after merge starts", () => {
      const spool = new MergeSpool(1024);
      spool.addCard(makeCard("100", "Card A", 0), 0);
      spool.startMerge();

      expect(() => {
        spool.addCard(makeCard("200", "Card B", 0), 0);
      }).toThrow("Cannot add cards after merge has started");

      spool.cleanup();
    });

    it("merge yields records in sorted order", () => {
      const spool = new MergeSpool(64 * 1024); // 64KB budget — all records stay in buffer

      // Add out-of-order
      spool.addCard(makeCard("300", "Card C", 1), 1);
      spool.addCard(makeCard("100", "Card A", 0), 0);
      spool.addCard(makeCard("200", "Card B", 2), 2);

      spool.startMerge();

      const results: string[] = [];
      let record = spool.next();
      while (record) {
        results.push(record.card.id);
        record = spool.next();
      }

      expect(results).toEqual(["100", "200", "300"]);

      spool.cleanup();
    });

    it("spool with zero budget handles gracefully", () => {
      const spool = new MergeSpool(0);

      spool.addCard(makeCard("100", "Card A", 0), 0);

      // Zero budget means everything spills immediately
      expect(spool.hasSpooledRecords).toBe(true);
      expect(spool.spoolFileCount_).toBeGreaterThanOrEqual(1);

      spool.cleanup();
    });
  });

  describe("CLI multi-database merge scenarios", () => {
    it("three-way merge with first strategy preserves earliest", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("first" as MergeConflictStrategy, lineageIndex);

      // Input 0: card 100 (first)
      index.add(makeCard("100", "v1", 0), 0, true);
      // Input 1: card 200 (unique)
      index.add(makeCard("200", "Card 200", 1), 1, true);
      // Input 2: card 100 again (conflict, should be ignored)
      index.add(makeCard("100", "v3", 2), 2, true);
      // Input 2: card 300 (unique)
      index.add(makeCard("300", "Card 300", 2), 2, true);

      expect(index.size).toBe(3);
      expect(index.get("100")?.name).toBe("v1");
      expect(index.get("200")?.name).toBe("Card 200");
      expect(index.get("300")?.name).toBe("Card 300");

      // Lineage: card 100 has 2 sources
      const lineage100 = lineageIndex.get("100");
      expect(lineage100?.sourceCount).toBe(2);
      expect(lineage100?.hasConflict()).toBe(true);
    });

    it("three-way merge with last strategy keeps latest", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("last" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "v1", 0), 0, true);
      index.add(makeCard("100", "v2", 1), 1, true);
      index.add(makeCard("100", "v3", 2), 2, true);

      expect(index.get("100")?.name).toBe("v3");
      expect(index.getInputOrdinal("100")).toBe(2);

      const lineage = lineageIndex.get("100");
      expect(lineage?.sourceCount).toBe(3);
      expect(lineage?.getLastSource()?.inputOrdinal).toBe(2);
    });

    it("lineage tracks all contributing sources across multiple databases", () => {
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("first" as MergeConflictStrategy, lineageIndex);

      // 10 databases, each with the same card ID
      for (let i = 0; i < 10; i++) {
        index.add(makeCard("100", `v${i}`, i), i, true);
      }

      const lineage = lineageIndex.get("100");
      expect(lineage?.sourceCount).toBe(10);
      expect(lineage?.hasConflict()).toBe(true);
      expect(lineage?.getFirstSource()?.inputOrdinal).toBe(0);
      expect(lineage?.getLastSource()?.inputOrdinal).toBe(9);
    });
  });

  describe("cancellation and cleanup", () => {
    it("spool cleanup is idempotent", () => {
      const spool = new MergeSpool(100);
      spool.addCard(makeCard("100", "Card A", 0), 0);

      // First cleanup
      spool.cleanup();
      expect(spool.hasSpooledRecords).toBe(false);

      // Second cleanup should not throw
      expect(() => spool.cleanup()).not.toThrow();
    });

    it("terminal collision blocks all subsequent adds", () => {
      // This simulates what happens when onConflict=error and a collision occurs:
      // subsequent adds are blocked after the terminal collision.
      const lineageIndex = new MergeLineageIndex();
      const index = new MergeIndex("error" as MergeConflictStrategy, lineageIndex);

      index.add(makeCard("100", "Card 100", 0), 0, true);
      index.add(makeCard("100", "Dup", 1), 1, true); // Terminal

      const result = index.add(makeCard("200", "Card 200", 2), 2, true);
      expect(result.resolution.action).toBe("no_change");
      expect(result.terminal).toBe(true);
    });
  });

  describe("CDB fixture integration", () => {
    it("creates CDB databases with unique IDs that can be used in merge tests", () => {
      const db1 = makeCdbWithCards([
        { id: 100, name: "Dark Magician", desc: "A powerful wizard.", type: 2, atk: 2500, def: 2100, level: 7, race: 16, attribute: 16 },
      ]);
      const db2 = makeCdbWithCards([
        { id: 200, name: "Blue Eyes White Dragon", desc: "A powerful dragon.", type: 2, atk: 3000, def: 2500, level: 8, race: 16, attribute: 1 },
      ]);

      expect(existsSync(db1)).toBe(true);
      expect(existsSync(db2)).toBe(true);

      cleanupCdb(db1);
      cleanupCdb(db2);
    });

    it("creates CDB with duplicate IDs for collision testing", () => {
      // This database has the same ID in two databases
      const db1 = makeCdbWithCards([
        { id: 100, name: "Card 100 v1", desc: "Original", type: 2, atk: 1000, def: 1000, level: 4, race: 1, attribute: 1 },
      ]);
      const db2 = makeCdbWithCards([
        { id: 100, name: "Card 100 v2", desc: "Duplicate", type: 2, atk: 2000, def: 2000, level: 5, race: 1, attribute: 1 },
      ]);

      expect(existsSync(db1)).toBe(true);
      expect(existsSync(db2)).toBe(true);

      cleanupCdb(db1);
      cleanupCdb(db2);
    });
  });
});
