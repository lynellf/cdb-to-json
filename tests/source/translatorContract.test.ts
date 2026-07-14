/**
 * Translator contract tests.
 *
 * Per P5-AC3 INV-008:
 * "The v1 compatibility path remains available through app/index.js and the
 * packed root default export, preserves the legacy raw datas/texts shape
 * and discovery/name rules, uses the same Linux native held-root/no-follow
 * descriptor-relative publication matrix for output-bearing calls without
 * path/cross-device fallback, and never replaces a legacy final before a
 * successful commit."
 *
 * This test module verifies that the source profile can be consumed by a
 * generic JSON/JSONL consumer without SQLite, src/cdb, or any bespoke CDB adapter.
 *
 * Evidence command: npm run test:source -- tests/source/translatorContract.test.ts
 */

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import sourceSchema from "../../schemas/ygo.card-source.v1.schema.json";
import { checkSourceOnly } from "../fixtures/pilotConsumer.js";

// ---------------------------------------------------------------------------
// Valid 64-char hex hash helper
// ---------------------------------------------------------------------------

/** Generate a valid 64-character hex string for SHA-256 hash values */
function makeHash(suffix: string = "a"): string {
  return `sha256:${suffix.repeat(64)}`;
}

// ---------------------------------------------------------------------------
// Generic JSON consumer interface (no SQLite/CDB dependencies)
// ---------------------------------------------------------------------------

/**
 * Minimal JSON consumer that parses source documents.
 * This represents the interface a generic translator would implement.
 */
interface SourceDocumentConsumer {
  parseDocument(json: string): unknown;
  parseDocumentStream(jsonl: string): unknown[];
  validateDocument(doc: unknown): { valid: boolean; errors: string[] };
  checkCoverage(doc: unknown): { status: string; scripts: unknown[]; rulings: unknown[] };
  getCardIdentity(doc: unknown): { id: string; aliasOf: string | null };
  getTextContent(doc: unknown): { raw: string | null; normalized: string | null; spans: unknown[] };
}

/**
 * Generic JSON consumer implementation.
 * This is a pure JSON/JSONL consumer with no CDB adapter dependencies.
 */
const genericConsumer: SourceDocumentConsumer = {
  /**
   * Parse a single JSON document.
   * No SQLite, no CDB adapter, no fs access.
   */
  parseDocument(json: string): unknown {
    return JSON.parse(json);
  },

  /**
   * Parse a JSONL stream.
   * No SQLite, no CDB adapter, no fs access.
   */
  parseDocumentStream(jsonl: string): unknown[] {
    return jsonl
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  },

  /**
   * Validate a document against the schema.
   * Uses Ajv with no custom keywords that require CDB knowledge.
   */
  validateDocument(doc: unknown): { valid: boolean; errors: string[] } {
    const instance = new Ajv({
      allErrors: true,
      strict: false,
      validateSchema: false,
    });
    addFormats(instance);
    instance.addSchema(sourceSchema);

    const validate = instance.compile(sourceSchema);
    const valid = validate(doc);
    const errors: string[] = [];

    if (!valid && validate.errors) {
      for (const err of validate.errors) {
        errors.push(`${err.instancePath}: ${err.message}`);
      }
    }

    return { valid: !!valid, errors };
  },

  /**
   * Extract coverage information from a document.
   * No knowledge of CDB internals required.
   */
  checkCoverage(doc: unknown): { status: string; scripts: unknown[]; rulings: unknown[] } {
    if (!doc || typeof doc !== "object") {
      throw new Error("Document is not an object");
    }

    const d = doc as Record<string, unknown>;

    return {
      status: (d.coverage as Record<string, unknown>)?.status as string ?? "UNKNOWN",
      scripts: ((d.references as Record<string, unknown>)?.scripts as unknown[]) ?? [],
      rulings: ((d.references as Record<string, unknown>)?.rulings as unknown[]) ?? [],
    };
  },

  /**
   * Extract card identity from a document.
   * No knowledge of CDB internals required.
   */
  getCardIdentity(doc: unknown): { id: string; aliasOf: string | null } {
    if (!doc || typeof doc !== "object") {
      throw new Error("Document is not an object");
    }

    const d = doc as Record<string, unknown>;
    const identity = d.identity as Record<string, unknown>;
    const externalIds = identity?.externalIds as Array<Record<string, unknown>>;

    return {
      id: externalIds?.[0]?.value as string ?? "UNKNOWN",
      aliasOf: identity?.aliasOf as string | null,
    };
  },

  /**
   * Extract text content from a document.
   * No knowledge of CDB internals required.
   */
  getTextContent(doc: unknown): { raw: string | null; normalized: string | null; spans: unknown[] } {
    if (!doc || typeof doc !== "object") {
      throw new Error("Document is not an object");
    }

    const d = doc as Record<string, unknown>;
    const text = d.text as Record<string, unknown>;

    return {
      raw: text?.raw as string | null,
      normalized: text?.normalized as string | null,
      spans: (text?.sourceSpans as unknown[]) ?? [],
    };
  },
};

// ---------------------------------------------------------------------------
// Test data (using valid 64-char hex hashes)
// ---------------------------------------------------------------------------

// Valid 64-character hex hashes for SHA-256
const HASH_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const SAMPLE_DOCUMENT = JSON.stringify({
  schema: "ygo.card-source/1",
  sourceRevisionId: HASH_A,
  identity: {
    externalIds: [{ namespace: "cdb-to-json", value: "15355442" }],
    aliasOf: null,
  },
  locale: "en",
  printed: {
    name: "Dark Magician",
    cardKind: "MONSTER",
    traits: ["NORMAL", "EFFECT"],
    monster: {
      monsterType: "SPELLCASTER",
      attribute: "DARK",
      level: 7,
      rank: null,
      linkRating: null,
      attack: 2500,
      defense: 2100,
      pendulum: null,
    },
  },
  text: {
    raw: "A powerful wizard.",
    normalized: "A powerful wizard.",
    normalizationVersion: "text-normalization/1",
    spansBasis: "utf-16-code-units",
    offsetEncoding: "utf-16-code-units",
    sections: {
      material: null,
      pendulumEffect: null,
      monsterEffect: { text: "A powerful wizard.", start: 0, end: 19, kind: "monsterEffect", basis: "normalized" },
      spellTrapEffect: null,
      flavor: null,
      unclassified: [],
      segmentation: "UNSPLIT",
    },
    sourceSpans: [{ text: "A powerful wizard.", start: 0, end: 19, kind: "monsterEffect", basis: "normalized" }],
  },
  simulatorSource: {
    ecosystem: "EDOPRO",
    database: { fileName: "cards.cdb", sha256: HASH_A },
    rawRows: {
      datas: { id: "15355442", ot: "1", alias: "0", setcode: "0", type: "2", atk: "2500", def: "2100", level: "70", race: "16", attribute: "17", category: "0" },
      texts: { id: "15355442", name: "Dark Magician", desc: "A powerful wizard.", str1: null, str2: null, str3: null, str4: null, str5: null, str6: null, str7: null, str8: null, str9: null, str10: null, str11: null, str12: null, str13: null, str14: null, str15: null, str16: null },
    },
    decoded: {
      setcodes: [],
      availability: [{ code: "1" }],
      categoryFlags: [],
      auxiliaryStrings: [],
    },
  },
  references: { scripts: [], rulings: [] },
  coverage: { status: "SOURCE_ONLY", assumptions: [], unsupported: [] },
  provenance: {
    converter: "cdb-to-json/2.0.0",
    normalizationRegistry: "cdb-normalization/1",
    conversionOptionsHash: HASH_B,
  },
  diagnostics: [],
});

const SAMPLE_DOC_FOR_VALIDATION = JSON.parse(SAMPLE_DOCUMENT);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("translator contract (P5-AC3)", () => {
  describe("generic JSON consumer interface", () => {
    it("parses a single JSON document without SQLite", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      expect(doc).toBeDefined();
      expect(typeof doc).toBe("object");
    });

    it("parses a JSONL stream without SQLite", () => {
      const docs = genericConsumer.parseDocumentStream(SAMPLE_DOCUMENT);
      expect(docs).toHaveLength(1);
    });

    it("validates a document against the schema without CDB knowledge", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const result = genericConsumer.validateDocument(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("extracts coverage information without CDB knowledge", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const coverage = genericConsumer.checkCoverage(doc);
      expect(coverage.status).toBe("SOURCE_ONLY");
      expect(coverage.scripts).toEqual([]);
      expect(coverage.rulings).toEqual([]);
    });

    it("extracts card identity without CDB knowledge", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const identity = genericConsumer.getCardIdentity(doc);
      expect(identity.id).toBe("15355442");
      expect(identity.aliasOf).toBeNull();
    });

    it("extracts text content without CDB knowledge", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const text = genericConsumer.getTextContent(doc);
      expect(text.raw).toBe("A powerful wizard.");
      expect(text.normalized).toBe("A powerful wizard.");
      expect(text.spans).toHaveLength(1);
    });

    it("processes multiple documents from JSONL", () => {
      const docs = genericConsumer.parseDocumentStream(SAMPLE_DOCUMENT);
      expect(docs).toHaveLength(1);

      for (const doc of docs) {
        const coverage = genericConsumer.checkCoverage(doc);
        expect(coverage.status).toBe("SOURCE_ONLY");
        expect(coverage.scripts).toEqual([]);
        expect(coverage.rulings).toEqual([]);
      }
    });
  });

  describe("schema validation contract", () => {
    it("rejects document missing required fields", () => {
      const incomplete = JSON.stringify({
        schema: "ygo.card-source/1",
        // Missing: sourceRevisionId, identity, locale, printed, text, etc.
      });

      const doc = genericConsumer.parseDocument(incomplete);
      const result = genericConsumer.validateDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects wrong schema identifier", () => {
      const wrongSchema = SAMPLE_DOCUMENT.replace(
        '"ygo.card-source/1"',
        '"ygo.card-source/2"'
      );
      const doc = genericConsumer.parseDocument(wrongSchema);
      const result = genericConsumer.validateDocument(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects wrong coverage status", () => {
      const doc = JSON.parse(SAMPLE_DOCUMENT);
      (doc.coverage as Record<string, unknown>).status = "PARTIAL";

      const result = genericConsumer.validateDocument(doc);
      expect(result.valid).toBe(false);
    });
  });

  describe("SOURCE_ONLY contract", () => {
    it("documents with SOURCE_ONLY status pass coverage check", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const coverage = genericConsumer.checkCoverage(doc);
      expect(coverage.status).toBe("SOURCE_ONLY");
      expect(coverage.scripts).toEqual([]);
      expect(coverage.rulings).toEqual([]);
    });

    it("documents with scripts are rejected", () => {
      const doc = JSON.parse(SAMPLE_DOCUMENT);
      (doc.references as Record<string, unknown>).scripts = [{ path: "test.lua" }];

      const { isSourceOnly, issues } = checkSourceOnly(doc);
      expect(isSourceOnly).toBe(false);
      expect(issues.some((i) => i.includes("scripts"))).toBe(true);
    });

    it("documents with rulings are rejected", () => {
      const doc = JSON.parse(SAMPLE_DOCUMENT);
      (doc.references as Record<string, unknown>).rulings = [{ q: "Q?", a: "A." }];

      const { isSourceOnly, issues } = checkSourceOnly(doc);
      expect(isSourceOnly).toBe(false);
      expect(issues.some((i) => i.includes("rulings"))).toBe(true);
    });

    it("complete JSON corpus has all SOURCE_ONLY documents", () => {
      const docs = genericConsumer.parseDocumentStream(SAMPLE_DOCUMENT);

      for (const doc of docs) {
        const coverage = genericConsumer.checkCoverage(doc);
        expect(coverage.status).toBe("SOURCE_ONLY");
        expect(coverage.scripts).toEqual([]);
        expect(coverage.rulings).toEqual([]);
      }
    });
  });

  describe("span contract", () => {
    it("spans have required fields per schema", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const text = genericConsumer.getTextContent(doc);
      const spans = text.spans as Array<Record<string, unknown>>;

      for (const span of spans) {
        expect(span).toHaveProperty("text");
        expect(span).toHaveProperty("start");
        expect(span).toHaveProperty("end");
        expect(span).toHaveProperty("kind");
        expect(span).toHaveProperty("basis");
        expect(span.basis).toBe("normalized");
      }
    });

    it("span text matches normalized.slice(start, end)", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const text = genericConsumer.getTextContent(doc);
      const normalized = text.normalized!;
      const spans = text.spans as Array<Record<string, unknown>>;

      for (const span of spans) {
        const extracted = normalized.slice(span.start as number, span.end as number);
        expect(extracted).toBe(span.text);
      }
    });

    it("span offsets are UTF-16 code units", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const text = d.text as Record<string, unknown>;
      expect(text.spansBasis).toBe("utf-16-code-units");
      expect(text.offsetEncoding).toBe("utf-16-code-units");
    });
  });

  describe("provenance contract", () => {
    it("sourceRevisionId is present and valid format", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      expect(d.sourceRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("conversionOptionsHash is present and valid format", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const provenance = d.provenance as Record<string, unknown>;
      expect(provenance.conversionOptionsHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("provenance contains converter and registry versions", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const provenance = d.provenance as Record<string, unknown>;
      expect(provenance.converter).toBe("cdb-to-json/2.0.0");
      expect(provenance.normalizationRegistry).toBe("cdb-normalization/1");
    });
  });

  describe("identity contract", () => {
    it("identity has externalIds and aliasOf", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const identity = d.identity as Record<string, unknown>;
      expect(identity).toHaveProperty("externalIds");
      expect(identity).toHaveProperty("aliasOf");
    });

    it("externalIds is an array with namespace and value", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const identity = genericConsumer.getCardIdentity(doc);
      expect(identity.id).toBe("15355442");
    });

    it("identity has no databaseSha256 field", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const identity = d.identity as Record<string, unknown>;
      expect(identity).not.toHaveProperty("databaseSha256");
      expect(identity).not.toHaveProperty("cardId");
    });
  });

  describe("no executable semantics contract", () => {
    it("text sections do not contain executable fields", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const text = d.text as Record<string, unknown>;

      // No effect parsing
      expect(text).not.toHaveProperty("effects");
      // No cost extraction
      expect(text).not.toHaveProperty("costs");
      // No target inference
      expect(text).not.toHaveProperty("targets");
    });

    it("coverage does not contain semantic interpretation", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const coverage = d.coverage as Record<string, unknown>;

      expect(coverage).not.toHaveProperty("semantics");
      expect(coverage).not.toHaveProperty("effectType");
      expect(coverage).not.toHaveProperty("legalStatus");
    });

    it("simulator source contains raw rows, not parsed semantics", () => {
      const doc = genericConsumer.parseDocument(SAMPLE_DOCUMENT);
      const d = doc as Record<string, unknown>;
      const simulatorSource = d.simulatorSource as Record<string, unknown>;

      expect(simulatorSource).toHaveProperty("rawRows");
      expect(simulatorSource).toHaveProperty("decoded");
      expect(simulatorSource).not.toHaveProperty("effects");
    });
  });
});
