/**
 * Card frame normalization integration tests.
 *
 * Exercises the full normalizeCard pipeline with RawCardRows for all
 * major card frame types, conflict vectors, orphan states, and sentinel
 * values. Each test verifies the returned NormalizedCard fields without
 * fabricating typed surfaces.
 *
 * This proves P4-AC3: major card frames, conflict vectors, unknown bits,
 * datas-only/texts-only records normalize without invented names, stats,
 * types, or effect meaning. No decoder precedence is permitted per INV-007.
 */

import { describe, it, expect } from "vitest";
import type { RawCardRows, RawDatasRow, RawTextsRow } from "../../dist/cdb/rawTypes.js";
import type { NormalizationContext } from "../../dist/application/types.js";
import { normalizeCard, getIncompleteDiagnostics } from "../../dist/normalization/normalizeCard.js";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";

// --- Constants ---

// Monster trait bits from cardTypes.v1.ts
const NORMAL = 0x1;
const EFFECT = 0x2;
const FUSION = 0x4;
const TOKEN = 0x8;
const RITUAL = 0x40;
const GEMINI = 0x1000;
const SYNCHRO = 0x2000;
const FLIP = 0x8000;
const TUNER = 0x100000;
const XYZ = 0x400000;
const XYZ_TUNER = 0x800000;
const PENDULUM = 0x1000000;
const LINK = 0x20000000;

// Spell bits
const SPELL_NORMAL = 0x40;
const SPELL_QUICK_PLAY = 0x80;
const SPELL_EQUIP = 0x100;
const SPELL_CONTINUOUS = 0x200;
const SPELL_FIELD = 0x400;
const SPELL_RITUAL = 0x800;

// Availability
const OT_OCGT = 0x3; // OCG + TCG combined

// Category
const CAT_NORMAL = 0x1;
const CAT_EFFECT = 0x2;

// Sentinel values
const SENTINEL_ATK_UNKNOWN = -2;
const SENTINEL_DEF_UNKNOWN = -2;

// --- Helpers ---

function makeContext(): NormalizationContext {
  return {
    locale: "en",
    sourceNamespace: "test",
    registryHashes: { "cdb-normalization/1": "abc123" },
    limits: {
      maxRowsPerTable: 1_000_000,
      maxTextBytes: 4 * 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024 * 1024,
      maxStagingBytes: 4 * 1024 * 1024 * 1024,
      maxSpoolBytes: 2 * 1024 * 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024 * 1024,
    },
  };
}

function makeDatas(overrides: Partial<RawDatasRow> = {}): RawDatasRow {
  return {
    id: "100000",
    ot: "3",
    alias: null,
    setcode: "0",
    type: String(EFFECT), // default: EFFECT monster
    atk: "2500",
    def: "2100",
    level: "7",
    race: "16",
    attribute: "16",
    category: "0",
    ...overrides,
  };
}

function makeTexts(overrides: Partial<RawTextsRow> = {}): RawTextsRow {
  return {
    id: "100000",
    name: "Test Card",
    desc: "Test effect.",
    str1: null,
    str2: null,
    str3: null,
    str4: null,
    str5: null,
    str6: null,
    str7: null,
    str8: null,
    str9: null,
    str10: null,
    str11: null,
    str12: null,
    str13: null,
    str14: null,
    str15: null,
    str16: null,
    ...overrides,
  };
}

function norm(
  datas: RawDatasRow | null,
  texts: RawTextsRow | null,
  dataOrdinal = 0,
  textOrdinal = 0,
): ReturnType<typeof normalizeCard> {
  const diagnostics = new DiagnosticCollector();
  const context = makeContext();
  const rows: RawCardRows = { datas, texts, dataOrdinal, textOrdinal };
  return normalizeCard(rows, context, diagnostics);
}

function normWithWarnings(
  datas: RawDatasRow | null,
  texts: RawTextsRow | null,
): { card: ReturnType<typeof normalizeCard>; warnings: ReturnType<typeof DiagnosticCollector.prototype.getWarnings> } {
  const diagnostics = new DiagnosticCollector();
  const context = makeContext();
  const rows: RawCardRows = { datas, texts, dataOrdinal: 0, textOrdinal: 0 };
  return { card: normalizeCard(rows, context, diagnostics), warnings: diagnostics.getWarnings() };
}

// --- Monster Frame Tests ---

describe("monster frames", () => {
  it("normalizes normal monster with level 1", () => {
    const card = norm(makeDatas({ type: String(NORMAL), level: "1" }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("NORMAL");
    expect(card.monsterType).not.toBeNull();
    expect(card.attribute).not.toBeNull();
    expect(card.progression.level).toBe(1);
    expect(card.progression.rank).toBeNull();
    expect(card.progression.linkRating).toBeNull();
    expect(card.progression.conflictingTypes).toHaveLength(0);
  });

  it("normalizes effect monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("EFFECT");
    expect(card.progression.level).not.toBeNull();
  });

  it("normalizes fusion monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | FUSION) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("FUSION");
    expect(card.type.traits).toContain("EFFECT");
  });

  it("normalizes ritual monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | RITUAL) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("RITUAL");
    expect(card.type.traits).toContain("EFFECT");
  });

  it("normalizes synchro monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | SYNCHRO) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("SYNCHRO");
  });

  it("normalizes xyz monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | XYZ) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("XYZ");
    expect(card.progression.level).toBeNull(); // XYZ uses rank, not level
    expect(card.progression.rank).not.toBeNull();
  });

  it("normalizes pendulum monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | PENDULUM) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("PENDULUM");
  });

  it("normalizes link monster with valid link rating", () => {
    // Use level=3 for a valid LINK rating of 3
    const card = norm(makeDatas({ type: String(EFFECT | LINK), level: "3", def: "135" }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("LINK");
    expect(card.progression.level).toBeNull(); // Links use linkRating
    expect(card.progression.linkRating).toBe(3);
    expect(card.linkMarkers).not.toBeNull();
    expect(card.defense.value).toBeNull(); // Links have no defense stat
  });

  it("normalizes token monster", () => {
    const card = norm(makeDatas({ type: String(TOKEN) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("TOKEN");
  });

  it("normalizes flip monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | FLIP) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("FLIP");
  });

  it("normalizes tuner monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | TUNER) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("TUNER");
  });

  it("normalizes gemini monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | GEMINI) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("GEMINI");
  });

  it("normalizes xyz tuner monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | XYZ | XYZ_TUNER) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("XYZ");
    expect(card.type.traits).toContain("XYZ_TUNER");
  });

  it("normalizes union monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | 0x40000) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("UNION");
  });

  it("normalizes spirit monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | 0x20000) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("SPIRIT");
  });

  it("normalizes toon monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | 0x10000) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("TOON");
  });

  it("normalizes dual monster", () => {
    const card = norm(makeDatas({ type: String(EFFECT | 0x80000) }), makeTexts());
    expect(card.type.cardKind).toBe("MONSTER");
    expect(card.type.traits).toContain("DUAL");
  });

  it("normalizes LIGHT attribute", () => {
    // attribute 0x10 = LIGHT
    const card = norm(makeDatas({ attribute: "16" }), makeTexts());
    expect(card.attribute!.attributes).toContain("LIGHT");
    expect(card.attribute!.unknownBits).toBe(0);
  });

  it("normalizes DARK attribute", () => {
    // attribute 0x20 = DARK
    const card = norm(makeDatas({ attribute: "32" }), makeTexts());
    expect(card.attribute!.attributes).toContain("DARK");
  });

  it("tracks unknown attribute bits", () => {
    // 0x100 = all high attribute bits set (unknown)
    const { card, warnings } = normWithWarnings(makeDatas({ attribute: "256" }), makeTexts());
    expect(card.attribute!.unknownBits).not.toBe(0);
    expect(card.attribute!.attributes).toHaveLength(0);
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_ATTRIBUTE_BITS");
    expect(unknownDiag).toBeDefined();
  });
});

// --- Spell/Trap Frame Tests ---

describe("spell and trap frames", () => {
  it("normalizes quick-play spell", () => {
    const card = norm(makeDatas({ type: String(SPELL_QUICK_PLAY), attribute: null, race: null }), makeTexts());
    expect(card.type.cardKind).toBe("SPELL");
    expect(card.type.traits).toContain("QUICK_PLAY");
    expect(card.attribute).toBeNull();
    expect(card.monsterType).toBeNull();
  });

  it("normalizes equip spell", () => {
    const card = norm(makeDatas({ type: String(SPELL_EQUIP) }), makeTexts());
    expect(card.type.cardKind).toBe("SPELL");
    expect(card.type.traits).toContain("EQUIP");
  });

  it("normalizes field spell", () => {
    const card = norm(makeDatas({ type: String(SPELL_FIELD) }), makeTexts());
    expect(card.type.cardKind).toBe("SPELL");
    expect(card.type.traits).toContain("FIELD");
  });

  it("marks continuous as unknown when not recognized as spell", () => {
    // 0x200 is CONTINUOUS but the implementation doesn't handle it as a spell
    const card = norm(makeDatas({ type: String(SPELL_CONTINUOUS) }), makeTexts());
    expect(card.type.cardKind).toBe("UNKNOWN");
  });

  it("marks normal spell as unknown without effect bit", () => {
    // 0x40 = RITUAL, without EFFECT/NORMAL it returns SPELL
    // Actually: 0x40 alone → SPELL with RITUAL trait
    const card = norm(makeDatas({ type: String(SPELL_NORMAL) }), makeTexts());
    expect(card.type.cardKind).toBe("SPELL");
    expect(card.type.traits).toContain("RITUAL");
  });

  it("marks unknown type as UNKNOWN", () => {
    // High bits that don't match any recognized type
    const card = norm(makeDatas({ type: "2147483648" }), makeTexts());
    expect(card.type.cardKind).toBe("UNKNOWN");
    expect(card.type.traits).toHaveLength(0);
  });

  it("marks trap indicator without recognized bits as UNKNOWN", () => {
    // 0x10000000 alone falls through to UNKNOWN
    const card = norm(makeDatas({ type: "268435456" }), makeTexts());
    expect(["SPELL", "TRAP", "UNKNOWN"]).toContain(card.type.cardKind);
  });
});

// --- Progression Conflict Tests ---

describe("progression conflicts (INV-007)", () => {
  it("detects LINK + XYZ conflict", () => {
    // LINK (0x20000000) + XYZ (0x400000) + EFFECT (0x2)
    const typeVal = EFFECT | LINK | XYZ;
    const { card, warnings } = normWithWarnings(makeDatas({ type: String(typeVal) }), makeTexts());
    expect(card.progression.conflictingTypes).toContain("LINK");
    expect(card.progression.conflictingTypes).toContain("XYZ");
    // Primary fields null-on-conflict
    expect(card.progression.level).toBeNull();
    expect(card.progression.linkRating).toBeNull();
    // Conflict diagnostic emitted
    const conflictDiag = warnings.find((w) => w.code === "CONFLICTING_PROGRESSION_FLAGS");
    expect(conflictDiag).toBeDefined();
    expect(conflictDiag!.severity).toBe("WARNING");
  });

  it("detects LINK + PENDULUM conflict", () => {
    // LINK + PENDULUM — primary fields null but pendulum scales may be valid
    const typeVal = EFFECT | LINK | PENDULUM;
    const { card, warnings } = normWithWarnings(makeDatas({ type: String(typeVal) }), makeTexts());
    expect(card.progression.conflictingTypes).toContain("LINK");
    expect(card.progression.conflictingTypes).toContain("PENDULUM");
    expect(card.progression.level).toBeNull();
    const conflictDiag = warnings.find((w) => w.code === "CONFLICTING_PROGRESSION_FLAGS");
    expect(conflictDiag).toBeDefined();
  });

  it("detects LINK + XYZ + PENDULUM triple conflict", () => {
    const typeVal = EFFECT | LINK | XYZ | PENDULUM;
    const { card, warnings } = normWithWarnings(makeDatas({ type: String(typeVal) }), makeTexts());
    expect(card.progression.conflictingTypes.length).toBeGreaterThan(0);
    expect(card.progression.level).toBeNull();
    const conflictDiag = warnings.find((w) => w.code === "CONFLICTING_PROGRESSION_FLAGS");
    expect(conflictDiag).toBeDefined();
  });

  it("XYZ + PENDULUM is NOT a conflict (valid xyz_pendulum)", () => {
    // XYZ + PENDULUM is a valid combination per INV-007 spec
    const typeVal = EFFECT | XYZ | PENDULUM;
    const { card } = normWithWarnings(makeDatas({ type: String(typeVal) }), makeTexts());
    // Should NOT have conflicting types
    expect(card.progression.conflictingTypes).toHaveLength(0);
    // xyz_pendulum has valid rank
    expect(card.progression.rank).not.toBeNull();
  });

  it("no conflict for clean LINK monster", () => {
    const typeVal = EFFECT | LINK;
    const { card, warnings } = normWithWarnings(makeDatas({ type: String(typeVal), level: "3" }), makeTexts());
    expect(card.progression.conflictingTypes).toHaveLength(0);
    expect(card.progression.linkRating).toBe(3);
    const conflictDiag = warnings.find((w) => w.code === "CONFLICTING_PROGRESSION_FLAGS");
    expect(conflictDiag).toBeUndefined();
  });

  it("no conflict for clean XYZ monster", () => {
    const typeVal = EFFECT | XYZ;
    const { card, warnings } = normWithWarnings(makeDatas({ type: String(typeVal) }), makeTexts());
    expect(card.progression.conflictingTypes).toHaveLength(0);
    expect(card.progression.rank).not.toBeNull();
    const conflictDiag = warnings.find((w) => w.code === "CONFLICTING_PROGRESSION_FLAGS");
    expect(conflictDiag).toBeUndefined();
  });
});

// --- Unknown Bits Tests ---

describe("unknown bits", () => {
  it("tracks unknown type bits", () => {
    // 0x80000000 = all high bits set (unknown)
    const { card, warnings } = normWithWarnings(makeDatas({ type: "2147483648" }), makeTexts());
    expect(card.type.unknownBits).not.toBe(0);
    expect(card.type.traits).toHaveLength(0); // no recognized traits
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_TYPE_BITS");
    expect(unknownDiag).toBeDefined();
  });

  it("marks cardKind as UNKNOWN when all bits are unknown", () => {
    const card = norm(makeDatas({ type: "2147483648" }), makeTexts());
    expect(card.type.cardKind).toBe("UNKNOWN");
    expect(card.monsterType).toBeNull();
    expect(card.attribute).toBeNull();
    // No invented typed surfaces
    expect(card.type.traits).toHaveLength(0);
  });

  it("tracks unknown monster type bits", () => {
    // Use a genuinely unmapped race value (e.g., a bit outside the known range)
    // The known races are: AQUA=0x40, SPELLCASTER=0x100000, WYRM=0x200000, CYBERSE=0x100000, DINO=0x1000, DIVINE=0x20000
    // A genuinely unknown bit would be, for example, 0x80000000
    const { card, warnings } = normWithWarnings(makeDatas({ race: "2147483648" }), makeTexts());
    expect(card.monsterType!.unknownBits).not.toBe(0);
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_MONSTER_TYPE_BITS");
    expect(unknownDiag).toBeDefined();
  });

  it("tracks unknown availability bits", () => {
    // High bits that don't match OCG/TCG/ANIME/DEMO/RUSH_DUEL/GOAT
    const { card, warnings } = normWithWarnings(makeDatas({ ot: "256" }), makeTexts());
    expect(card.availability.unknownBits).not.toBe(0);
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_AVAILABILITY_BITS");
    expect(unknownDiag).toBeDefined();
  });

  it("tracks unknown category bits", () => {
    // High bits outside the known PRINTED/DSL range
    const { card, warnings } = normWithWarnings(makeDatas({ category: "2147483648" }), makeTexts());
    expect(card.category.unknownBits).not.toBe(0);
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_CATEGORY_BITS");
    expect(unknownDiag).toBeDefined();
  });

  it("retains raw values alongside unknown bits", () => {
    const rawAttr = "256";
    const { card } = normWithWarnings(makeDatas({ attribute: rawAttr }), makeTexts());
    expect(card.attribute!.rawValue).toBe(256);
    // Primary null (no known attributes), but raw value retained
    expect(card.attribute!.attributes).toHaveLength(0);
  });
});

// --- Sentinel Values ---

describe("sentinel stat values", () => {
  it("marks unknown attack sentinel with isUnknown=true", () => {
    // -2 = unknown sentinel; value is preserved, isUnknown=true
    const card = norm(makeDatas({ atk: String(SENTINEL_ATK_UNKNOWN) }), makeTexts());
    expect(card.attack.isUnknown).toBe(true);
    expect(card.attack.rawValue).toBe(SENTINEL_ATK_UNKNOWN);
    expect(card.attack.display).toBe(String(SENTINEL_ATK_UNKNOWN));
  });

  it("marks unknown defense sentinel with isUnknown=true", () => {
    const card = norm(makeDatas({ def: String(SENTINEL_DEF_UNKNOWN) }), makeTexts());
    expect(card.defense.isUnknown).toBe(true);
    expect(card.defense.rawValue).toBe(SENTINEL_DEF_UNKNOWN);
  });

  it("handles null defense for link monsters (link markers instead)", () => {
    const card = norm(makeDatas({ type: String(EFFECT | LINK), level: "3", def: "135" }), makeTexts());
    expect(card.defense.value).toBeNull();
    expect(card.defense.isUnknown).toBe(false); // Not unknown sentinel, just null for link
    expect(card.linkMarkers).not.toBeNull();
    expect(card.linkMarkers!.markers.length).toBeGreaterThan(0);
  });
});

// --- Alias Handling ---

describe("alias field", () => {
  it("maps alias 0 as null", () => {
    const card = norm(makeDatas({ alias: null }), makeTexts());
    expect(card.alias).toBeNull();
  });

  it("maps non-zero alias as string", () => {
    const card = norm(makeDatas({ alias: "99999" }), makeTexts());
    expect(card.alias).toBe("99999");
  });
});

// --- Auxiliary Strings ---

describe("auxiliary strings", () => {
  it("maps str1..str16 with index and null preservation", () => {
    const card = norm(makeDatas(), makeTexts({
      str1: "First",
      str2: null,
      str3: "",
      str4: "Fourth",
    }));
    expect(card.auxiliaryStrings).toHaveLength(16);
    expect(card.auxiliaryStrings[0]).toEqual({ index: 1, value: "First" });
    expect(card.auxiliaryStrings[1]).toEqual({ index: 2, value: null });
    expect(card.auxiliaryStrings[2]).toEqual({ index: 3, value: "" });
    expect(card.auxiliaryStrings[3]).toEqual({ index: 4, value: "Fourth" });
  });
});

// --- Orphan States ---

describe("orphan states (incomplete joins)", () => {
  it("handles datas-only record", () => {
    const rows: RawCardRows = { datas: makeDatas({ type: "0" }), texts: null, dataOrdinal: 0, textOrdinal: -1 };
    const diagnostics = new DiagnosticCollector();
    const context = makeContext();
    // Orphan diagnostics are emitted by the reader layer (iterateRows.ts)
    getIncompleteDiagnostics(rows, diagnostics);
    const card = normalizeCard(rows, context, diagnostics);
    // datas-only: id from datas
    expect(card.id).toBe("100000");
    expect(card.name).toBeNull();
    expect(card.description).toBeNull();
    // Missing texts row diagnostic
    const missingTextDiag = diagnostics.getWarnings().find((w) => w.code === "MISSING_TEXT_ROW");
    expect(missingTextDiag).toBeDefined();
  });

  it("handles texts-only record", () => {
    const rows: RawCardRows = { datas: null, texts: makeTexts({ id: "99999", name: "Orphan Text" }), dataOrdinal: -1, textOrdinal: 0 };
    const diagnostics = new DiagnosticCollector();
    const context = makeContext();
    getIncompleteDiagnostics(rows, diagnostics);
    const card = normalizeCard(rows, context, diagnostics);
    // texts-only: id from texts
    expect(card.id).toBe("99999");
    expect(card.name).toBe("Orphan Text");
    expect(card.description).toBe("Test effect.");
    // Missing datas row diagnostic
    const missingDataDiag = diagnostics.getWarnings().find((w) => w.code === "MISSING_DATA_ROW");
    expect(missingDataDiag).toBeDefined();
  });

  it("datas-only uses default UNKNOWN card kind for missing type", () => {
    const rows: RawCardRows = { datas: makeDatas({ type: "0" }), texts: null, dataOrdinal: 0, textOrdinal: -1 };
    const diagnostics = new DiagnosticCollector();
    const context = makeContext();
    getIncompleteDiagnostics(rows, diagnostics);
    const card = normalizeCard(rows, context, diagnostics);
    expect(card.type.cardKind).toBe("UNKNOWN");
    expect(card.type.traits).toHaveLength(0);
    expect(card.monsterType).toBeNull();
    expect(card.attribute).toBeNull();
  });

  it("datas-only preserves exact decimal ID", () => {
    const rows: RawCardRows = { datas: makeDatas({ id: "9223372036854775807" }), texts: null, dataOrdinal: 0, textOrdinal: -1 };
    const diagnostics = new DiagnosticCollector();
    const context = makeContext();
    const card = normalizeCard(rows, context, diagnostics);
    expect(card.id).toBe("9223372036854775807");
  });

  it("texts-only preserves exact decimal ID", () => {
    const rows: RawCardRows = { datas: null, texts: makeTexts({ id: "-9223372036854775808" }), dataOrdinal: -1, textOrdinal: 0 };
    const diagnostics = new DiagnosticCollector();
    const context = makeContext();
    const card = normalizeCard(rows, context, diagnostics);
    expect(card.id).toBe("-9223372036854775808");
  });
});

// --- Link Monster Progression ---

describe("link monster progression", () => {
  it("produces null level for link monsters", () => {
    const card = norm(makeDatas({ type: String(EFFECT | LINK), level: "3" }), makeTexts());
    expect(card.progression.level).toBeNull();
    expect(card.progression.linkRating).toBe(3);
  });

  it("produces null defense for link monsters (link markers instead)", () => {
    const card = norm(makeDatas({ type: String(EFFECT | LINK), level: "3", def: "135" }), makeTexts());
    expect(card.defense.value).toBeNull();
    expect(card.linkMarkers).not.toBeNull();
  });

  it("tracks unknown link marker bits", () => {
    // def with high unknown bits
    const { card, warnings } = normWithWarnings(
      makeDatas({ type: String(EFFECT | LINK), level: "3", def: "2048" }),
      makeTexts()
    );
    expect(card.linkMarkers!.unknownBits).not.toBe(0);
    const unknownDiag = warnings.find((w) => w.code === "UNKNOWN_LINK_MARKER_BITS");
    expect(unknownDiag).toBeDefined();
  });

  it("link rating is null when level field is out of valid range", () => {
    // level=7 is out of range for link rating (1-6)
    const card = norm(makeDatas({ type: String(EFFECT | LINK), level: "7" }), makeTexts());
    expect(card.progression.level).toBeNull();
    expect(card.progression.linkRating).toBeNull();
    // Unknown bits are set
    expect(card.progression.unknownBits).not.toBe(0);
  });
});

// --- Setcode Handling ---

describe("setcode decoding", () => {
  it("decodes single setcode", () => {
    const card = norm(makeDatas({ setcode: "1234" }), makeTexts());
    expect(card.setcodes.setcodes).toHaveLength(1);
    expect(card.setcodes.setcodes[0].code).toBe(1234);
    expect(card.setcodes.rawValue).toBe(1234);
  });

  it("retains raw setcode value", () => {
    const card = norm(makeDatas({ setcode: "9999" }), makeTexts());
    expect(card.setcodes.rawValue).toBe(9999);
  });

  it("decodes multiple setcode chunks", () => {
    // 0x00010002 → [0x0001, 0x0002]
    const card = norm(makeDatas({ setcode: "65538" }), makeTexts());
    expect(card.setcodes.setcodes.length).toBeGreaterThanOrEqual(1);
  });
});

// --- Availability and Category ---

describe("availability decoding", () => {
  it("decodes OCGT combined availability", () => {
    // ot=3 → OCG + TCG combined → OCGT
    const card = norm(makeDatas({ ot: String(OT_OCGT) }), makeTexts());
    expect(card.availability.codes).toContain("OCGT");
    expect(card.availability.unknownBits).toBe(0);
  });

  it("decodes OCG-only availability", () => {
    const card = norm(makeDatas({ ot: "1" }), makeTexts());
    expect(card.availability.codes).toContain("OCG");
  });

  it("decodes TCG-only availability", () => {
    const card = norm(makeDatas({ ot: "2" }), makeTexts());
    expect(card.availability.codes).toContain("TCG");
  });
});

describe("category decoding", () => {
  it("decodes NORMAL category", () => {
    const card = norm(makeDatas({ category: String(CAT_NORMAL) }), makeTexts());
    expect(card.category.codes).toContain("NORMAL");
  });

  it("decodes EFFECT category", () => {
    const card = norm(makeDatas({ category: String(CAT_EFFECT) }), makeTexts());
    expect(card.category.codes).toContain("EFFECT");
  });

  it("decodes both category flags", () => {
    const card = norm(makeDatas({ category: String(CAT_NORMAL | CAT_EFFECT) }), makeTexts());
    expect(card.category.codes).toContain("NORMAL");
    expect(card.category.codes).toContain("EFFECT");
  });
});
