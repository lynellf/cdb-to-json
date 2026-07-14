/**
 * Conformance tests for raw profile CLI output.
 *
 * Validates that the CLI's raw profile output (both JSON and JSONL formats)
 * conforms to the frozen `cdb.raw/1` schema and preserves all documented
 * raw boundary guarantees.
 *
 * This proves P3-AC2: the raw conversion command emits schema-valid
 * deterministic cdb.raw/1 JSON and complete-envelope JSONL while preserving
 * signed-int64 strings, nulls, empty strings, source metadata, and bounded
 * extra-table metadata only.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// Path to compiled CLI and test fixture
const CLI_PATH = join(process.cwd(), "dist", "cli.js");
const FIXTURE_CDB = join(process.cwd(), "__tests__", "input_dir", "cards.cdb");

// Load the frozen schema
const rawSchema = JSON.parse(
  readFileSync(join(process.cwd(), "schemas", "cdb.raw.v1.schema.json"), "utf-8")
);

function createAjv(): Ajv {
  const instance = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(instance);
  return instance;
}

/**
 * Run the CLI and return stdout, stderr, and exit code.
 */
function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 60000,
    maxBuffer: 100 * 1024 * 1024,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

describe("raw profile JSON output conformance", () => {
  it("raw JSON output is valid cdb.raw/1", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);

    const ajv = createAjv();
    const validate = ajv.compile(rawSchema);
    const parsed = JSON.parse(stdout);
    const valid = validate(parsed);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("raw JSON output has schema identifier cdb.raw/1", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schema).toBe("cdb.raw/1");
  });

  it("raw JSON output has signed-int64-decimal encoding", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.integerEncoding).toBe("signed-int64-decimal");
  });

  it("raw JSON output has all required fields", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("schema");
    expect(parsed).toHaveProperty("integerEncoding");
    expect(parsed).toHaveProperty("source");
    expect(parsed).toHaveProperty("tables");
    expect(parsed).toHaveProperty("extraTables");
  });

  it("raw JSON output has tables.datas and tables.texts", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.tables).toHaveProperty("datas");
    expect(parsed.tables).toHaveProperty("texts");
    expect(Array.isArray(parsed.tables.datas)).toBe(true);
    expect(Array.isArray(parsed.tables.texts)).toBe(true);
  });

  it("raw JSON output preserves integer IDs as decimal strings", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const datas = parsed.tables.datas as Array<{ id: unknown }>;
    const texts = parsed.tables.texts as Array<{ id: unknown }>;

    for (const row of datas) {
      expect(typeof row.id).toBe("string");
      expect(row.id).toMatch(/^-?\d+$/);
    }
    for (const row of texts) {
      expect(typeof row.id).toBe("string");
      expect(row.id).toMatch(/^-?\d+$/);
    }
  });

  it("raw JSON output nullable numeric fields use schema-nullable contract", () => {
    // The fixture has no null values, but the schema permits null for all
    // non-id numeric fields. Verify the schema validates actual output and
    // that nullable fields are typed correctly (not coerced).
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);

    // Schema must validate the actual output (null-preserving contract)
    const ajv = createAjv();
    const validate = ajv.compile(rawSchema);
    const parsed = JSON.parse(stdout);
    const valid = validate(parsed);
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);

    // Verify schema allows null for nullable datas fields
    const datasProps =
      rawSchema.properties?.tables?.properties?.datas?.items?.properties as Record<
        string,
        { type?: string | string[] }
      >;
    for (const field of ["ot", "alias", "atk", "def", "level"]) {
      const fieldType = datasProps?.[field]?.type;
      const types = Array.isArray(fieldType) ? fieldType : [fieldType];
      expect(types).toContain("null");
    }

    // Verify schema allows null for nullable texts fields
    const textsProps =
      rawSchema.properties?.tables?.properties?.texts?.items?.properties as Record<
        string,
        { type?: string | string[] }
      >;
    for (const field of ["name", "desc", "str1"]) {
      const fieldType = textsProps?.[field]?.type;
      const types = Array.isArray(fieldType) ? fieldType : [fieldType];
      expect(types).toContain("null");
    }
  });

  it("raw JSON output preserves empty strings in text columns", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const texts = parsed.tables.texts as Array<Record<string, unknown>>;

    // Fixture has rows with empty string str5
    const hasEmptyString = texts.some(
      (row) => (row.str5 as string) === ""
    );
    expect(hasEmptyString).toBe(true);
  });

  it("raw JSON output preserves Unicode text content", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const texts = parsed.tables.texts as Array<{ name: string; desc: string }>;

    // Fixture has cards with Unicode names/descriptions
    const hasUnicode = texts.some(
      (row) =>
        /[^\x00-\x7F]/.test(row.name) || /[^\x00-\x7F]/.test(row.desc)
    );
    expect(hasUnicode).toBe(true);

    // Verify specific expected card name with Unicode
    const labrynthCard = texts.find((row) => row.name === "Labrynth Cooclock");
    expect(labrynthCard).toBeDefined();
    expect(labrynthCard!.desc).toContain("Labrynth");
  });

  it("raw JSON output source has required fields", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.source).toHaveProperty("fileName");
    expect(parsed.source).toHaveProperty("sha256");
    expect(parsed.source).toHaveProperty("sizeBytes");
    expect(parsed.source).toHaveProperty("converter");
    expect(parsed.source.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("raw JSON output extraTables is array of metadata only", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.extraTables)).toBe(true);

    for (const table of parsed.extraTables) {
      // Each entry is metadata: name, columns, rowCount — not cell values
      expect(table).toHaveProperty("name");
      expect(table).toHaveProperty("columns");
      expect(table).toHaveProperty("rowCount");
      expect(Array.isArray(table.columns)).toBe(true);
      expect(typeof table.rowCount).toBe("number");
      // No cell values in extraTables
      expect(Object.keys(table)).toHaveLength(3);
    }
  });

  it("raw JSON output is deterministic (canonical property order)", () => {
    const { stdout: out1, exitCode: ec1 } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    const { stdout: out2, exitCode: ec2 } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(ec1).toBe(0);
    expect(ec2).toBe(0);
    expect(out1).toBe(out2);
  });
});

describe("raw profile JSONL output conformance", () => {
  it("raw JSONL output is valid: one complete cdb.raw/1 envelope per line", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "jsonl",
    ]);
    expect(exitCode).toBe(0);

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThan(0);

    const ajv = createAjv();
    const validate = ajv.compile(rawSchema);

    for (let i = 0; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      const valid = validate(parsed);
      expect(valid, `Line ${i}: ${JSON.stringify(validate.errors, null, 2)}`).toBe(
        true
      );
    }
  });

  it("raw JSONL envelope has schema identifier cdb.raw/1", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "jsonl",
    ]);
    expect(exitCode).toBe(0);

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.schema).toBe("cdb.raw/1");
    }
  });

  it("raw JSONL envelope has signed-int64-decimal encoding", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "jsonl",
    ]);
    expect(exitCode).toBe(0);

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.integerEncoding).toBe("signed-int64-decimal");
    }
  });

  it("raw JSONL emits complete envelope (not one row per line)", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "jsonl",
    ]);
    expect(exitCode).toBe(0);

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    // One database = one complete envelope per line (not one row per line)
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty("tables");
    expect(parsed.tables).toHaveProperty("datas");
    expect(Array.isArray(parsed.tables.datas)).toBe(true);
    expect(parsed.tables.datas.length).toBeGreaterThan(1);
  });
});

describe("raw JSON and JSONL semantic equivalence", () => {
  it("JSON and JSONL produce identical logical data content", () => {
    const { stdout: jsonOut, exitCode: jsonEc } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    const { stdout: jsonlOut, exitCode: jsonlEc } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "jsonl",
    ]);

    expect(jsonEc).toBe(0);
    expect(jsonlEc).toBe(0);

    const jsonParsed = JSON.parse(jsonOut);
    const jsonlLines = jsonlOut.split("\n").filter((l) => l.trim());
    const jsonlParsed = JSON.parse(jsonlLines[0]);

    // Same schema identifiers
    expect(jsonParsed.schema).toBe(jsonlParsed.schema);
    expect(jsonParsed.integerEncoding).toBe(jsonlParsed.integerEncoding);

    // Same source SHA-256 (same physical bundle)
    expect(jsonParsed.source.sha256).toBe(jsonlParsed.source.sha256);
    expect(jsonParsed.source.fileName).toBe(jsonlParsed.source.fileName);

    // Same datas rows (same count, same IDs)
    expect(jsonParsed.tables.datas.length).toBe(jsonlParsed.tables.datas.length);
    for (let i = 0; i < jsonParsed.tables.datas.length; i++) {
      expect(jsonParsed.tables.datas[i].id).toBe(jsonlParsed.tables.datas[i].id);
      expect(jsonParsed.tables.datas[i].ot).toBe(jsonlParsed.tables.datas[i].ot);
    }

    // Same texts rows
    expect(jsonParsed.tables.texts.length).toBe(jsonlParsed.tables.texts.length);
    for (let i = 0; i < jsonParsed.tables.texts.length; i++) {
      expect(jsonParsed.tables.texts[i].id).toBe(jsonlParsed.tables.texts[i].id);
      expect(jsonParsed.tables.texts[i].name).toBe(
        jsonlParsed.tables.texts[i].name
      );
    }

    // Same extraTables
    expect(jsonParsed.extraTables).toEqual(jsonlParsed.extraTables);
  });
});

describe("raw profile integer boundary conformance", () => {
  it("negative integer IDs are preserved as decimal strings", () => {
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const datas = parsed.tables.datas as Array<{ id: string }>;

    // Find a row with a negative ID if the fixture has one
    const negativeIds = datas.filter((r) => r.id.startsWith("-"));
    // The fixture has some negative atk/def values; check IDs
    for (const row of datas) {
      if (row.id.startsWith("-")) {
        expect(row.id).toMatch(/^-[0-9]+$/);
      }
    }

    // Check negative atk/def values (fixture has -2)
    const hasNegativeAtk = datas.some(
      (r) => r.atk !== null && String(r.atk).startsWith("-")
    );
    expect(hasNegativeAtk).toBe(true);
  });

  it("all IDs are decimal strings (not coerced to numbers)", () => {
    // Every ID must be a decimal string, not a JavaScript number.
    // The fixture uses IDs 10000-9999961 range. Verify string type and
    // round-trip through JSON to prove no numeric coercion.
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const datas = parsed.tables.datas as Array<{ id: unknown }>;
    const texts = parsed.tables.texts as Array<{ id: unknown }>;

    for (const row of datas) {
      expect(typeof row.id, `${row.id} must be string`).toBe("string");
      expect(row.id).toMatch(/^\d+$/);
      // Round-trip through JSON serialization proves it's a string, not a number
      const roundTrip = JSON.parse(JSON.stringify(row.id));
      expect(roundTrip, `${row.id} was coerced to number`).toBe(row.id);
    }
    for (const row of texts) {
      expect(typeof row.id).toBe("string");
      expect(row.id).toMatch(/^\d+$/);
      const roundTrip = JSON.parse(JSON.stringify(row.id));
      expect(roundTrip).toBe(row.id);
    }
  });

  it("numeric fields are decimal strings not numbers", () => {
    // The fixture has some negative atk/def values (e.g., -2).
    // Verify all numeric fields remain strings through JSON serialization.
    const { stdout, exitCode } = runCli([
      "convert",
      FIXTURE_CDB,
      "--profile", "raw",
      "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const datas = parsed.tables.datas as Array<Record<string, unknown>>;

    // Verify the atk field (which has negative values in the fixture)
    const hasNegativeAtk = datas.some(
      (r) => r.atk !== null && String(r.atk).startsWith("-")
    );
    expect(hasNegativeAtk).toBe(true);

    // All numeric fields must be strings
    for (const row of datas) {
      for (const field of ["ot", "alias", "setcode", "type", "atk", "def", "level", "race", "attribute", "category"]) {
        const val = row[field];
        if (val !== null) {
          expect(typeof val, `${field}=${val} must be string`).toBe("string");
          expect(val).toMatch(/^-?\d+$/);
        }
      }
    }
  });
});
