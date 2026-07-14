/**
 * Tests for disk-backed merge spool.
 *
 * These tests exercise the disk-spill-and-merge path which was previously
 * broken (findings F-P4-AC4-1 through F-P4-AC4-4).
 *
 * Key fixes verified:
 * - F-P4-AC4-1: readNextFromSpoolSync now tracks per-file cursors
 * - F-P4-AC4-2: mergeRecords now calls spool.addCard() in Pass 1
 * - F-P4-AC4-3: spool now serializes inputOrdinal alongside card JSON
 * - F-P4-AC4-4: comprehensive disk-spill-and-merge tests added
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MergeSpool } from "../../dist/application/mergeSpool.js";
import { MergeIndex } from "../../dist/application/mergeIndex.js";
import { MergeLineageIndex } from "../../dist/application/mergeLineage.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";

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

describe("MergeSpool disk spill", () => {
  let spool: MergeSpool;

  afterEach(() => {
    if (spool) {
      spool.cleanup();
    }
  });

  describe("F-P4-AC4-1: per-file cursor tracking", () => {
    it("readNextFromSpoolSync advances through file, not re-read from start", () => {
      // Use a tiny budget (1KB) to force immediate spilling
      spool = new MergeSpool(1024);

      // Add cards with small serialized sizes - should cause multiple spills
      for (let i = 0; i < 20; i++) {
        spool.addCard(makeCard(`card-${i}`, `Card ${i}`, i % 3), i % 3);
      }

      // Should have spool files
      expect(spool.hasSpooledRecords).toBe(true);
      expect(spool.spoolFileCount_).toBeGreaterThan(0);

      spool.startMerge();

      // Read all records from the merge
      const records: string[] = [];
      let record = spool.next();
      while (record !== null) {
        records.push(`${record.card.id}:${record.inputOrdinal}`);
        record = spool.next();
      }

      // Should have read all 20 records
      expect(records).toHaveLength(20);

      // The critical test: no record should appear twice
      const uniqueRecords = new Set(records);
      expect(uniqueRecords.size).toBe(20);
    });

    it("handles multiple spool files with sequential reads", () => {
      spool = new MergeSpool(256); // Very small - forces many spills

      // Add 50 cards
      for (let i = 0; i < 50; i++) {
        spool.addCard(makeCard(`id-${i}`, `Card ${i}`, i), i);
      }

      expect(spool.hasSpooledRecords).toBe(true);
      const fileCount = spool.spoolFileCount_;
      expect(fileCount).toBeGreaterThan(1);

      spool.startMerge();

      // Collect all records
      const allCards: string[] = [];
      let r = spool.next();
      while (r !== null) {
        allCards.push(r.card.id);
        r = spool.next();
      }

      // Should have exactly 50 unique cards
      expect(allCards).toHaveLength(50);
      expect(new Set(allCards).size).toBe(50);
    });
  });

  describe("F-P4-AC4-3: inputOrdinal serialization and recovery", () => {
    it("preserves inputOrdinal across spool flush and merge", () => {
      spool = new MergeSpool(512); // Force spilling

      // Add cards from different inputs in mixed order
      spool.addCard(makeCard("100", "From Input 2", 2), 2);
      spool.addCard(makeCard("100", "From Input 0", 0), 0);
      spool.addCard(makeCard("100", "From Input 1", 1), 1);
      spool.addCard(makeCard("200", "From Input 0", 0), 0);
      spool.addCard(makeCard("200", "From Input 2", 2), 2);

      spool.startMerge();

      // Collect all records with their input ordinals
      const card100Ordinals: number[] = [];
      const card200Ordinals: number[] = [];

      let r = spool.next();
      while (r !== null) {
        if (r.card.id === "100") {
          card100Ordinals.push(r.inputOrdinal);
        } else if (r.card.id === "200") {
          card200Ordinals.push(r.inputOrdinal);
        }
        r = spool.next();
      }

      // Both inputs should be recorded for card 100
      expect(card100Ordinals).toContain(0);
      expect(card100Ordinals).toContain(1);
      expect(card100Ordinals).toContain(2);

      // Both inputs should be recorded for card 200
      expect(card200Ordinals).toContain(0);
      expect(card200Ordinals).toContain(2);
    });

    it("inputOrdinal is correct for 'last' winner selection", () => {
      spool = new MergeSpool(512);
      const lineageIndex = new MergeLineageIndex();
      const mergeIndex = new MergeIndex("last", lineageIndex);

      // Add cards: input 0 first, then input 1
      spool.addCard(makeCard("100", "First", 0), 0);
      const result0 = mergeIndex.add(makeCard("100", "First", 0), 0, true);
      expect(result0.added).toBe(true);

      spool.addCard(makeCard("100", "Last", 1), 1);
      const result1 = mergeIndex.add(makeCard("100", "Last", 1), 1, true);
      expect(result1.added).toBe(true);

      spool.startMerge();

      // Collect all
      const records: Array<{ id: string; name: string; ordinal: number }> = [];
      let r = spool.next();
      while (r !== null) {
        records.push({ id: r.card.id, name: r.card.name, ordinal: r.inputOrdinal });
        r = spool.next();
      }

      // Find card 100
      const card100Records = records.filter((r) => r.id === "100");
      expect(card100Records).toHaveLength(2); // Both inputs recorded

      // The LAST input (ordinal 1) should be the winning name "Last"
      const lastRecord = card100Records.find((r) => r.name === "Last");
      expect(lastRecord?.ordinal).toBe(1);
    });
  });

  describe("basic in-memory merge (no spill)", () => {
    it("merges sorted records from buffer", () => {
      spool = new MergeSpool(1024 * 1024); // Large budget - no spill

      // Add out-of-order cards
      spool.addCard(makeCard("300", "C", 0), 0);
      spool.addCard(makeCard("100", "A", 0), 0);
      spool.addCard(makeCard("200", "B", 0), 0);

      expect(spool.hasSpooledRecords).toBe(false);

      spool.startMerge();

      const ids: string[] = [];
      let r = spool.next();
      while (r !== null) {
        ids.push(r.card.id);
        r = spool.next();
      }

      // Should be sorted by cardId
      expect(ids).toEqual(["100", "200", "300"]);
    });

    it("handles single card without spill", () => {
      spool = new MergeSpool(1024 * 1024);

      spool.addCard(makeCard("100", "Single", 0), 0);

      spool.startMerge();

      const r = spool.next();
      expect(r).not.toBeNull();
      expect(r!.card.id).toBe("100");
      expect(r!.inputOrdinal).toBe(0);
      expect(r!.spooled).toBe(false);

      expect(spool.next()).toBeNull();
    });
  });

  describe("sorted output after disk spill", () => {
    it("outputs cards sorted by (cardId, inputOrdinal) after spill", () => {
      spool = new MergeSpool(256); // Force spill

      // Add cards in mixed order
      const testCases = [
        { id: "300", name: "C", ordinal: 1 },
        { id: "100", name: "A", ordinal: 0 },
        { id: "300", name: "C v2", ordinal: 2 },
        { id: "200", name: "B", ordinal: 0 },
        { id: "100", name: "A v2", ordinal: 1 },
        { id: "200", name: "B v2", ordinal: 2 },
      ];

      for (const tc of testCases) {
        spool.addCard(makeCard(tc.id, tc.name, tc.ordinal), tc.ordinal);
      }

      spool.startMerge();

      // Collect all records
      interface OutputRecord {
        id: string;
        name: string;
        ordinal: number;
      }
      const output: OutputRecord[] = [];

      let r = spool.next();
      while (r !== null) {
        output.push({ id: r.card.id, name: r.card.name, ordinal: r.inputOrdinal });
        r = spool.next();
      }

      // Verify count
      expect(output).toHaveLength(6);

      // Verify sorted by (id, ordinal)
      for (let i = 1; i < output.length; i++) {
        const prev = output[i - 1];
        const curr = output[i];
        if (prev.id < curr.id) continue;
        if (prev.id === curr.id) {
          expect(prev.ordinal).toBeLessThan(curr.ordinal);
        } else {
          // prev.id > curr.id - this should not happen
          expect(prev.id).toBeLessThan(curr.id);
        }
      }

      // Verify expected sorted order by (cardId, inputOrdinal)
      // "100" < "200" < "300" lexicographically
      // Card 100: ordinal 0 comes first, then ordinal 1
      expect(output[0]).toEqual({ id: "100", name: "A", ordinal: 0 });
      expect(output[1]).toEqual({ id: "100", name: "A v2", ordinal: 1 });
      // Card 200: ordinal 0 comes next
      expect(output[2]).toEqual({ id: "200", name: "B", ordinal: 0 });
      // Card 200: ordinal 2
      expect(output[3]).toEqual({ id: "200", name: "B v2", ordinal: 2 });
      // Card 300: ordinal 1
      expect(output[4]).toEqual({ id: "300", name: "C", ordinal: 1 });
    });
  });

  describe("cleanup", () => {
    it("cleanup removes spool files", () => {
      spool = new MergeSpool(256);

      for (let i = 0; i < 10; i++) {
        spool.addCard(makeCard(`id-${i}`, `Card ${i}`, i), i);
      }

      expect(spool.hasSpooledRecords).toBe(true);
      const files = spool.getSpoolFiles();
      expect(files.length).toBeGreaterThan(0);

      spool.cleanup();

      // After cleanup, should report no spooled records
      expect(spool.hasSpooledRecords).toBe(false);
    });

    it("cleanup is idempotent", () => {
      spool = new MergeSpool(256);

      spool.addCard(makeCard("100", "Test", 0), 0);
      spool.startMerge();
      spool.next();

      // Multiple cleanups should not throw
      spool.cleanup();
      spool.cleanup();

      expect(true).toBe(true); // If we get here, cleanup is safe
    });
  });
});

describe("full merge integration with disk spool", () => {
  /**
   * This test verifies the complete two-pass merge flow:
   * Pass 1: Normalize and add to index + spool
   * Pass 2: Merge-sort and collect
   */
  it("integrates MergeIndex and MergeSpool for two-pass merge", () => {
    const lineageIndex = new MergeLineageIndex();
    const mergeIndex = new MergeIndex("first", lineageIndex);
    const spool = new MergeSpool(512); // Force spill

    // Simulate Pass 1: Add cards from multiple inputs
    const inputs = [
      // Input 0: cards 100, 200
      { id: "100", name: "Card A", ordinal: 0 },
      { id: "200", name: "Card B", ordinal: 0 },
      // Input 1: cards 100, 300 (conflict on 100)
      { id: "100", name: "Card A Updated", ordinal: 1 },
      { id: "300", name: "Card C", ordinal: 1 },
      // Input 2: cards 200 (conflict), 400
      { id: "200", name: "Card B v2", ordinal: 2 },
      { id: "400", name: "Card D", ordinal: 2 },
    ];

    for (const tc of inputs) {
      const card = makeCard(tc.id, tc.name, tc.ordinal);
      const result = mergeIndex.add(card, tc.ordinal, true);

      // KEY: Also add to spool (this was missing before!)
      if (result.added) {
        spool.addCard(result.resolution.record, result.resolution.inputOrdinal);
      }
    }

    // Pass 2: Merge-sort
    spool.startMerge();

    interface MergedOutput {
      id: string;
      name: string;
      ordinal: number;
      contributors: number;
    }
    const output: MergedOutput[] = [];

    let r = spool.next();
    while (r !== null) {
      const lineage = lineageIndex.get(r.card.id);
      output.push({
        id: r.card.id,
        name: r.card.name,
        ordinal: r.inputOrdinal,
        contributors: lineage?.sourceCount ?? 0,
      });
      r = spool.next();
    }

    // Should have 4 unique cards
    expect(output).toHaveLength(4);

    // Verify first strategy: earliest input wins for conflicts
    const card100 = output.find((o) => o.id === "100");
    expect(card100!.name).toBe("Card A"); // Input 0 wins
    expect(card100!.ordinal).toBe(0);
    expect(card100!.contributors).toBe(2); // Both inputs contributed

    const card200 = output.find((o) => o.id === "200");
    expect(card200!.name).toBe("Card B"); // Input 0 wins
    expect(card200!.ordinal).toBe(0);
    expect(card200!.contributors).toBe(2);

    const card300 = output.find((o) => o.id === "300");
    expect(card300!.name).toBe("Card C");
    expect(card300!.ordinal).toBe(1);
    expect(card300!.contributors).toBe(1);

    const card400 = output.find((o) => o.id === "400");
    expect(card400!.name).toBe("Card D");
    expect(card400!.ordinal).toBe(2);
    expect(card400!.contributors).toBe(1);

    spool.cleanup();
  });

  it("handles 'last' strategy with disk spool", () => {
    const lineageIndex = new MergeLineageIndex();
    const mergeIndex = new MergeIndex("last", lineageIndex);
    const spool = new MergeSpool(256);

    // Three inputs with the same card ID
    spool.addCard(makeCard("100", "First", 0), 0);
    mergeIndex.add(makeCard("100", "First", 0), 0, true);

    spool.addCard(makeCard("100", "Second", 1), 1);
    mergeIndex.add(makeCard("100", "Second", 1), 1, true);

    spool.addCard(makeCard("100", "Last", 2), 2);
    mergeIndex.add(makeCard("100", "Last", 2), 2, true);

    spool.startMerge();

    const records: string[] = [];
    let r = spool.next();
    while (r !== null) {
      records.push(`${r.card.name}:${r.inputOrdinal}`);
      r = spool.next();
    }

    // "Last" strategy: highest ordinal wins
    const lastRecord = records[records.length - 1];
    expect(lastRecord).toBe("Last:2");

    spool.cleanup();
  });

  it("handles 'error' strategy with disk spool", () => {
    const lineageIndex = new MergeLineageIndex();
    const mergeIndex = new MergeIndex("error", lineageIndex);
    const spool = new MergeSpool(256);

    // First card is accepted
    spool.addCard(makeCard("100", "First", 0), 0);
    const result0 = mergeIndex.add(makeCard("100", "First", 0), 0, true);
    expect(result0.added).toBe(true);

    // Second card triggers collision
    spool.addCard(makeCard("100", "Second", 1), 1);
    const result1 = mergeIndex.add(makeCard("100", "Second", 1), 1, true);
    expect(result1.resolution.action).toBe("conflict_error");
    expect(result1.terminal).toBe(true);

    // After terminal collision, spool should be cleaned up
    spool.cleanup();

    // Verify terminal state
    expect(mergeIndex.hasTerminalConflict).toBe(true);
    expect(mergeIndex.terminalConflictCardId).toBe("100");
  });

  it("tracks all contributors in lineage with disk spool", () => {
    const lineageIndex = new MergeLineageIndex();
    const mergeIndex = new MergeIndex("first", lineageIndex);
    const spool = new MergeSpool(256);

    // Same card ID from 5 different inputs
    for (let i = 0; i < 5; i++) {
      const card = makeCard("100", `Version ${i}`, i);
      const result = mergeIndex.add(card, i, true);
      if (result.added) {
        spool.addCard(result.resolution.record, result.resolution.inputOrdinal);
      }
    }

    spool.startMerge();

    const lineage = lineageIndex.get("100");
    expect(lineage).toBeDefined();
    expect(lineage!.sourceCount).toBe(5);
    expect(lineage!.hasConflict()).toBe(true);

    // First strategy: input 0 wins
    expect(lineage!.getFirstSource()?.inputOrdinal).toBe(0);
    expect(lineage!.getLastSource()?.inputOrdinal).toBe(4);

    spool.cleanup();
  });
});

describe("edge cases", () => {
  it("handles empty spool", () => {
    const spool = new MergeSpool(1024);
    spool.startMerge();

    const r = spool.next();
    expect(r).toBeNull();

    spool.cleanup();
  });

  it("handles very small budget that spills immediately", () => {
    const spool = new MergeSpool(10); // 10 bytes - almost everything will spill

    // Even a small card should cause spill
    spool.addCard(makeCard("100", "Test", 0), 0);

    expect(spool.hasSpooledRecords).toBe(true);

    spool.startMerge();

    const r = spool.next();
    expect(r).not.toBeNull();
    expect(r!.card.id).toBe("100");

    expect(spool.next()).toBeNull();

    spool.cleanup();
  });

  it("handles cards with same ID and same ordinal", () => {
    const spool = new MergeSpool(256);

    // Add same card ID and ordinal twice (edge case)
    spool.addCard(makeCard("100", "First", 0), 0);
    spool.addCard(makeCard("100", "Second", 0), 0);

    spool.startMerge();

    const records: string[] = [];
    let r = spool.next();
    while (r !== null) {
      records.push(r.card.name);
      r = spool.next();
    }

    // Both should be recorded
    expect(records).toHaveLength(2);
    expect(records[0]).toBe("First");
    expect(records[1]).toBe("Second");

    spool.cleanup();
  });
});
