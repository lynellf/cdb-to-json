/**
 * Source profile schema validation tests.
 *
 * Tests per P5-AC2:
 * - Complete, datas-only, and texts-only documents validate
 * - No identity.databaseSha256 field
 * - Orphan null states are correct
 * - No executable semantic fields
 */

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import sourceSchema from "../../schemas/ygo.card-source.v1.schema.json";
import { mapCardToSource, createTestContext } from "../../src/profiles/sourceProfile.js";
import type { NormalizedCard } from "../../src/normalization/normalizeCard.js";

// ---------------------------------------------------------------------------
// Schema setup
// ---------------------------------------------------------------------------

/**
 * Creates a fresh Ajv instance with the source schema loaded.
 */
function createAjv(): Ajv {
  const instance = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(instance);
  // Add schema using its own $id
  instance.addSchema(sourceSchema);
  return instance;
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function createMinimalCard(id: string, overrides?: Partial<NormalizedCard>): NormalizedCard {
  return {
    id,
    name: null,
    description: null,
    auxiliaryStrings: [],
    type: {
      cardKind: "MONSTER",
      traits: ["NORMAL"],
      unknownBits: 0,
    },
    attribute: null,
    monsterType: null,
    progression: { level: null, rank: null, linkRating: null, pendulum: null, unknownBits: 0 },
    attack: { value: null, unknownBits: 0 },
    defense: { value: null, unknownBits: 0 },
    linkMarkers: null,
    setcodes: { setcodes: [], unknownBits: 0 },
    availability: { codes: [], unknownBits: 0 },
    category: { codes: [], unknownBits: 0 },
    alias: null,
    source: { databasePath: "/test.cdb", dataOrdinal: 0, textOrdinal: 0 },
    ...overrides,
  };
}

function createCompleteSourceDocument(overrides?: Partial<NormalizedCard>) {
  const card = createMinimalCard("1234", {
    name: "Dark Magician",
    description: "A powerful wizard.",
    type: { cardKind: "MONSTER", traits: ["NORMAL"], unknownBits: 0 },
    attribute: { attributes: ["DARK"], unknownBits: 0 },
    monsterType: { monsterTypes: ["SPELLCASTER"], unknownBits: 0 },
    progression: { level: 7, rank: null, linkRating: null, pendulum: null, unknownBits: 0 },
    attack: { value: 2500, unknownBits: 0 },
    defense: { value: 2100, unknownBits: 0 },
    ...overrides,
  });

  const context = createTestContext({
    locale: "en",
    sourceNamespace: "test-db",
    databaseFileName: "cards.cdb",
    databaseSha256: "sha256:" + "a".repeat(64),
    sourceRevisionId: "sha256:" + "b".repeat(64),
    conversionOptionsHash: "sha256:" + "c".repeat(64),
  });

  return mapCardToSource(card, {
    datas: { id: "1234", ot: "1", alias: "0", setcode: "0", type: "2", atk: "2500", def: "2100", level: "70", race: "16", attribute: "17", category: "0" },
    texts: { id: "1234", name: "Dark Magician", desc: "A powerful wizard.", str1: null, str2: null, str3: null, str4: null, str5: null, str6: null, str7: null, str8: null, str9: null, str10: null, str11: null, str12: null, str13: null, str14: null, str15: null, str16: null },
    dataOrdinal: 0,
    textOrdinal: 0,
  }, context);
}

// ---------------------------------------------------------------------------
// Complete document validation
// ---------------------------------------------------------------------------

describe("complete source document (P5-AC2)", () => {
  it("validates a complete card document", () => {
    const result = createCompleteSourceDocument();

    expect(result.ok).toBe(true);
    const doc = result.value;

    // Required top-level fields
    expect(doc.schema).toBe("ygo.card-source/1");
    expect(typeof doc.sourceRevisionId).toBe("string");
    expect(doc.identity).toBeDefined();
    expect(typeof doc.locale).toBe("string");
    expect(doc.printed).toBeDefined();
    expect(doc.text).toBeDefined();
    expect(doc.simulatorSource).toBeDefined();
    expect(doc.references).toBeDefined();
    expect(doc.coverage).toBeDefined();
    expect(doc.provenance).toBeDefined();
    expect(doc.diagnostics).toBeDefined();

    // Schema identifier
    expect(doc.schema).toBe("ygo.card-source/1");

    // Coverage status
    expect(doc.coverage.status).toBe("SOURCE_ONLY");

    // References are empty
    expect(doc.references.scripts).toEqual([]);
    expect(doc.references.rulings).toEqual([]);

    // Provenance fields
    expect(doc.provenance.converter).toBe("cdb-to-json/2.0.0");
    expect(doc.provenance.normalizationRegistry).toBe("cdb-normalization/1");
    expect(doc.provenance.conversionOptionsHash).toMatch(/^sha256:/);
  });

  it("validates against JSON Schema", () => {
    const result = createCompleteSourceDocument();
    expect(result.ok).toBe(true);

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(result.value);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("has correct identity structure (no databaseSha256)", () => {
    const result = createCompleteSourceDocument();
    expect(result.value.identity).toHaveProperty("externalIds");
    expect(result.value.identity).toHaveProperty("aliasOf");
    expect(result.value.identity).not.toHaveProperty("databaseSha256");
    expect(result.value.identity).not.toHaveProperty("cardId");
  });

  it("has correct text structure with sections and sourceSpans", () => {
    const result = createCompleteSourceDocument();
    const text = result.value.text;

    expect(text).toHaveProperty("raw");
    expect(text).toHaveProperty("normalized");
    expect(text).toHaveProperty("normalizationVersion");
    expect(text).toHaveProperty("spansBasis");
    expect(text).toHaveProperty("offsetEncoding");
    expect(text).toHaveProperty("sections");
    expect(text).toHaveProperty("sourceSpans");

    // Metadata values
    expect(text.normalizationVersion).toBe("text-normalization/1");
    expect(text.spansBasis).toBe("utf-16-code-units");
    expect(text.offsetEncoding).toBe("utf-16-code-units");
  });

  it("has correct simulatorSource structure", () => {
    const result = createCompleteSourceDocument();
    const src = result.value.simulatorSource;

    expect(src.ecosystem).toBe("EDOPRO");
    expect(src.database).toHaveProperty("fileName");
    expect(src.database).toHaveProperty("sha256");
    expect(src.rawRows).toBeDefined();
    expect(src.decoded).toBeDefined();
  });

  it("has no executable semantic fields", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // No effect parsing, cost extraction, or semantic interpretation
    expect(doc.text).not.toHaveProperty("effects");
    expect(doc.text).not.toHaveProperty("costs");
    expect(doc.text).not.toHaveProperty("conditions");
    expect(doc.text).not.toHaveProperty("targets");
    expect(doc.coverage).not.toHaveProperty("semantics");
  });
});

// ---------------------------------------------------------------------------
// Orphan document validation (datas-only, texts-only)
// ---------------------------------------------------------------------------

describe("orphan document validation (P5-AC2)", () => {
  it("validates datas-only orphan document", () => {
    const card = createMinimalCard("5678", {
      name: null, // No texts row
      description: null,
      source: { databasePath: "/test.cdb", dataOrdinal: 0, textOrdinal: null },
    });

    const context = createTestContext();
    const result = mapCardToSource(card, {
      datas: { id: "5678", ot: "1", alias: "0", setcode: "0", type: "2", atk: "0", def: "0", level: "4", race: "0", attribute: "0", category: "0" },
      texts: null, // No texts row
      dataOrdinal: 0,
      textOrdinal: null,
    }, context);

    expect(result.ok).toBe(true);
    expect(result.value.identity.externalIds).toHaveLength(1);

    // Printed fields
    expect(result.value.printed.name).toBeNull();
    expect(result.value.printed.cardKind).toBe("MONSTER");

    // Text fields
    expect(result.value.text.raw).toBeNull();
    expect(result.value.text.normalized).toBeNull();
    expect(result.value.text.sections.unclassified).toHaveLength(0);

    // Simulator source
    expect(result.value.simulatorSource.rawRows.datas).not.toBeNull();
    expect(result.value.simulatorSource.rawRows.texts).toBeNull();

    // Coverage assumptions
    expect(result.value.coverage.assumptions.some((a: string) => a.includes("datas row"))).toBe(true);

    // Schema validation
    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(result.value);
    expect(valid).toBe(true);
  });

  it("validates texts-only orphan document", () => {
    const card = createMinimalCard("9999", {
      name: "Unknown Card", // From texts row
      description: "Some effect text.", // From texts row
      type: { cardKind: "UNKNOWN", traits: [], unknownBits: 0 }, // No type info from datas
      source: { databasePath: "/test.cdb", dataOrdinal: null, textOrdinal: 0 },
    });

    const context = createTestContext();
    const result = mapCardToSource(card, {
      datas: null, // No datas row
      texts: { id: "9999", name: "Unknown Card", desc: "Some effect text.", str1: null, str2: null, str3: null, str4: null, str5: null, str6: null, str7: null, str8: null, str9: null, str10: null, str11: null, str12: null, str13: null, str14: null, str15: null, str16: null },
      dataOrdinal: null,
      textOrdinal: 0,
    }, context);

    expect(result.ok).toBe(true);

    // Printed fields
    expect(result.value.printed.name).toBe("Unknown Card");
    expect(result.value.printed.cardKind).toBe("UNKNOWN");
    expect(result.value.printed.monster).toBeNull(); // No type info from datas

    // Text fields
    expect(result.value.text.raw).toBe("Some effect text.");
    expect(result.value.text.normalized).toBe("Some effect text.");

    // Simulator source
    expect(result.value.simulatorSource.rawRows.datas).toBeNull();
    expect(result.value.simulatorSource.rawRows.texts).not.toBeNull();

    // Coverage assumptions
    expect(result.value.coverage.assumptions.some((a: string) => a.includes("texts row"))).toBe(true);

    // Schema validation
    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(result.value);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema rejection tests
// ---------------------------------------------------------------------------

describe("schema rejection (INV-001)", () => {
  it("rejects document without schema identifier", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // @ts-expect-error - intentionally missing required field
    delete doc.schema;

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(doc);
    expect(valid).toBe(false);
  });

  it("rejects document without identity", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // @ts-expect-error - intentionally missing required field
    delete doc.identity;

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(doc);
    expect(valid).toBe(false);
  });

  it("rejects document without text.sections", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // @ts-expect-error - intentionally missing required field
    delete doc.text.sections;

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(doc);
    expect(valid).toBe(false);
  });

  it("rejects document without text.sourceSpans", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // @ts-expect-error - intentionally missing required field
    delete doc.text.sourceSpans;

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(doc);
    expect(valid).toBe(false);
  });

  it("rejects document without coverage.status SOURCE_ONLY", () => {
    const result = createCompleteSourceDocument();
    const doc = result.value;

    // @ts-expect-error - intentionally wrong value
    doc.coverage.status = "PARTIAL";

    const ajv = createAjv();
    const validate = ajv.compile(sourceSchema);
    const valid = validate(doc);
    expect(valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Text slice validation
// ---------------------------------------------------------------------------

describe("text slice validation (INV-008)", () => {
  it("spans have required copied text/start/end/kind/basis", () => {
    const result = createCompleteSourceDocument();
    const spans = result.value.text.sourceSpans;

    for (const span of spans) {
      expect(typeof span.text).toBe("string");
      expect(typeof span.start).toBe("number");
      expect(typeof span.end).toBe("number");
      expect(typeof span.kind).toBe("string");
      expect(span.basis).toBe("normalized");
    }
  });

  it("each span text equals normalized.slice(start, end)", () => {
    const result = createCompleteSourceDocument();
    const { normalized } = result.value.text;

    if (normalized) {
      for (const span of result.value.text.sourceSpans) {
        const extracted = normalized.slice(span.start, span.end);
        expect(extracted).toBe(span.text);
      }
    }
  });
});
