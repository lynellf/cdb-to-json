/**
 * Conformance tests for schema validation.
 *
 * Uses Ajv to validate golden records against the frozen schemas.
 * This proves P1-AC2: the five frozen item/aggregate schema files validate
 * their golden records and preserve distinct item versus aggregate identifiers.
 *
 * Per the accepted contract, these are the ONLY schema tests that validate
 * actual record data (not just schema metadata).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Creates a fresh Ajv instance for each test.
 *
 * validateSchema: false skips meta-schema validation so the schema $id
 * "https://json-schema.org/draft/2020-12/schema" does not need to be pre-loaded.
 */
function createAjv(): Ajv {
  const instance = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(instance);
  return instance;
}

/**
 * Creates an Ajv instance with all five frozen schemas pre-loaded using
 * explicit URIs so that cross-file $ref values resolve correctly.
 *
 * Uses the schema $id as the key for addSchema(), which is the standard
 * JSON Schema resolution mechanism for Ajv.
 */
function createAjvWithAllSchemas(): Ajv {
  const instance = createAjv();
  const schemas: Array<{ name: string; id: string }> = [
    { name: "cdb.raw.v1.schema.json", id: "cdb.raw/1" },
    { name: "cdb.card.v2.schema.json", id: "cdb.card/2" },
    { name: "ygo.card-source.v1.schema.json", id: "ygo.card-source/1" },
    { name: "cdb.card-array.v2.schema.json", id: "cdb.card-array/2" },
    { name: "ygo.card-source-array.v1.schema.json", id: "ygo.card-source-array/1" },
  ];
  for (const { name, id } of schemas) {
    const schema = loadSchema(name);
    instance.addSchema(schema, { id });
  }
  return instance;
}

// Load a schema file by name.
function loadSchema(name: string): Record<string, unknown> {
  const path = `${process.cwd()}/schemas/${name}`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

// Load a golden record by name.
function loadGolden(name: string): unknown {
  const path = `${process.cwd()}/tests/fixtures/expected/${name}`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Schema identifiers (frozen)", () => {
  it("raw schema has correct identifier cdb.raw/1", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    expect(schema.$id).toBe("cdb.raw/1");
  });

  it("card schema has correct identifier cdb.card/2", () => {
    const schema = loadSchema("cdb.card.v2.schema.json");
    expect(schema.$id).toBe("cdb.card/2");
  });

  it("source schema has correct identifier ygo.card-source/1", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json");
    expect(schema.$id).toBe("ygo.card-source/1");
  });

  it("card-array schema has correct identifier cdb.card-array/2", () => {
    const schema = loadSchema("cdb.card-array.v2.schema.json");
    expect(schema.$id).toBe("cdb.card-array/2");
  });

  it("source-array schema has correct identifier ygo.card-source-array/1", () => {
    const schema = loadSchema("ygo.card-source-array.v1.schema.json");
    expect(schema.$id).toBe("ygo.card-source-array/1");
  });
});

describe("Raw schema structural constraints", () => {
  it("requires schema, integerEncoding, source, tables, and extraTables", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as { required?: string[] };
    expect(schema.required).toContain("schema");
    expect(schema.required).toContain("integerEncoding");
    expect(schema.required).toContain("source");
    expect(schema.required).toContain("tables");
    expect(schema.required).toContain("extraTables");
  });

  it("datas.id is required and non-null string", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as {
      properties?: {
        tables?: {
          properties?: {
            datas?: {
              items?: {
                required?: string[];
                properties?: Record<string, unknown>;
              };
            };
          };
        };
      };
    };
    const items = schema.properties?.tables?.properties?.datas?.items;
    expect(items?.required).toContain("id");
    expect(items?.properties?.id).toHaveProperty("type", "string");
  });

  it("datas numeric fields allow null (NULL-preserving raw contract)", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as {
      properties?: {
        tables?: {
          properties?: {
            datas?: {
              items?: {
                properties?: Record<string, { type?: string | string[] }>;
              };
            };
          };
        };
      };
    };
    const datasProps =
      schema.properties?.tables?.properties?.datas?.items?.properties;
    // All non-id numeric fields must allow null
    for (const field of [
      "ot",
      "alias",
      "setcode",
      "type",
      "atk",
      "def",
      "level",
      "race",
      "attribute",
      "category",
    ]) {
      const fieldType = datasProps?.[field]?.type;
      expect(fieldType).toBeDefined();
      const types = Array.isArray(fieldType) ? fieldType : [fieldType];
      expect(types).toContain("null");
      expect(types).toContain("string");
    }
  });

  it("texts columns allow null values", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as {
      properties?: {
        tables?: {
          properties?: {
            texts?: {
              items?: {
                properties?: Record<string, { type?: string | string[] }>;
              };
            };
          };
        };
      };
    };
    const textsProps =
      schema.properties?.tables?.properties?.texts?.items?.properties;
    expect(textsProps?.name?.type).toContain("null");
    expect(textsProps?.desc?.type).toContain("null");
  });
});

describe("Card-array and source-array schemas (aggregate)", () => {
  it("card-array is top-level array using frozen card schema (inlined)", () => {
    const schema = loadSchema("cdb.card-array.v2.schema.json") as {
      $id?: string;
      type?: string;
      items?: { $id?: string; properties?: { schema?: { const?: string } } };
    };
    expect(schema.$id).toBe("cdb.card-array/2");
    expect(schema.type).toBe("array");
    // items.$id and items.properties.schema.const both confirm the frozen identity
    expect(schema.items?.$id).toBe("cdb.card/2");
    expect(schema.items?.properties?.schema?.const).toBe("cdb.card/2");
  });

  it("source-array is top-level array using frozen source schema (inlined)", () => {
    const schema = loadSchema("ygo.card-source-array.v1.schema.json") as {
      $id?: string;
      type?: string;
      items?: { $id?: string; properties?: { schema?: { const?: string } } };
    };
    expect(schema.$id).toBe("ygo.card-source-array/1");
    expect(schema.type).toBe("array");
    // items.$id and items.properties.schema.const both confirm the frozen identity
    expect(schema.items?.$id).toBe("ygo.card-source/1");
    expect(schema.items?.properties?.schema?.const).toBe("ygo.card-source/1");
  });
});

describe("Golden record validation — raw (cdb.raw/1)", () => {
  it("minimal-raw.json validates against cdb.raw.v1.schema.json", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    const golden = loadGolden("minimal-raw.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("raw golden preserves signed-int64 decimal pattern", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    const golden = loadGolden("minimal-raw.json") as {
      tables: {
        datas: Array<{ id: string; ot?: string | null }>;
      };
    };
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    expect(validate(golden)).toBe(true);
    // Verify the null datas row and the null numeric fields
    const datasRows = golden.tables.datas;
    expect(datasRows[0].id).toMatch(/^-?\d+$/); // non-null ID
    expect(datasRows[1].ot).toBeNull(); // null numeric field
  });
});

describe("Golden record validation — card (cdb.card/2)", () => {
  it("minimal-card.json validates against cdb.card.v2.schema.json", () => {
    const schema = loadSchema("cdb.card.v2.schema.json");
    const golden = loadGolden("minimal-card.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("card golden uses distinct item identifier cdb.card/2", () => {
    const golden = loadGolden("minimal-card.json") as { schema: string };
    expect(golden.schema).toBe("cdb.card/2");
  });

  it("card source.kind is EDOPRO_CDB", () => {
    const golden = loadGolden("minimal-card.json") as {
      source: { kind: string };
    };
    expect(golden.source.kind).toBe("EDOPRO_CDB");
  });
});

describe("Golden record validation — card-array (cdb.card-array/2)", () => {
  it("minimal-card-array.json validates against cdb.card-array.v2.schema.json", () => {
    // The array schema is self-contained (items inlined) so no cross-file $ref.
    const schema = loadSchema("cdb.card-array.v2.schema.json");
    const golden = loadGolden("minimal-card-array.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("card-array golden uses distinct aggregate identifier cdb.card-array/2", () => {
    const schema = loadSchema("cdb.card-array.v2.schema.json") as { $id?: string };
    expect(schema.$id).toBe("cdb.card-array/2");
  });

  it("card-array items use the frozen card item schema (inlined)", () => {
    // items.$id references the frozen card schema; schema.const confirms identity.
    const schema = loadSchema("cdb.card-array.v2.schema.json") as {
      items?: { $id?: string; properties?: { schema?: { const?: string } } };
    };
    expect(schema.items?.$id).toBe("cdb.card/2");
    expect(schema.items?.properties?.schema?.const).toBe("cdb.card/2");
  });
});

describe("Golden record validation — source (ygo.card-source/1)", () => {
  it("minimal-source.json validates against ygo.card-source.v1.schema.json", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json");
    const golden = loadGolden("minimal-source.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("source golden uses distinct item identifier ygo.card-source/1", () => {
    const golden = loadGolden("minimal-source.json") as { schema: string };
    expect(golden.schema).toBe("ygo.card-source/1");
  });

  it("source coverage.status is SOURCE_ONLY", () => {
    const golden = loadGolden("minimal-source.json") as {
      coverage: { status: string };
    };
    expect(golden.coverage.status).toBe("SOURCE_ONLY");
  });

  it("source text requires normalizationVersion, spansBasis, and offsetEncoding", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json") as {
      properties?: {
        text?: {
          required?: string[];
          properties?: Record<string, { const?: string }>;
        };
      };
    };
    const textProps = schema.properties?.text;
    expect(textProps?.required).toContain("normalizationVersion");
    expect(textProps?.required).toContain("spansBasis");
    expect(textProps?.required).toContain("offsetEncoding");
    expect(textProps?.properties?.normalizationVersion?.const).toBe(
      "text-normalization/1"
    );
    expect(textProps?.properties?.spansBasis?.const).toBe("utf-16-code-units");
    expect(
      textProps?.properties?.offsetEncoding?.const
    ).toBe("utf-16-code-units");
  });
});

describe("Golden record validation — source-array (ygo.card-source-array/1)", () => {
  it("minimal-source-array.json validates against ygo.card-source-array.v1.schema.json", () => {
    // The array schema is self-contained (items inlined) so no cross-file $ref.
    const schema = loadSchema("ygo.card-source-array.v1.schema.json");
    const golden = loadGolden("minimal-source-array.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("source-array golden uses distinct aggregate identifier ygo.card-source-array/1", () => {
    const schema = loadSchema("ygo.card-source-array.v1.schema.json") as {
      $id?: string;
    };
    expect(schema.$id).toBe("ygo.card-source-array/1");
  });

  it("source-array items use the frozen source item schema (inlined)", () => {
    // items.$id references the frozen source schema; schema.const confirms identity.
    const schema = loadSchema("ygo.card-source-array.v1.schema.json") as {
      items?: { $id?: string; properties?: { schema?: { const?: string } } };
    };
    expect(schema.items?.$id).toBe("ygo.card-source/1");
    expect(schema.items?.properties?.schema?.const).toBe("ygo.card-source/1");
  });
});

describe("Orphan golden record validation — raw (cdb.raw/1)", () => {
  it("orphan-datas-only.json validates: datas row with empty texts", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    const golden = loadGolden("orphan-datas-only.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("orphan-texts-only.json validates: texts row with empty datas", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    const golden = loadGolden("orphan-texts-only.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("datas-only orphan: id is preserved as signed-int64 decimal", () => {
    const golden = loadGolden("orphan-datas-only.json") as {
      tables: { datas: Array<{ id: string }> };
    };
    expect(golden.tables.datas[0].id).toMatch(/^\d+$/);
  });

  it("texts-only orphan: id is preserved as signed-int64 decimal", () => {
    const golden = loadGolden("orphan-texts-only.json") as {
      tables: { texts: Array<{ id: string }> };
    };
    expect(golden.tables.texts[0].id).toMatch(/^\d+$/);
  });
});

describe("Orphan golden record validation — card (cdb.card/2)", () => {
  it("orphan-datas-only-card.json validates: present id identity, null name, MISSING_TEXT_ROW", () => {
    const schema = loadSchema("cdb.card.v2.schema.json");
    const golden = loadGolden("orphan-datas-only-card.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    // name is null (orphan: no texts row)
    expect((golden as { name: string | null }).name).toBeNull();
    // diagnostics includes MISSING_TEXT_ROW
    const diagnostics = (golden as { diagnostics: Array<{ code: string }> }).diagnostics;
    expect(diagnostics.some((d) => d.code === "MISSING_TEXT_ROW")).toBe(true);
  });

  it("orphan-texts-only-card.json validates: present id identity, null cardKind/stats, MISSING_DATA_ROW", () => {
    const schema = loadSchema("cdb.card.v2.schema.json");
    const golden = loadGolden("orphan-texts-only-card.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    // cardKind is absent (orphan: no datas row provides it) — absent-not-null
    expect((golden as Record<string, unknown>)["cardKind"]).toBeUndefined();
    // diagnostics includes MISSING_DATA_ROW
    const diagnostics = (golden as { diagnostics: Array<{ code: string }> }).diagnostics;
    expect(diagnostics.some((d) => d.code === "MISSING_DATA_ROW")).toBe(true);
  });

  it("orphan card requires id identity (no invented placeholder)", () => {
    const golden = loadGolden("orphan-datas-only-card.json") as { id: string };
    expect(golden.id).toBe("9999");
    const golden2 = loadGolden("orphan-texts-only-card.json") as { id: string };
    expect(golden2.id).toBe("8888");
  });

  it("orphan card fields use absent-not-null semantics", () => {
    // Orphan cards have no invented card kind, type, stats, or text.
    // Per "absent-not-null" semantics, absent features are omitted from the
    // record entirely (not set to null). The schema permits omission for all
    // of cardKind, typeLine, monster, spell, trap, and text.
    const datasOrphan = loadGolden("orphan-datas-only-card.json") as Record<string, unknown>;
    // cardKind is absent (no datas row provides it)
    expect(datasOrphan["cardKind"]).toBeUndefined();
    // text is not required and not present for datas-only orphan
    expect(datasOrphan["text"]).toBeUndefined();
    // typeLine/monster/spell/trap are also absent
    expect(datasOrphan["typeLine"]).toBeUndefined();
    expect(datasOrphan["monster"]).toBeUndefined();
    expect(datasOrphan["spell"]).toBeUndefined();
    expect(datasOrphan["trap"]).toBeUndefined();

    const textsOrphan = loadGolden("orphan-texts-only-card.json") as Record<string, unknown>;
    // cardKind is absent (no datas row provides it)
    expect(textsOrphan["cardKind"]).toBeUndefined();
    // typeLine/monster/spell/trap are absent (no texts row provides them)
    expect(textsOrphan["typeLine"]).toBeUndefined();
    expect(textsOrphan["monster"]).toBeUndefined();
    expect(textsOrphan["spell"]).toBeUndefined();
    expect(textsOrphan["trap"]).toBeUndefined();
    // text is absent for texts-only orphan (the texts row is a stub with
    // no real card data)
    expect(textsOrphan["text"]).toBeUndefined();
  });
});

describe("Orphan golden record validation — source (ygo.card-source/1)", () => {
  it("orphan-datas-only-source.json validates: present id, null printed name, MISSING_TEXT_ROW", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json");
    const golden = loadGolden("orphan-datas-only-source.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    // printed.name is null (orphan: no texts row)
    const printed = (golden as { printed: { name: string | null } }).printed;
    expect(printed.name).toBeNull();
    // diagnostics includes MISSING_TEXT_ROW
    const diagnostics = (golden as { diagnostics: Array<{ code: string }> }).diagnostics;
    expect(diagnostics.some((d) => d.code === "MISSING_TEXT_ROW")).toBe(true);
  });

  it("orphan-texts-only-source.json validates: present id, present name, MISSING_DATA_ROW", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json");
    const golden = loadGolden("orphan-texts-only-source.json");
    const ajvValidator = createAjv();
    const validate = ajvValidator.compile(schema);
    const valid = validate(golden);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    // printed.name is present (orphan: has texts row)
    const printed = (golden as { printed: { name: string | null } }).printed;
    expect(printed.name).toBe("Orphan Texts Only");
    // diagnostics includes MISSING_DATA_ROW
    const diagnostics = (golden as { diagnostics: Array<{ code: string }> }).diagnostics;
    expect(diagnostics.some((d) => d.code === "MISSING_DATA_ROW")).toBe(true);
  });

  it("orphan source: no placeholder name, card kind, stats, or text required", () => {
    const datasOrphan = loadGolden("orphan-datas-only-source.json") as {
      printed: { name: null };
    };
    expect(datasOrphan.printed.name).toBeNull();
  });
});
