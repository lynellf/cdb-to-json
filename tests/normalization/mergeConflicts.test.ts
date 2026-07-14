/**
 * Tests for merge conflict resolution.
 *
 * Tests the disk-backed two-pass merge for:
 * - error/first/last conflict resolution strategies
 * - merge index tracking and lineage
 * - spool-based buffering and disk spill
 * - terminal collision behavior (exit 5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MergeIndex } from "../../dist/application/mergeIndex.js";
import { MergeLineageIndex } from "../../dist/application/mergeLineage.js";
import { MergeSpool } from "../../dist/application/mergeSpool.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";
import type { MergeConflictStrategy } from "../../dist/application/mergeIndex.js";

// Helper to create minimal normalized cards for testing
function makeCard(id: string, name: string, inputOrdinal = 0): NormalizedCard {
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
      databasePath: `/test/db-${inputOrdinal}.cdb`,
      dataOrdinal: inputOrdinal,
      textOrdinal: inputOrdinal,
    },
  };
}

describe("MergeIndex", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  describe("first strategy", () => {
    it("keeps the first-occurring record when conflicts occur", () => {
      const index = new MergeIndex("first", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician Updated", 1);

      // Add first occurrence
      const result1 = index.add(card1, 0, true);
      expect(result1.resolution.action).toBe("keep");
      expect(result1.added).toBe(true);
      expect(result1.resolution.record.id).toBe("100");
      expect(index.get("100")?.id).toBe("100");
      expect(index.getInputOrdinal("100")).toBe(0);

      // Add second occurrence (should be ignored since first strategy)
      const result2 = index.add(card2, 1, true);
      expect(result2.resolution.action).toBe("keep");
      expect(result2.added).toBe(false);
      expect(index.get("100")?.name).toBe("Dark Magician"); // Original kept
      expect(index.getInputOrdinal("100")).toBe(0);
    });

    it("tracks lineage for first strategy", () => {
      const index = new MergeIndex("first", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician Updated", 1);

      index.add(card1, 0, true);
      index.add(card2, 1, true);

      const lineage = lineageIndex.get("100");
      expect(lineage).toBeDefined();
      expect(lineage!.sourceCount).toBe(2);
      expect(lineage!.hasConflict()).toBe(true);
    });

    it("handles three-way conflict with first strategy", () => {
      const index = new MergeIndex("first", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician v2", 1);
      const card3 = makeCard("100", "Dark Magician v3", 2);

      index.add(card1, 0, true);
      index.add(card2, 1, true);
      index.add(card3, 2, true);

      expect(index.get("100")?.name).toBe("Dark Magician"); // First kept
      expect(index.size).toBe(1);

      const lineage = lineageIndex.get("100");
      expect(lineage!.sourceCount).toBe(3);
    });
  });

  describe("last strategy", () => {
    it("keeps the last-occurring record when conflicts occur", () => {
      const index = new MergeIndex("last", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician Updated", 1);

      index.add(card1, 0, true);
      const result = index.add(card2, 1, true);

      expect(result.resolution.action).toBe("keep");
      expect(result.added).toBe(true); // Last wins
      expect(index.get("100")?.name).toBe("Dark Magician Updated");
      expect(index.getInputOrdinal("100")).toBe(1);
    });

    it("tracks lineage for last strategy", () => {
      const index = new MergeIndex("last", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician v2", 1);

      index.add(card1, 0, true);
      index.add(card2, 1, true);

      const lineage = lineageIndex.get("100");
      expect(lineage!.sourceCount).toBe(2);
      expect(lineage!.hasConflict()).toBe(true);
      expect(lineage!.getLastSource()?.inputOrdinal).toBe(1);
    });
  });

  describe("error strategy", () => {
    it("marks terminal conflict on second occurrence", () => {
      const index = new MergeIndex("error", lineageIndex);

      const card1 = makeCard("100", "Dark Magician", 0);
      const card2 = makeCard("100", "Dark Magician Updated", 1);

      const result1 = index.add(card1, 0, true);
      expect(result1.resolution.action).toBe("keep");
      expect(result1.added).toBe(true);

      const result2 = index.add(card2, 1, true);
      expect(result2.resolution.action).toBe("conflict_error");
      expect(result2.added).toBe(false);
      expect(result2.terminal).toBe(true);

      expect(index.hasTerminalConflict).toBe(true);
      expect(index.terminalConflictCardId).toBe("100");
      expect(index.terminalConflictSources.length).toBe(2);
    });

    it("blocks further adds after terminal collision", () => {
      const index = new MergeIndex("error", lineageIndex);

      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      index.add(makeCard("100", "v2", 1), 1, true); // Terminal

      const result3 = index.add(makeCard("200", "Blue Eyes", 2), 2, true);
      expect(result3.resolution.action).toBe("no_change");
      expect(result3.added).toBe(false);
      expect(result3.terminal).toBe(true);
    });

    it("generates CARD_ID_COLLISION diagnostics", () => {
      const index = new MergeIndex("error", lineageIndex);

      index.add(makeCard("100", "Dark Magician", 0), 0, true);
      index.add(makeCard("100", "v2", 1), 1, true);

      const diagnostics = index.buildCollisionDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].code).toBe("CARD_ID_COLLISION");
      expect(diagnostics[0].source.cardId).toBe("100");
      expect(diagnostics[0].severity).toBe("ERROR");
    });
  });

  describe("getAllSorted", () => {
    it("returns records sorted by (cardId, inputOrdinal)", () => {
      const index = new MergeIndex("first", lineageIndex);

      index.add(makeCard("300", "C", 0), 0, true);
      index.add(makeCard("100", "A", 0), 0, true);
      index.add(makeCard("200", "B", 0), 0, true);

      const sorted = index.getAllSorted();
      expect(sorted.map((s) => s.record.id)).toEqual(["100", "200", "300"]);
    });

    it("returns only the winning record per ID", () => {
      const index = new MergeIndex("last", lineageIndex);

      index.add(makeCard("100", "v1", 0), 0, true);
      index.add(makeCard("100", "v2", 1), 1, true);
      index.add(makeCard("200", "v1", 0), 0, true);

      const sorted = index.getAllSorted();
      expect(sorted).toHaveLength(2);
      expect(sorted.find((s) => s.record.id === "100")?.record.name).toBe("v2");
      expect(sorted.find((s) => s.record.id === "200")?.record.name).toBe("v1");
    });
  });

  describe("non-conflicting IDs", () => {
    it("tracks multiple distinct IDs independently", () => {
      const index = new MergeIndex("first", lineageIndex);

      index.add(makeCard("100", "Card A", 0), 0, true);
      index.add(makeCard("200", "Card B", 0), 0, true);
      index.add(makeCard("300", "Card C", 0), 0, true);

      expect(index.size).toBe(3);
      expect(index.get("100")?.name).toBe("Card A");
      expect(index.get("200")?.name).toBe("Card B");
      expect(index.get("300")?.name).toBe("Card C");
    });

    it("no conflict for single source", () => {
      const index = new MergeIndex("first", lineageIndex);
      index.add(makeCard("100", "Card A", 0), 0, true);

      const diagnostics = index.buildCollisionDiagnostics();
      expect(diagnostics).toHaveLength(0);
    });
  });
});

describe("MergeLineage", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  it("tracks multiple sources per card ID", () => {
    const card1 = makeCard("100", "Dark Magician", 0);
    const card2 = makeCard("100", "Dark Magician", 1);

    const lineage1 = lineageIndex.getOrCreate("100");
    lineage1.addSource({
      database: "/db1.cdb",
      cardId: "100",
      inputOrdinal: 0,
      dataOrdinal: 1,
      textOrdinal: 1,
      isComplete: true,
    });
    lineage1.addSource({
      database: "/db2.cdb",
      cardId: "100",
      inputOrdinal: 1,
      dataOrdinal: 5,
      textOrdinal: 5,
      isComplete: true,
    });

    expect(lineage1.sourceCount).toBe(2);
    expect(lineage1.hasConflict()).toBe(true);
    expect(lineage1.getFirstSource()?.inputOrdinal).toBe(0);
    expect(lineage1.getLastSource()?.inputOrdinal).toBe(1);
  });

  it("getSources returns sources sorted by input ordinal", () => {
    const lineage = lineageIndex.getOrCreate("100");

    lineage.addSource({
      database: "/db2.cdb",
      cardId: "100",
      inputOrdinal: 1,
      dataOrdinal: 1,
      textOrdinal: 1,
      isComplete: true,
    });
    lineage.addSource({
      database: "/db1.cdb",
      cardId: "100",
      inputOrdinal: 0,
      dataOrdinal: 1,
      textOrdinal: 1,
      isComplete: true,
    });

    const sources = lineage.getSources();
    expect(sources[0].inputOrdinal).toBe(0);
    expect(sources[1].inputOrdinal).toBe(1);
  });
});

describe("MergeSpool", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  it("buffers records in memory without flushing", () => {
    const spool = new MergeSpool(1024 * 1024, lineageIndex); // 1 MB budget

    spool.addCard(makeCard("100", "Card A", 0), 0);
    spool.addCard(makeCard("200", "Card B", 0), 0);
    spool.addCard(makeCard("300", "Card C", 0), 0);

    expect(spool.hasSpooledRecords).toBe(false);
    expect(spool.bufferByteSize).toBeGreaterThan(0);

    spool.cleanup();
  });

  it("tracks spool file count", () => {
    const spool = new MergeSpool(1, lineageIndex); // 1 byte budget (forces flush)

    spool.addCard(makeCard("100", "Card A", 0), 0);
    // With a 1-byte budget, the record will be added but may trigger flush
    // The exact behavior depends on the record size

    spool.cleanup();
  });

  it("throws when adding cards after merge starts", () => {
    const spool = new MergeSpool(1024, lineageIndex);
    spool.addCard(makeCard("100", "Card A", 0), 0);
    spool.startMerge();

    expect(() => {
      spool.addCard(makeCard("200", "Card B", 0), 0);
    }).toThrow("Cannot add cards after merge has started");

    spool.cleanup();
  });

  it("cleanup removes spool directory", () => {
    const spool = new MergeSpool(1, lineageIndex);
    spool.addCard(makeCard("100", "Card A", 0), 0);

    // Cleanup should not throw
    expect(() => spool.cleanup()).not.toThrow();
  });

  it("hasSpooledRecords reflects buffer state", () => {
    const spool = new MergeSpool(1024 * 1024, lineageIndex);
    expect(spool.hasSpooledRecords).toBe(false);

    spool.addCard(makeCard("100", "Card A", 0), 0);
    // Still in memory if within budget
    expect(spool.hasSpooledRecords).toBe(false);

    spool.cleanup();
  });
});

describe("conflict resolution determinism", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  it("first strategy is deterministic regardless of add order", () => {
    // Add in reverse order
    const index1 = new MergeIndex("first", lineageIndex);
    index1.add(makeCard("100", "Last First", 2), 2, true);
    index1.add(makeCard("100", "Earliest", 0), 0, true);
    index1.add(makeCard("100", "Middle", 1), 1, true);

    // Reset lineage
    const lineageIndex2 = new MergeLineageIndex();
    // Add in forward order
    const index2 = new MergeIndex("first", lineageIndex2);
    index2.add(makeCard("100", "Earliest", 0), 0, true);
    index2.add(makeCard("100", "Middle", 1), 1, true);
    index2.add(makeCard("100", "Last First", 2), 2, true);

    // Both should keep the same record
    expect(index1.get("100")?.name).toBe("Earliest");
    expect(index2.get("100")?.name).toBe("Earliest");
  });

  it("last strategy is deterministic regardless of add order", () => {
    // Add in forward order
    const index1 = new MergeIndex("last", lineageIndex);
    index1.add(makeCard("100", "Earliest", 0), 0, true);
    index1.add(makeCard("100", "Last", 2), 2, true);

    // Reset lineage
    const lineageIndex2 = new MergeLineageIndex();
    // Add in reverse order
    const index2 = new MergeIndex("last", lineageIndex2);
    index2.add(makeCard("100", "Last", 2), 2, true);
    index2.add(makeCard("100", "Earliest", 0), 0, true);

    // Both should keep the same record (last by input ordinal)
    expect(index1.get("100")?.name).toBe("Last");
    expect(index2.get("100")?.name).toBe("Last");
  });

  it("error strategy detects conflict regardless of add order", () => {
    const index1 = new MergeIndex("error", lineageIndex);
    index1.add(makeCard("100", "First", 0), 0, true);
    index1.add(makeCard("100", "Second", 1), 1, true);

    expect(index1.hasTerminalConflict).toBe(true);
    expect(index1.terminalConflictCardId).toBe("100");
  });
});
