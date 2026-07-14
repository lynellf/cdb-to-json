/**
 * Pilot contract validation tests.
 *
 * Per P5-AC3:
 * "The fixed 64-record pilot is accepted from both compact JSON and JSONL
 * by a generic consumer that imports only schemas and JSON parsing, and
 * every document is SOURCE_ONLY with no fabricated script or ruling reference."
 *
 * Evidence command: npm run test:source -- tests/source/pilotContract.test.ts
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import sourceSchema from "../../schemas/ygo.card-source.v1.schema.json";
import sourceAggregateSchema from "../../schemas/ygo.card-source-array.v1.schema.json";
import {
  validateJsonArray,
  validateJsonl,
  createSourceValidator,
  checkSourceOnly,
} from "../fixtures/pilotConsumer.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * A representative 64-record pilot corpus for testing.
 * These are the stable pilot IDs from tests/fixtures/pilot-ids.json.
 */
const PILOT_CORPUS = [
  { id: "-9223372036854775808", name: "INT64_MIN", type: 2 },
  { id: "-1000000000000", name: "NEG_TRILLION", type: 2 },
  { id: "-1", name: "NEG_ONE", type: 2 },
  { id: "0", name: "ZERO", type: 2 },
  { id: "1", name: "CARD_0001", type: 2 },
  { id: "2", name: "CARD_0002", type: 4 },
  { id: "3", name: "CARD_0003", type: 8 },
  { id: "4", name: "CARD_0004", type: 2 },
  { id: "5", name: "CARD_0005", type: 2 },
  { id: "10", name: "CARD_0010", type: 2 },
  { id: "100", name: "CARD_0100", type: 2 },
  { id: "1000", name: "CARD_1000", type: 2 },
  { id: "10000", name: "CARD_10000", type: 2 },
  { id: "100000", name: "CARD_100000", type: 2 },
  { id: "1000000", name: "CARD_1000000", type: 2 },
  { id: "10000000", name: "CARD_10000000", type: 2 },
  { id: "15355442", name: "DARK_MAGICIAN", type: 2 },
  { id: "46986414", name: "BLUE_EYES_WHITE_DRAGON", type: 2 },
  { id: "53183652", name: "DARK_HOLE", type: 4 },
  { id: "53186399", name: "RAIGEKI", type: 4 },
  { id: "70000000", name: "PILOT_70M", type: 2 },
  { id: "70000001", name: "PILOT_70M_1", type: 2 },
  { id: "70000002", name: "PILOT_70M_2", type: 2 },
  { id: "80000000", name: "PILOT_80M", type: 2 },
  { id: "80000001", name: "PILOT_80M_1", type: 2 },
  { id: "9223372036854775807", name: "INT64_MAX", type: 2 },
  { id: "70781173", name: "STARDUST_DRAGON", type: 2 },
  { id: "83764718", name: "CRIMSON_BLAZER", type: 2 },
  { id: "95169481", name: "DARK_MAGICIAN_GIRL", type: 2 },
  { id: "53183643", name: "MONSTER_REBORN", type: 4 },
  { id: "12580477", name: "DARK_MYSTIC", type: 4 },
  { id: "41426869", name: "CANADRIA", type: 8 },
  { id: "44519536", name: "TREMENDOUS_FIRE", type: 2 },
  { id: "16127481", name: "BLACK_LUSTER_SOLDIER", type: 2 },
  { id: "16135489", name: "GOSENKAI", type: 2 },
  { id: "66801074", name: "NUMERON_DRAGON", type: 2 },
  { id: "96510162", name: "OAFDRAGON", type: 2 },
  { id: "98234068", name: "HEXTAR", type: 2 },
  { id: "-739688", name: "TOKEN", type: 2 },
  { id: "30000001", name: "PILOT_30M_1", type: 2 },
  { id: "30000002", name: "PILOT_30M_2", type: 2 },
  { id: "30000003", name: "PILOT_30M_3", type: 2 },
  { id: "30000004", name: "PILOT_30M_4", type: 2 },
  { id: "30000005", name: "PILOT_30M_5", type: 2 },
  { id: "30000006", name: "PILOT_30M_6", type: 2 },
  { id: "30000007", name: "PILOT_30M_7", type: 2 },
  { id: "30000008", name: "PILOT_30M_8", type: 2 },
  { id: "30000009", name: "PILOT_30M_9", type: 2 },
  { id: "30000010", name: "PILOT_30M_10", type: 2 },
  { id: "40000000", name: "PILOT_40M", type: 2 },
  { id: "50000000", name: "PILOT_50M", type: 2 },
  { id: "60000000", name: "PILOT_60M", type: 2 },
  { id: "75000000", name: "PILOT_75M", type: 2 },
  { id: "85000000", name: "PILOT_85M", type: 2 },
  { id: "90000000", name: "PILOT_90M", type: 2 },
  { id: "95000000", name: "PILOT_95M", type: 2 },
  { id: "99000000", name: "PILOT_99M", type: 2 },
  { id: "99999998", name: "CARD_99M_MINUS_2", type: 2 },
  { id: "99999999", name: "CARD_99M", type: 2 },
  { id: "2147483647", name: "INT32_MAX", type: 2 },
  { id: "-2147483648", name: "INT32_MIN", type: 2 },
  { id: "4294967295", name: "UINT32_MAX", type: 2 },
  { id: "-9223372036854775807", name: "INT64_MIN_PLUS_ONE", type: 2 },
  { id: "50000001", name: "PILOT_50M_1", type: 2 },
];

/**
 * Build a synthetic source document for testing.
 */
function buildSyntheticSourceDoc(id: string, name: string, type: number, desc: string = "A powerful card.") {
  const cardKind = type === 2 ? "MONSTER" : type === 4 ? "SPELL" : type === 8 ? "TRAP" : "MONSTER";
  const isMonster = type === 2;

  return {
    schema: "ygo.card-source/1",
    sourceRevisionId: `sha256:${"a".repeat(64)}`,
    identity: {
      externalIds: [{ namespace: "cdb-to-json", value: id }],
      aliasOf: null,
    },
    locale: "en",
    printed: {
      name,
      cardKind,
      traits: isMonster ? ["NORMAL"] : [],
      monster: isMonster ? {
        monsterType: null,
        attribute: null,
        level: 4,
        rank: null,
        linkRating: null,
        attack: 1000,
        defense: 1000,
        pendulum: null,
      } : null,
    },
    text: {
      raw: desc,
      normalized: desc,
      normalizationVersion: "text-normalization/1",
      spansBasis: "utf-16-code-units",
      offsetEncoding: "utf-16-code-units",
      sections: {
        material: null,
        pendulumEffect: null,
        monsterEffect: desc ? { text: desc, start: 0, end: desc.length, kind: "monsterEffect", basis: "normalized" } : null,
        spellTrapEffect: null,
        flavor: null,
        unclassified: [],
        segmentation: "UNSPLIT",
      },
      sourceSpans: desc ? [{ text: desc, start: 0, end: desc.length, kind: "monsterEffect", basis: "normalized" }] : [],
    },
    simulatorSource: {
      ecosystem: "EDOPRO",
      database: { fileName: "pilot.cdb", sha256: `sha256:${"b".repeat(64)}` },
      rawRows: {
        datas: { id, ot: "1", alias: "0", setcode: "0", type: String(type), atk: "1000", def: "1000", level: "4", race: "16", attribute: "17", category: "0" },
        texts: { id, name, desc, str1: null, str2: null, str3: null, str4: null, str5: null, str6: null, str7: null, str8: null, str9: null, str10: null, str11: null, str12: null, str13: null, str14: null, str15: null, str16: null },
      },
      decoded: {
        setcodes: [],
        availability: [{ code: "1" }],
        categoryFlags: [],
        auxiliaryStrings: [],
      },
    },
    references: { scripts: [], rulings: [] },
    coverage: {
      status: "SOURCE_ONLY",
      assumptions: [],
      unsupported: [],
    },
    provenance: {
      converter: "cdb-to-json/2.0.0",
      normalizationRegistry: "cdb-normalization/1",
      conversionOptionsHash: `sha256:${"c".repeat(64)}`,
    },
    diagnostics: [],
  };
}

/**
 * Build the full 64-record pilot corpus as JSON and JSONL strings.
 */
function buildPilotCorpus() {
  const docs = PILOT_CORPUS.map(({ id, name, type }) =>
    buildSyntheticSourceDoc(id, name, type)
  );
  return {
    json: JSON.stringify(docs),
    jsonl: docs.map((d) => JSON.stringify(d)).join("\n") + "\n",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pilot contract (P5-AC3)", () => {
  const { json, jsonl } = buildPilotCorpus();

  describe("JSON format", () => {
    it("validates the 64-record JSON pilot corpus", () => {
      const result = validateJsonArray(json);
      expect(result.valid).toBe(true);
      expect(result.documentCount).toBe(64);
      expect(result.errors).toEqual([]);
    });

    it("validates against the frozen item schema", () => {
      const validator = createSourceValidator();
      const docs = JSON.parse(json);

      for (const doc of docs) {
        const { valid, errors } = (() => {
          const validate = validator.compile(sourceSchema);
          const valid = validate(doc);
          return { valid: !!valid, errors: validate.errors ?? [] };
        })();
        expect(valid, errors.map((e: { instancePath: string; message: string }) => `${e.instancePath}: ${e.message}`).join(", ")).toBe(true);
      }
    });

    it("validates against the aggregate schema", () => {
      const validator = createSourceValidator();
      const aggregateValidate = validator.compile(sourceAggregateSchema);
      const docs = JSON.parse(json);
      const valid = aggregateValidate(docs);
      expect(valid, JSON.stringify(aggregateValidate.errors)).toBe(true);
    });

    it("every document is SOURCE_ONLY", () => {
      const result = validateJsonArray(json);
      expect(result.sourceOnlyCount).toBe(64);
      expect(result.errors).toEqual([]);
    });

    it("no document has scripts or rulings", () => {
      const result = validateJsonArray(json);
      expect(result.hasScriptsOrRulings).toEqual([]);
    });
  });

  describe("JSONL format", () => {
    it("validates the 64-record JSONL pilot corpus", () => {
      const result = validateJsonl(jsonl);
      expect(result.valid).toBe(true);
      expect(result.documentCount).toBe(64);
      expect(result.errors).toEqual([]);
    });

    it("each line is a valid JSON object", () => {
      const lines = jsonl.split("\n").filter((l) => l.trim() !== "");
      expect(lines).toHaveLength(64);

      for (let i = 0; i < lines.length; i++) {
        expect(() => JSON.parse(lines[i])).not.toThrow();
      }
    });

    it("every line validates against the frozen item schema", () => {
      const validator = createSourceValidator();
      const lines = jsonl.split("\n").filter((l) => l.trim() !== "");

      for (let i = 0; i < lines.length; i++) {
        const doc = JSON.parse(lines[i]);
        const { valid, errors } = (() => {
          const validate = validator.compile(sourceSchema);
          const valid = validate(doc);
          return { valid: !!valid, errors: validate.errors ?? [] };
        })();
        expect(valid, `[line ${i}]: ${errors.map((e: { instancePath: string; message: string }) => `${e.instancePath}: ${e.message}`).join(", ")}`).toBe(true);
      }
    });

    it("every line is SOURCE_ONLY", () => {
      const lines = jsonl.split("\n").filter((l) => l.trim() !== "");
      let sourceOnlyCount = 0;

      for (const line of lines) {
        const doc = JSON.parse(line);
        const { isSourceOnly } = checkSourceOnly(doc);
        if (isSourceOnly) sourceOnlyCount++;
      }

      expect(sourceOnlyCount).toBe(64);
    });

    it("no line has scripts or rulings", () => {
      const result = validateJsonl(jsonl);
      expect(result.hasScriptsOrRulings).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("handles empty corpus", () => {
      const result = validateJsonArray("[]");
      expect(result.valid).toBe(true);
      expect(result.documentCount).toBe(0);
    });

    it("rejects invalid JSON", () => {
      const result = validateJsonArray("{ invalid }");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects root that is not an array", () => {
      const result = validateJsonArray('{"schema": "ygo.card-source/1"}');
      expect(result.valid).toBe(false);
    });

    it("rejects document without schema identifier", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2);
      // @ts-expect-error - intentionally missing required field
      delete doc.schema;

      const validator = createSourceValidator();
      const { valid, errors } = (() => {
        const validate = validator.compile(sourceSchema);
        const valid = validate(doc);
        return { valid: !!valid, errors: validate.errors ?? [] };
      })();

      expect(valid).toBe(false);
      expect(errors.some((e: { instancePath: string }) => e.instancePath === "" || e.instancePath === "/schema")).toBe(true);
    });

    it("rejects document without SOURCE_ONLY coverage", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2);
      doc.coverage.status = "PARTIAL"; // Invalid

      const { isSourceOnly, issues } = checkSourceOnly(doc);
      expect(isSourceOnly).toBe(false);
      expect(issues.some((i) => i.includes("SOURCE_ONLY"))).toBe(true);
    });

    it("rejects document with non-empty scripts", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2);
      doc.references.scripts = [{ path: "test.lua" }]; // Invalid

      const { isSourceOnly, issues } = checkSourceOnly(doc);
      expect(isSourceOnly).toBe(false);
      expect(issues.some((i) => i.includes("scripts"))).toBe(true);
    });

    it("rejects document with non-empty rulings", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2);
      doc.references.rulings = [{ q: "Q", a: "A" }]; // Invalid

      const { isSourceOnly, issues } = checkSourceOnly(doc);
      expect(isSourceOnly).toBe(false);
      expect(issues.some((i) => i.includes("rulings"))).toBe(true);
    });

    it("rejects JSONL with parse errors", () => {
      const invalidJsonl = '{"schema": "ygo.card-source/1"}\n{invalid json}\n';
      const result = validateJsonl(invalidJsonl);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("parse error"))).toBe(true);
    });
  });

  describe("span validation", () => {
    it("spans have required text/start/end/kind/basis fields", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2, "Effect text here.");
      const spans = doc.text.sourceSpans;

      for (const span of spans) {
        expect(typeof span.text).toBe("string");
        expect(typeof span.start).toBe("number");
        expect(typeof span.end).toBe("number");
        expect(typeof span.kind).toBe("string");
        expect(span.basis).toBe("normalized");
      }
    });

    it("each span text equals normalized.slice(start, end)", () => {
      const desc = "Effect text here.";
      const doc = buildSyntheticSourceDoc("1", "Test", 2, desc);
      const { normalized } = doc.text;

      for (const span of doc.text.sourceSpans) {
        const extracted = normalized!.slice(span.start, span.end);
        expect(extracted).toBe(span.text);
      }
    });

    it("rejects span with missing basis field", () => {
      const doc = buildSyntheticSourceDoc("1", "Test", 2, "Effect");
      doc.text.sourceSpans[0].basis = "raw"; // Invalid

      const validator = createSourceValidator();
      const { valid } = (() => {
        const validate = validator.compile(sourceSchema);
        return { valid: !!validate(doc) };
      })();

      expect(valid).toBe(false);
    });
  });

  describe("signed-int64 extrema", () => {
    it("handles INT64_MIN (-9223372036854775808)", () => {
      const doc = buildSyntheticSourceDoc("-9223372036854775808", "INT64_MIN", 2);
      expect(doc.identity.externalIds[0].value).toBe("-9223372036854775808");
    });

    it("handles INT64_MAX (9223372036854775807)", () => {
      const doc = buildSyntheticSourceDoc("9223372036854775807", "INT64_MAX", 2);
      expect(doc.identity.externalIds[0].value).toBe("9223372036854775807");
    });

    it("handles INT32 boundaries", () => {
      const min32 = buildSyntheticSourceDoc("-2147483648", "INT32_MIN", 2);
      const max32 = buildSyntheticSourceDoc("2147483647", "INT32_MAX", 2);

      expect(min32.identity.externalIds[0].value).toBe("-2147483648");
      expect(max32.identity.externalIds[0].value).toBe("2147483647");
    });

    it("handles UINT32_MAX (4294967295)", () => {
      const doc = buildSyntheticSourceDoc("4294967295", "UINT32_MAX", 2);
      expect(doc.identity.externalIds[0].value).toBe("4294967295");
    });
  });
});
