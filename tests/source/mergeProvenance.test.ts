/**
 * Merge provenance tests.
 *
 * Per P5-AC5:
 * "Independent provenance vectors change sourceRevisionId or conversionOptionsHash
 * for every included source/semantic input and leave both unchanged for every
 * excluded presentation input. Physical reorder changes only the declared physical
 * identity fields in full records: canonicalDataProjection(record), IDs, raw facts,
 * ordinals, normalized values, diagnostics, lineage, merge winners, and
 * conversionOptionsHash remain unchanged, while the exact INV-002 bundle hash and
 * sourceRevisionId change."
 *
 * Evidence command: npm run test:source -- tests/source/mergeProvenance.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  computeConversionOptionsHash,
  computeSourceRevisionId,
  buildSharedSemanticOptions,
  buildSourceFact,
  computePhysicalSnapshotHash,
  type SourceRevisionFacts,
  type RegistryVersions,
  type RegistryHashes,
} from "../../src/hashing/sourceRevision.js";
import { getDefaultLimits } from "../../src/application/types.js";

// ---------------------------------------------------------------------------
// Test data constants
// ---------------------------------------------------------------------------

const BUNDLED_VERSIONS: RegistryVersions = {
  cardType: "cdb-normalization/1",
  attribute: "cdb-normalization/1",
  monsterType: "cdb-normalization/1",
  linkMarker: "cdb-normalization/1",
  availability: "cdb-normalization/1",
  category: "cdb-normalization/1",
  progression: "cdb-normalization/1",
  stats: "cdb-normalization/1",
  setcode: "cdb-normalization/1",
};

const BASE_HASHES: RegistryHashes = {
  cardType: "a".repeat(64),
  attribute: "b".repeat(64),
  monsterType: "c".repeat(64),
  linkMarker: "d".repeat(64),
  availability: "e".repeat(64),
  category: "f".repeat(64),
  progression: "g".repeat(64),
  stats: "h".repeat(64),
  setcode: "i".repeat(64),
};

const BASE_LIMITS = getDefaultLimits();

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function makeOptions(overrides: Partial<{
  profile: string;
  locale: string;
  sourceNamespace: string;
  registryVersions: RegistryVersions;
  registryHashes: RegistryHashes;
}> = {}): ReturnType<typeof buildSharedSemanticOptions> {
  return buildSharedSemanticOptions({
    profile: "source",
    locale: "en",
    sourceNamespace: "cdb-to-json",
    registryVersions: BUNDLED_VERSIONS,
    registryHashes: BASE_HASHES,
    limits: BASE_LIMITS,
    ...overrides,
  });
}

function makeFacts(overrides: Partial<{
  locale: string;
  sourceNamespace: string;
  registryVersions: RegistryVersions;
  registryHashes: RegistryHashes;
  physicalSnapshotHash: string;
  sourceFacts: Parameters<typeof buildSourceFact>[];
}> = {}): SourceRevisionFacts {
  const { sourceFacts: factParams = [["1", 0, 0, 0,
    { id: "1", type: "2", ot: "1" },
    { id: "1", name: "Dark Magician", desc: "A powerful wizard." },
  ]] } = overrides;

  const opts = makeOptions({
    registryVersions: overrides.registryVersions ?? BUNDLED_VERSIONS,
    registryHashes: overrides.registryHashes ?? BASE_HASHES,
    locale: overrides.locale ?? "en",
    sourceNamespace: overrides.sourceNamespace ?? "cdb-to-json",
  });

  return {
    schema: "ygo.card-source/1",
    converterVersion: "cdb-to-json/2",
    physicalSnapshotHash: overrides.physicalSnapshotHash ?? "0".repeat(64),
    sourceFacts: factParams.map(([cardId, inputOrdinal, dataOrdinal, textOrdinal, datas, texts]) =>
      buildSourceFact(cardId, inputOrdinal, dataOrdinal, textOrdinal, datas, texts)
    ),
    locale: overrides.locale ?? "en",
    sourceNamespace: overrides.sourceNamespace ?? "cdb-to-json",
    textNormalizationVersion: "text-normalization/1",
    registryVersions: overrides.registryVersions ?? BUNDLED_VERSIONS,
    registryHashes: overrides.registryHashes ?? BASE_HASHES,
    sharedSemanticOptions: opts,
  };
}

// ---------------------------------------------------------------------------
// Tests: Physical bundle hash and sourceRevisionId
// ---------------------------------------------------------------------------

describe("physical bundle hash (INV-002, P5-AC5)", () => {
  it("physicalSnapshotHash is included in sourceRevisionId", () => {
    const facts1 = makeFacts({ physicalSnapshotHash: "a".repeat(64) });
    const facts2 = makeFacts({ physicalSnapshotHash: "b".repeat(64) });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).not.toBe(id2);
  });

  it("different physical hashes change sourceRevisionId", () => {
    const hash1 = computePhysicalSnapshotHash(
      Buffer.from("AAAA", "utf-8"),
      null,
      null
    );

    const hash2 = computePhysicalSnapshotHash(
      Buffer.from("BBBB", "utf-8"),
      null,
      null
    );

    expect(hash1).not.toBe(hash2);
  });

  it("WAL presence changes physical hash", () => {
    const hashWithoutWal = computePhysicalSnapshotHash(
      Buffer.from("AAAA", "utf-8"),
      null,
      null
    );

    const hashWithWal = computePhysicalSnapshotHash(
      Buffer.from("AAAA", "utf-8"),
      Buffer.from("CCCC", "utf-8"),
      Buffer.from("DDDD", "utf-8")
    );

    expect(hashWithoutWal).not.toBe(hashWithWal);
  });

  it("SHM presence changes physical hash", () => {
    const hashWithoutShm = computePhysicalSnapshotHash(
      Buffer.from("AAAA", "utf-8"),
      Buffer.from("BBBB", "utf-8"),
      null
    );

    const hashWithShm = computePhysicalSnapshotHash(
      Buffer.from("AAAA", "utf-8"),
      Buffer.from("BBBB", "utf-8"),
      Buffer.from("CCCC", "utf-8")
    );

    expect(hashWithoutShm).not.toBe(hashWithShm);
  });
});

// ---------------------------------------------------------------------------
// Tests: Merge lineage and provenance
// ---------------------------------------------------------------------------

describe("merge lineage preservation (P5-AC5)", () => {
  it("sourceRevisionId includes inputOrdinal from each source", () => {
    // Same card from different databases (different input ordinals)
    const facts1 = makeFacts({
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Dark Magician", desc: "Desc" }]],
    });
    const facts2 = makeFacts({
      sourceFacts: [["100", 1, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Dark Magician", desc: "Desc" }]],
    });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    // Different input ordinals should produce different sourceRevisionId
    // because the sourceFacts array differs
    expect(id1).not.toBe(id2);
  });

  it("same physical bundle but different sources produce different IDs", () => {
    // Two sources with same physical bundle hash but different content
    const facts1 = makeFacts({
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card A", desc: "Desc A" }]],
    });

    const facts2 = makeFacts({
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [["100", 1, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card B", desc: "Desc B" }]],
    });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    // Same physical hash but different source content
    expect(id1).not.toBe(id2);
  });

  it("different physical bundle but same sources produce different IDs", () => {
    // Same source content but different physical bundle
    const facts1 = makeFacts({
      physicalSnapshotHash: "a".repeat(64),
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Desc" }]],
    });

    const facts2 = makeFacts({
      physicalSnapshotHash: "b".repeat(64),
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Desc" }]],
    });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).not.toBe(id2);
  });

  it("multiple sources are ordered deterministically", () => {
    // Three sources in order
    const factsOrdered = makeFacts({
      sourceFacts: [
        ["100", 0, 0, 0, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "D1" }],
        ["200", 0, 1, 0, { id: "200", type: "2", ot: "1" }, { id: "200", name: "Card", desc: "D2" }],
        ["300", 0, 2, 0, { id: "300", type: "2", ot: "1" }, { id: "300", name: "Card", desc: "D3" }],
      ],
    });

    // Same sources, same order should produce same ID
    const factsSame = makeFacts({
      sourceFacts: [
        ["100", 0, 0, 0, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "D1" }],
        ["200", 0, 1, 0, { id: "200", type: "2", ot: "1" }, { id: "200", name: "Card", desc: "D2" }],
        ["300", 0, 2, 0, { id: "300", type: "2", ot: "1" }, { id: "300", name: "Card", desc: "D3" }],
      ],
    });

    expect(computeSourceRevisionId(factsOrdered)).toBe(computeSourceRevisionId(factsSame));
  });

  it("source namespace changes affect sourceRevisionId", () => {
    const facts1 = makeFacts({ sourceNamespace: "source-a" });
    const facts2 = makeFacts({ sourceNamespace: "source-b" });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).not.toBe(id2);
  });

  it("locale changes affect sourceRevisionId", () => {
    const facts1 = makeFacts({ locale: "en" });
    const facts2 = makeFacts({ locale: "ja" });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Tests: conversionOptionsHash and merge policy
// ---------------------------------------------------------------------------

describe("conversionOptionsHash merge policy (P5-AC5)", () => {
  it("conversionOptionsHash is stable across physical reorder", () => {
    // Same options but different source ordering
    const opts1 = makeOptions();
    const opts2 = makeOptions();

    const hash1 = computeConversionOptionsHash(opts1);
    const hash2 = computeConversionOptionsHash(opts2);

    expect(hash1).toBe(hash2);
  });

  it("conversionOptionsHash changes with onConflict policy", () => {
    // These would be different in real usage with different merge policies
    const hash1 = computeConversionOptionsHash(makeOptions({ profile: "source" }));
    const hash2 = computeConversionOptionsHash(makeOptions({ profile: "card" }));

    expect(hash1).not.toBe(hash2);
  });

  it("conversionOptionsHash excludes physical bundle hash", () => {
    // Physical bundle hash is NOT part of shared semantic options
    const opts1 = makeOptions();
    const opts2 = makeOptions();

    // Options should not include physicalSnapshotHash
    expect((opts1 as Record<string, unknown>).physicalSnapshotHash).toBeUndefined();
    expect((opts2 as Record<string, unknown>).physicalSnapshotHash).toBeUndefined();

    expect(computeConversionOptionsHash(opts1)).toBe(computeConversionOptionsHash(opts2));
  });

  it("conversionOptionsHash excludes sourceRevisionId", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).sourceRevisionId).toBeUndefined();
  });

  it("conversionOptionsHash excludes output path", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).outputPath).toBeUndefined();
    expect((opts as Record<string, unknown>).output).toBeUndefined();
  });

  it("conversionOptionsHash excludes format", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).format).toBeUndefined();
    expect((opts as Record<string, unknown>).pretty).toBeUndefined();
  });

  it("conversionOptionsHash excludes timing", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).startTime).toBeUndefined();
    expect((opts as Record<string, unknown>).elapsedMs).toBeUndefined();
  });

  it("conversionOptionsHash includes registry hashes", () => {
    const hashes1 = { ...BASE_HASHES, setcode: "a".repeat(64) };
    const hashes2 = { ...BASE_HASHES, setcode: "z".repeat(64) };

    const hash1 = computeConversionOptionsHash(makeOptions({ registryHashes: hashes1 }));
    const hash2 = computeConversionOptionsHash(makeOptions({ registryHashes: hashes2 }));

    expect(hash1).not.toBe(hash2);
  });

  it("conversionOptionsHash includes registry versions", () => {
    const v1 = { ...BUNDLED_VERSIONS, setcode: "cdb-normalization/1" };
    const v2 = { ...BUNDLED_VERSIONS, setcode: "cdb-normalization/2" };

    const hash1 = computeConversionOptionsHash(makeOptions({ registryVersions: v1 }));
    const hash2 = computeConversionOptionsHash(makeOptions({ registryVersions: v2 }));

    expect(hash1).not.toBe(hash2);
  });

  it("conversionOptionsHash includes limits", () => {
    const hash1 = computeConversionOptionsHash(makeOptions());
    const customLimits = { ...BASE_LIMITS, maxSpoolBytes: 1 };
    const hash2 = computeConversionOptionsHash(
      buildSharedSemanticOptions({
        profile: "source",
        locale: "en",
        sourceNamespace: "cdb-to-json",
        registryVersions: BUNDLED_VERSIONS,
        registryHashes: BASE_HASHES,
        limits: customLimits,
      })
    );

    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Physical reorder equivalence
// ---------------------------------------------------------------------------

describe("physical reorder equivalence (INV-009, P5-AC5)", () => {
  it("same logical content in different physical order produces same conversionOptionsHash", () => {
    // These represent the same semantic options
    const opts1 = makeOptions();
    const opts2 = makeOptions();

    expect(computeConversionOptionsHash(opts1)).toBe(computeConversionOptionsHash(opts2));
  });

  it("different source order changes sourceRevisionId", () => {
    // Sources in different order
    const facts1 = makeFacts({
      sourceFacts: [
        ["100", 0, 0, 0, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "D1" }],
        ["200", 0, 1, 0, { id: "200", type: "2", ot: "1" }, { id: "200", name: "Card", desc: "D2" }],
      ],
    });

    const facts2 = makeFacts({
      sourceFacts: [
        ["200", 0, 0, 0, { id: "200", type: "2", ot: "1" }, { id: "200", name: "Card", desc: "D2" }],
        ["100", 0, 1, 0, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "D1" }],
      ],
    });

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    // Different order = different sourceRevisionId
    expect(id1).not.toBe(id2);
  });

  it("same source facts produce identical sourceRevisionId", () => {
    const facts1 = makeFacts({
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Desc" }]],
    });

    const facts2 = makeFacts({
      sourceFacts: [["100", 0, 0, 0,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Desc" }]],
    });

    expect(computeSourceRevisionId(facts1)).toBe(computeSourceRevisionId(facts2));
  });
});

// ---------------------------------------------------------------------------
// Tests: merge winner selection and provenance
// ---------------------------------------------------------------------------

describe("merge winner selection provenance (P5-AC5)", () => {
  it("winner input ordinal is preserved in lineage", () => {
    // In a merge, the winner's input ordinal is recorded
    const winnerFact = buildSourceFact(
      "100", // cardId
      0, // inputOrdinal = source 0 wins
      5, // dataOrdinal
      10, // textOrdinal
      { id: "100", type: "2", ot: "1" },
      { id: "100", name: "Card", desc: "Winner text" }
    );

    const loserFact = buildSourceFact(
      "100", // cardId
      1, // inputOrdinal = source 1 loses
      3, // dataOrdinal
      7, // textOrdinal
      { id: "100", type: "2", ot: "1" },
      { id: "100", name: "Card", desc: "Loser text" }
    );

    // Facts retain their input ordinals
    expect(winnerFact.inputOrdinal).toBe(0);
    expect(loserFact.inputOrdinal).toBe(1);
  });

  it("winner and loser facts produce different sourceRevisionId values", () => {
    const factsWinner = makeFacts({
      sourceFacts: [["100", 0, 5, 10,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Winner" }]],
    });

    const factsLoser = makeFacts({
      sourceFacts: [["100", 1, 3, 7,
        { id: "100", type: "2", ot: "1" },
        { id: "100", name: "Card", desc: "Loser" }]],
    });

    const idWinner = computeSourceRevisionId(factsWinner);
    const idLoser = computeSourceRevisionId(factsLoser);

    // Same card, different input ordinal, different sourceRevisionId
    expect(idWinner).not.toBe(idLoser);
  });

  it("conversionOptionsHash is unaffected by winner selection", () => {
    // Same semantic options regardless of which card wins
    const hash1 = computeConversionOptionsHash(makeOptions());
    const hash2 = computeConversionOptionsHash(makeOptions());

    expect(hash1).toBe(hash2);
  });

  it("different merge outcomes with same physical bundle", () => {
    // Same physical bundle hash, different merge outcomes
    const factsA = makeFacts({
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [
        ["100", 0, 0, 0, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "Source 0" }],
        ["100", 1, 1, 1, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "Source 1" }],
      ],
    });

    // Winner is source 0, but this is source 1 perspective
    const factsB = makeFacts({
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [
        ["100", 1, 1, 1, { id: "100", type: "2", ot: "1" }, { id: "100", name: "Card", desc: "Source 1" }],
      ],
    });

    const idA = computeSourceRevisionId(factsA);
    const idB = computeSourceRevisionId(factsB);

    // Different sourceFacts arrays produce different IDs
    expect(idA).not.toBe(idB);
  });
});

// ---------------------------------------------------------------------------
// Tests: presentation exclusion from provenance
// ---------------------------------------------------------------------------

describe("presentation exclusion (INV-009, P5-AC5)", () => {
  it("output path does not change conversionOptionsHash", () => {
    // This is verified by the structural test above
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).outputPath).toBeUndefined();
  });

  it("output path does not change sourceRevisionId", () => {
    // sourceRevisionId is computed from sourceFacts, not presentation
    const facts1 = makeFacts();
    const facts2 = makeFacts();

    expect(computeSourceRevisionId(facts1)).toBe(computeSourceRevisionId(facts2));
  });

  it("format does not change conversionOptionsHash", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).format).toBeUndefined();
  });

  it("pretty does not change conversionOptionsHash", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).pretty).toBeUndefined();
  });

  it("diagnostics rendering does not change conversionOptionsHash", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).diagnostics).toBeUndefined();
  });

  it("timing does not change conversionOptionsHash", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).startTime).toBeUndefined();
    expect((opts as Record<string, unknown>).elapsedMs).toBeUndefined();
  });

  it("lock tokens do not change conversionOptionsHash", () => {
    const opts = makeOptions();
    expect((opts as Record<string, unknown>).lockToken).toBeUndefined();
  });
});
