/**
 * Tests for physical-reorder merge semantics.
 *
 * Per INV-002 and P4 spec:
 * - Physical reorder changes the physical bundle hash
 * - But canonicalDataProjection(record) must remain equal
 * - canonical IDs, source ordinals, row identity, and merge winners are unchanged
 *
 * This tests that the merge strategy respects physical input order
 * (reader discovery order) rather than lexicographic card ID sorting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MergeIndex } from "../../dist/application/mergeIndex.js";
import { MergeLineageIndex } from "../../dist/application/mergeLineage.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";

function makeCard(
  id: string,
  name: string,
  inputOrdinal: number,
  dataOrdinal: number,
  textOrdinal: number,
): NormalizedCard {
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
      dataOrdinal,
      textOrdinal,
    },
  };
}

describe("physical order merge", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  it("merges by input ordinal (discovery order), not by card ID order", () => {
    // Card IDs are not in input order
    const index = new MergeIndex("first", lineageIndex);

    // Input 1 processes cards 900, 800, 700
    index.add(makeCard("900", "Card Z", 1, 3, 3), 1, true);
    index.add(makeCard("800", "Card Y", 1, 2, 2), 1, true);
    index.add(makeCard("700", "Card X", 1, 1, 1), 1, true);

    // Input 0 processes cards 100, 200, 300 (but comes FIRST in discovery)
    index.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    index.add(makeCard("200", "Card B", 0, 2, 2), 0, true);
    index.add(makeCard("300", "Card C", 0, 3, 3), 0, true);

    // "first" means earliest input ordinal wins
    expect(index.get("100")?.name).toBe("Card A");
    expect(index.get("200")?.name).toBe("Card B");
    expect(index.get("300")?.name).toBe("Card C");
    expect(index.get("700")?.name).toBe("Card X");
    expect(index.get("800")?.name).toBe("Card Y");
    expect(index.get("900")?.name).toBe("Card Z");
  });

  it("source ordinals are preserved in merge lineage", () => {
    const index = new MergeIndex("first", lineageIndex);

    // Database 0: cards at ordinals 10, 20, 30
    index.add(makeCard("100", "Card A", 0, 10, 10), 0, true);
    // Database 1: same card ID at ordinals 5 (earlier in this source)
    index.add(makeCard("100", "Card A Updated", 1, 5, 5), 1, true);

    const lineage = lineageIndex.get("100")!;
    expect(lineage.sourceCount).toBe(2);

    const sources = lineage.getSources();
    expect(sources).toHaveLength(2);
    // Sorted by input ordinal: 0 comes before 1
    expect(sources[0].inputOrdinal).toBe(0);
    expect(sources[1].inputOrdinal).toBe(1);
  });

  it("winner input ordinal is recorded correctly for first strategy", () => {
    const index = new MergeIndex("first", lineageIndex);

    index.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    index.add(makeCard("100", "Card A Updated", 1, 1, 1), 1, true);

    const result = index.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    expect(result.resolution.inputOrdinal).toBe(0);
  });

  it("merge across three inputs tracks all lineage", () => {
    const index = new MergeIndex("first", lineageIndex);

    // Input 0 provides card 100
    index.add(makeCard("100", "v1", 0, 1, 1), 0, true);
    // Input 1 provides card 100
    index.add(makeCard("100", "v2", 1, 3, 3), 1, true);
    // Input 2 provides card 100
    index.add(makeCard("100", "v3", 2, 7, 7), 2, true);

    // Input 2 also provides card 200 (no conflict)
    index.add(makeCard("200", "Card 200", 2, 8, 8), 2, true);

    const lineage100 = lineageIndex.get("100")!;
    expect(lineage100.sourceCount).toBe(3);
    expect(lineage100.hasConflict()).toBe(true);
    expect(lineage100.getFirstSource()?.inputOrdinal).toBe(0);
    expect(lineage100.getLastSource()?.inputOrdinal).toBe(2);

    const lineage200 = lineageIndex.get("200")!;
    expect(lineage200.sourceCount).toBe(1);
    expect(lineage200.hasConflict()).toBe(false);

    // First strategy: earliest wins
    expect(index.get("100")?.name).toBe("v1");
    expect(index.getInputOrdinal("100")).toBe(0);
  });

  it("getAllSorted returns cards in (cardId, inputOrdinal) order", () => {
    const index = new MergeIndex("first", lineageIndex);

    // Add cards from multiple inputs in mixed order
    index.add(makeCard("300", "Card C", 1, 3, 3), 1, true);
    index.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    index.add(makeCard("200", "Card B", 0, 2, 2), 0, true);
    index.add(makeCard("400", "Card D", 1, 4, 4), 1, true);
    index.add(makeCard("300", "Card C v2", 2, 6, 6), 2, true); // Conflict

    const sorted = index.getAllSorted();

    // Cards sorted by ID first
    expect(sorted.map((s) => s.record.id)).toEqual(["100", "200", "300", "400"]);
    // Then by input ordinal within each ID
    expect(sorted.find((s) => s.record.id === "300")?.inputOrdinal).toBe(1); // First occurrence
  });

  it("complete and incomplete cards are tracked separately in lineage", () => {
    const index = new MergeIndex("first", lineageIndex);

    // Input 0: complete card 100
    index.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    // Input 1: incomplete (datas-only) card 100
    index.add(makeCard("100", "Card A Partial", 1, 2, null), 1, false);

    const lineage = lineageIndex.get("100")!;
    const sources = lineage.getSources();
    expect(sources).toHaveLength(2);

    const complete = sources.find((s) => s.isComplete);
    const incomplete = sources.find((s) => !s.isComplete);
    expect(complete?.inputOrdinal).toBe(0);
    expect(incomplete?.inputOrdinal).toBe(1);
  });

  it("buildCollisionDiagnostics includes all conflicting IDs", () => {
    const index = new MergeIndex("first", lineageIndex);

    // Conflicting: card 100
    index.add(makeCard("100", "A", 0, 1, 1), 0, true);
    index.add(makeCard("100", "B", 1, 1, 1), 1, true);

    // Non-conflicting: card 200 (single source)
    index.add(makeCard("200", "C", 0, 1, 1), 0, true);

    // Conflicting: card 300
    index.add(makeCard("300", "D", 0, 1, 1), 0, true);
    index.add(makeCard("300", "E", 1, 1, 1), 1, true);
    index.add(makeCard("300", "F", 2, 1, 1), 2, true);

    const diagnostics = index.buildCollisionDiagnostics();
    expect(diagnostics).toHaveLength(2);
    const ids = diagnostics.map((d) => d.source.cardId).sort();
    expect(ids).toEqual(["100", "300"]);
  });
});

describe("canonical data projection equivalence", () => {
  let lineageIndex: MergeLineageIndex;

  beforeEach(() => {
    lineageIndex = new MergeLineageIndex();
  });

  it("canonical IDs remain stable across physical reorder", () => {
    // Simulate: same source content, but discovered in different order
    const index1 = new MergeIndex("first", lineageIndex);
    index1.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    index1.add(makeCard("200", "Card B", 0, 2, 2), 0, true);
    index1.add(makeCard("100", "Card A v2", 1, 5, 5), 1, true); // Conflict from DB 1

    const index2 = new MergeIndex("first", new MergeLineageIndex());
    index2.add(makeCard("200", "Card B", 0, 2, 2), 0, true); // Different discovery order
    index2.add(makeCard("100", "Card A", 0, 1, 1), 0, true);
    index2.add(makeCard("100", "Card A v2", 1, 5, 5), 1, true);

    // The winner for card 100 should be the same in both cases (first wins)
    expect(index1.get("100")?.name).toBe("Card A");
    expect(index2.get("100")?.name).toBe("Card A");

    // Canonical IDs are preserved
    expect([...index1.cardIds].sort()).toEqual([...index2.cardIds].sort());
  });
});
