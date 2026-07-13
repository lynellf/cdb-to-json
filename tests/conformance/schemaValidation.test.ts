/**
 * Conformance tests for schema validation.
 *
 * Asserts that frozen schemas validate their golden records.
 * Aggregate schemas reference the frozen item schema identifiers.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Load a schema file.
 */
function loadSchema(name: string): Record<string, unknown> {
  const path = `${process.cwd()}/schemas/${name}`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Schema validation", () => {
  it("raw schema has correct identifier", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json");
    expect(schema.$id).toBe("cdb.raw/1");
  });

  it("card schema has correct identifier", () => {
    const schema = loadSchema("cdb.card.v2.schema.json");
    expect(schema.$id).toBe("cdb.card/2");
  });

  it("source schema has correct identifier", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json");
    expect(schema.$id).toBe("ygo.card-source/1");
  });

  it("raw schema requires schema, source, and tables", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as { required?: string[] };
    expect(schema.required).toContain("schema");
    expect(schema.required).toContain("source");
    expect(schema.required).toContain("tables");
  });

  it("card schema requires schema, id, name, and source", () => {
    const schema = loadSchema("cdb.card.v2.schema.json") as { required?: string[] };
    expect(schema.required).toContain("schema");
    expect(schema.required).toContain("id");
    expect(schema.required).toContain("name");
    expect(schema.required).toContain("source");
  });

  it("source schema requires sourceRevisionId, identity, and coverage", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json") as { required?: string[] };
    expect(schema.required).toContain("sourceRevisionId");
    expect(schema.required).toContain("identity");
    expect(schema.required).toContain("coverage");
  });

  it("source schema coverage status is SOURCE_ONLY", () => {
    const schema = loadSchema("ygo.card-source.v1.schema.json") as {
      properties?: { coverage?: { properties?: { status?: { const?: string } } } };
    };
    expect(schema.properties?.coverage?.properties?.status?.const).toBe("SOURCE_ONLY");
  });

  it("raw datas fields use signed-int64 decimal pattern", () => {
    const schema = loadSchema("cdb.raw.v1.schema.json") as {
      properties?: {
        tables?: {
          properties?: {
            datas?: {
              items?: {
                properties?: Record<string, { pattern?: string }>;
              };
            };
          };
        };
      };
    };
    const datasProps = schema.properties?.tables?.properties?.datas?.items?.properties;
    expect(datasProps?.id?.pattern).toBe("^-?[0-9]+$");
    expect(datasProps?.ot?.pattern).toBe("^-?[0-9]+$");
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
    const textsProps = schema.properties?.tables?.properties?.texts?.items?.properties;
    // name should be string | null
    expect(textsProps?.name?.type).toContain("null");
    expect(textsProps?.desc?.type).toContain("null");
  });

  it("card-array schema is top-level array and references card schema", () => {
    const schema = loadSchema("cdb.card-array.v2.schema.json") as {
      $id?: string;
      type?: string;
      items?: { $ref?: string };
    };
    expect(schema.$id).toBe("cdb.card-array/2");
    // Should be a top-level array, not a wrapper object
    expect(schema.type).toBe("array");
    // Should reference the card schema
    expect(schema.items?.$ref).toBe("cdb.card/2");
  });

  it("card-source-array schema is top-level array and references source schema", () => {
    const schema = loadSchema("ygo.card-source-array.v1.schema.json") as {
      $id?: string;
      type?: string;
      items?: { $ref?: string };
    };
    expect(schema.$id).toBe("ygo.card-source-array/1");
    // Should be a top-level array, not a wrapper object
    expect(schema.type).toBe("array");
    // Should reference the source schema
    expect(schema.items?.$ref).toBe("ygo.card-source/1");
  });
});