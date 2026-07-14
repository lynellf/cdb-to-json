/**
 * Tests for late duplicate merge handling.
 *
 * Tests that the merge correctly handles:
 * - Cards that appear late in the input sequence
 * - Duplicate IDs discovered in later inputs
 * - The interaction between late duplicates and the conflict strategy
 * - Bounded heap with late duplicates
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MergeIndex } from "../../dist/application/mergeIndex.js";
import { MergeLineageIndex } from "../../dist/application/mergeLineage.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";

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

describe("late duplicate handling", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  describe("first strategy with late duplicates", () => {
    it("ignores late duplicates when first occurrence is early", () => {
      const index = new MergeIndex("first", lineageIndex);

      // First input has the card
      index.add(makeCard("100", "Original", 0), 0, true);
      // Many inputs later, same ID appears
      index.add(makeCard("100", "Late Duplicate", 10), 10, true);
      index.add(makeCard("100", "Even Later", 15), 15, true);

      expect(index.get("100")?.name).toBe("Original");
      expect(index.getInputOrdinal("100")).toBe(0);
    });

    it("first occurring is preserved even with large input gap", () => {
      const index = new MergeIndex("first", lineageIndex);

      // Input 0: card 100
      index.add(makeCard("100", "First Seen", 0), 0, true);

      // Simulate 1000 inputs between
      for (let i = 1; i <= 1000; i++) {
        index.add(makeCard(`x${i}`, `Unrelated ${i}`, i), i, true);
      }

      // Input 1001: card 100 again
      index.add(makeCard("100", "Late Duplicate", 1001), 1001, true);

      expect(index.get("100")?.name).toBe("First Seen");
      expect(index.getInputOrdinal("100")).toBe(0);
    });
  });

  describe("last strategy with late duplicates", () => {
    it("takes the most recent occurrence even if very late", () => {
      const index = new MergeIndex("last", lineageIndex);

      // First input has the card
      index.add(makeCard("100", "Original", 0), 0, true);

      // Many inputs later, same ID appears
      index.add(makeCard("100", "Late Update", 100), 100, true);

      expect(index.get("100")?.name).toBe("Late Update");
      expect(index.getInputOrdinal("100")).toBe(100);
    });

    it("lineage tracks all occurrences including late ones", () => {
      const index = new MergeIndex("last", lineageIndex);

      index.add(makeCard("100", "v1", 0), 0, true);
      index.add(makeCard("100", "v2", 50), 50, true);
      index.add(makeCard("100", "v3", 100), 100, true);

      const lineage = lineageIndex.get("100")!;
      expect(lineage.sourceCount).toBe(3);
      expect(lineage.getLastSource()?.inputOrdinal).toBe(100);

      // Last strategy: winner is the last
      expect(index.get("100")?.name).toBe("v3");
      expect(index.getInputOrdinal("100")).toBe(100);
    });
  });

  describe("error strategy with late duplicates", () => {
    it("detects terminal collision regardless of when duplicates appear", () => {
      const index = new MergeIndex("error", lineageIndex);

      // First input
      index.add(makeCard("100", "Original", 0), 0, true);

      // 500 inputs later
      for (let i = 1; i < 500; i++) {
        index.add(makeCard(`x${i}`, `Unrelated ${i}`, i), i, true);
      }

      // Late duplicate triggers terminal collision
      const result = index.add(makeCard("100", "Duplicate", 500), 500, true);

      expect(result.resolution.action).toBe("conflict_error");
      expect(result.terminal).toBe(true);
      expect(index.hasTerminalConflict).toBe(true);
    });

    it("terminal collision blocks all subsequent operations", () => {
      const index = new MergeIndex("error", lineageIndex);

      index.add(makeCard("100", "Original", 0), 0, true);
      const collisionResult = index.add(makeCard("100", "Duplicate", 1), 1, true);
      expect(collisionResult.terminal).toBe(true);

      // Any subsequent add is blocked
      const blocked = index.add(makeCard("200", "Card 200", 2), 2, true);
      expect(blocked.resolution.action).toBe("no_change");
      expect(blocked.terminal).toBe(true);
    });
  });

  describe("multiple late conflicts across IDs", () => {
    it("tracks multiple late-conflicting IDs independently", () => {
      const index = new MergeIndex("first", lineageIndex);

      // Cards from early inputs
      index.add(makeCard("100", "Card 100", 0), 0, true);
      index.add(makeCard("200", "Card 200", 0), 0, true);
      index.add(makeCard("300", "Card 300", 0), 0, true);

      // Late inputs with conflicts
      index.add(makeCard("100", "Dup 100", 50), 50, true);
      index.add(makeCard("300", "Dup 300", 75), 75, true);

      // Non-conflicting cards from late inputs
      index.add(makeCard("400", "Card 400", 100), 100, true);

      expect(index.size).toBe(4); // 100, 200, 300, 400

      // 100 and 300 have conflict lineage
      const lineage100 = lineageIndex.get("100")!;
      const lineage300 = lineageIndex.get("300")!;

      expect(lineage100.hasConflict()).toBe(true);
      expect(lineage300.hasConflict()).toBe(true);
      expect(lineageIndex.get("200")!.hasConflict()).toBe(false);
      expect(lineageIndex.get("400")!.hasConflict()).toBe(false);

      // First strategy keeps early occurrences
      expect(index.get("100")?.name).toBe("Card 100");
      expect(index.get("200")?.name).toBe("Card 200");
      expect(index.get("300")?.name).toBe("Card 300");
      expect(index.get("400")?.name).toBe("Card 400");
    });
  });

  describe("late duplicate cleanup", () => {
    it("clear removes all tracked IDs including late ones", () => {
      const index = new MergeIndex("first", lineageIndex);

      index.add(makeCard("100", "Card 100", 0), 0, true);
      index.add(makeCard("200", "Card 200", 1000), 1000, true);

      expect(index.size).toBe(2);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.has("100")).toBe(false);
      expect(index.has("200")).toBe(false);
    });

    it("clear resets terminal conflict state", () => {
      const index = new MergeIndex("error", lineageIndex);

      index.add(makeCard("100", "Original", 0), 0, true);
      index.add(makeCard("100", "Dup", 1), 1, true);

      expect(index.hasTerminalConflict).toBe(true);

      index.clear();

      expect(index.hasTerminalConflict).toBe(false);
      expect(index.terminalConflictCardId).toBeNull();
    });
  });

  describe("large-scale late duplicate", () => {
    it("handles thousands of inputs with sparse conflicts", () => {
      const index = new MergeIndex("first", lineageIndex);

      // Start with card 100
      index.add(makeCard("100", "First 100", 0), 0, true);

      // Add 10000 unrelated cards
      for (let i = 1; i <= 10000; i++) {
        index.add(makeCard(`card-${i}`, `Card ${i}`, i), i, true);
      }

      // Late duplicate of 100
      index.add(makeCard("100", "Late 100", 10001), 10001, true);

      expect(index.size).toBe(10001);
      expect(index.get("100")?.name).toBe("First 100");

      const lineage = lineageIndex.get("100")!;
      expect(lineage.sourceCount).toBe(2);
      expect(lineage.getFirstSource()?.inputOrdinal).toBe(0);
      expect(lineage.getLastSource()?.inputOrdinal).toBe(10001);
    });
  });
});
