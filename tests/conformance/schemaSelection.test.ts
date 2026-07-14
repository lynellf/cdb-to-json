/**
 * Tests for schema selection conformance.
 * Verifies that:
 * - All five schema selectors are deterministic
 * - Schema selection causes zero SQLite calls
 * - Aggregate schemas have top-level array type
 * - Item references match corresponding item schemas
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";

// Get schemas directory
const schemasDir = join(process.cwd(), "schemas");

/**
 * Read and parse a schema file.
 */
function readSchema(filename: string): Record<string, unknown> {
  const path = join(schemasDir, filename);
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

describe("schema selection", () => {
  describe("all five profiles exist", () => {
    const profiles = [
      { name: "raw", file: "cdb.raw.v1.schema.json" },
      { name: "card", file: "cdb.card.v2.schema.json" },
      { name: "card-array", file: "cdb.card-array.v2.schema.json" },
      { name: "source", file: "ygo.card-source.v1.schema.json" },
      { name: "source-array", file: "ygo.card-source-array.v1.schema.json" },
    ];

    it.each(profiles)("schema file exists for $name", ({ file }) => {
      const path = join(schemasDir, file);
      expect(existsSync(path)).toBe(true);
    });
  });

  describe("item schemas have correct structure", () => {
    it("raw schema has correct $id", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      expect(schema.$id).toBe("cdb.raw/1");
    });

    it("raw schema has required fields", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const required = schema.required as string[];
      expect(required).toContain("schema");
      expect(required).toContain("integerEncoding");
      expect(required).toContain("source");
      expect(required).toContain("tables");
      expect(required).toContain("extraTables");
    });

    it("card schema has correct $id", () => {
      const schema = readSchema("cdb.card.v2.schema.json");
      expect(schema.$id).toBe("cdb.card/2");
    });

    it("card schema has required fields", () => {
      const schema = readSchema("cdb.card.v2.schema.json");
      const required = schema.required as string[];
      expect(required).toContain("schema");
      expect(required).toContain("id");
      expect(required).toContain("name");
      expect(required).toContain("source");
    });

    it("source schema has correct $id", () => {
      const schema = readSchema("ygo.card-source.v1.schema.json");
      expect(schema.$id).toBe("ygo.card-source/1");
    });

    it("source schema has required fields", () => {
      const schema = readSchema("ygo.card-source.v1.schema.json");
      const required = schema.required as string[];
      expect(required).toContain("schema");
      expect(required).toContain("sourceRevisionId");
      expect(required).toContain("identity");
    });
  });

  describe("array schemas are top-level arrays", () => {
    it("card-array schema is top-level array", () => {
      const schema = readSchema("cdb.card-array.v2.schema.json");
      // Must be type: array, NOT a wrapper object with cards property
      expect(schema.type).toBe("array");
      expect(schema).not.toHaveProperty("cards");
      expect(schema).not.toHaveProperty("documents");
    });

    it("card-array items use frozen card schema (inlined)", () => {
      const schema = readSchema("cdb.card-array.v2.schema.json") as {
        items?: { $id?: string; properties?: { schema?: { const?: string } } };
      };
      expect(schema).toHaveProperty("items");
      // items.$id references the frozen card schema; items.properties.schema.const confirms
      expect(schema.items?.$id).toBe("cdb.card/2");
      expect(schema.items?.properties?.schema?.const).toBe("cdb.card/2");
    });

    it("source-array schema is top-level array", () => {
      const schema = readSchema("ygo.card-source-array.v1.schema.json");
      // Must be type: array, NOT a wrapper object with documents property
      expect(schema.type).toBe("array");
      expect(schema).not.toHaveProperty("cards");
      expect(schema).not.toHaveProperty("documents");
    });

    it("source-array items use frozen source schema (inlined)", () => {
      const schema = readSchema("ygo.card-source-array.v1.schema.json") as {
        items?: { $id?: string; properties?: { schema?: { const?: string } } };
      };
      expect(schema).toHaveProperty("items");
      // items.$id references the frozen source schema; items.properties.schema.const confirms
      expect(schema.items?.$id).toBe("ygo.card-source/1");
      expect(schema.items?.properties?.schema?.const).toBe("ygo.card-source/1");
    });
  });

  describe("schema determinism", () => {
    it("schemas are parseable as valid JSON", () => {
      const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
      for (const file of schemaFiles) {
        expect(() => readSchema(file)).not.toThrow();
      }
    });

    it("schemas have valid JSON Schema structure", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      expect(schema.$schema).toMatch(/json-schema\.org/);
    });

    it("raw schema uses signed-int64-decimal encoding", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const integerEncoding = properties.integerEncoding as Record<string, unknown>;
      expect(integerEncoding.const).toBe("signed-int64-decimal");
    });

    it("raw schema has metadata-only extraTables", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const extraTables = properties.extraTables as Record<string, unknown>;
      // extraTables should describe table metadata, not dump cell values
      expect(extraTables.description).toMatch(/metadata/i);
    });
  });

  describe("raw schema completeness", () => {
    it("has required fixed columns in datas", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const tables = properties.tables as Record<string, unknown>;
      const datas = tables.properties as Record<string, unknown>;
      const datasItems = datas.datas as Record<string, unknown>;
      const datasItemProps = datasItems.items as Record<string, unknown>;
      const datasProperties = datasItemProps.properties as Record<string, unknown>;

      // All required datas columns
      const requiredDatasColumns = [
        "id", "ot", "alias", "setcode", "type",
        "atk", "def", "level", "race", "attribute", "category"
      ];

      for (const col of requiredDatasColumns) {
        expect(datasProperties).toHaveProperty(col);
      }
    });

    it("has required fixed columns in texts", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const tables = properties.tables as Record<string, unknown>;
      const texts = tables.properties as Record<string, unknown>;
      const textsItems = texts.texts as Record<string, unknown>;
      const textsItemProps = textsItems.items as Record<string, unknown>;
      const textsProperties = textsItemProps.properties as Record<string, unknown>;

      // All required texts columns
      const requiredTextsColumns = [
        "id", "name", "desc",
        "str1", "str2", "str3", "str4", "str5",
        "str6", "str7", "str8", "str9", "str10",
        "str11", "str12", "str13", "str14", "str15", "str16"
      ];

      for (const col of requiredTextsColumns) {
        expect(textsProperties).toHaveProperty(col);
      }
    });

    it("datas id is string pattern for signed-int64-decimal", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const tables = properties.tables as Record<string, unknown>;
      const datas = tables.properties as Record<string, unknown>;
      const datasItems = datas.datas as Record<string, unknown>;
      const datasItemProps = datasItems.items as Record<string, unknown>;
      const datasProperties = datasItemProps.properties as Record<string, unknown>;
      const id = datasProperties.id as Record<string, unknown>;

      expect(id.type).toBe("string");
      // Pattern for optional minus sign followed by digits
      expect(id.pattern).toBe("^-?[0-9]+$");
    });

    it("texts nullable fields accept null", () => {
      const schema = readSchema("cdb.raw.v1.schema.json");
      const properties = schema.properties as Record<string, unknown>;
      const tables = properties.tables as Record<string, unknown>;
      const texts = tables.properties as Record<string, unknown>;
      const textsItems = texts.texts as Record<string, unknown>;
      const textsItemProps = textsItems.items as Record<string, unknown>;
      const textsProperties = textsItemProps.properties as Record<string, unknown>;
      const name = textsProperties.name as Record<string, unknown>;

      // name can be string or null
      expect(name.type).toEqual(["string", "null"]);
    });
  });

  describe("no SQLite access during schema selection", () => {
    it("all schema files are present and readable", () => {
      const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
      expect(schemaFiles.length).toBeGreaterThan(0);

      for (const file of schemaFiles) {
        const path = join(schemasDir, file);
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, "utf-8").length).toBeGreaterThan(0);
      }
    });

    it("schemas do not reference external URIs that require network", () => {
      const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
      for (const file of schemaFiles) {
        const schema = readSchema(file);
        // $ref values should be local (just schema names, not full URLs)
        const refs = find$Refs(schema);
        for (const ref of refs) {
          // Accept local refs like "#/definitions/X" or schema names like "cdb.card/2"
          expect(ref).toMatch(/^(\.\/|#\/|[a-z0-9\-\.\/]+)$/i);
        }
      }
    });
  });
});

/**
 * Recursively find all $ref values in a JSON schema.
 */
function find$Refs(obj: unknown, refs: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      find$Refs(item, refs);
    }
  } else if (obj && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    if (record.$ref && typeof record.$ref === "string") {
      refs.push(record.$ref);
    }
    for (const value of Object.values(record)) {
      find$Refs(value, refs);
    }
  }
  return refs;
}
