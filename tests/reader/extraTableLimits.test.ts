import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";
import { DiagnosticCode } from "../../dist/diagnostics/codes.js";
import { iterateRawCards } from "../../dist/cdb/iterateRows.js";

function createDatabase(path: string, extraRows: number): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
      type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER,
      attribute INTEGER, category INTEGER
    );
    CREATE TABLE texts (
      id INTEGER PRIMARY KEY, name TEXT, desc TEXT,
      str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT,
      str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT,
      str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
    );
    CREATE TABLE extra_table (id INTEGER PRIMARY KEY, unsupported_value BLOB);
  `);
  db.exec(
    "INSERT INTO datas VALUES (1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0);",
  );
  db.exec(
    "INSERT INTO texts VALUES (1, 'Card', 'Description', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);",
  );
  const insertExtra = db.prepare(
    "INSERT INTO extra_table VALUES (?, X'00FF')",
  );
  for (let id = 1; id <= extraRows; id += 1) insertExtra.run(id);
  db.close();
}

describe("bounded extra-table metadata", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cdb-extra-table-limits-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stops at maxRowsPerTable + 1 without publishing cards or selecting cells", async () => {
    const dbPath = join(tempDir, "extra-over-limit.cdb");
    createDatabase(dbPath, 4);
    const diagnostics = new DiagnosticCollector();
    const cards: unknown[] = [];
    let metadataCalled = false;

    for await (const card of iterateRawCards(dbPath, {
      diagnostics,
      limits: { maxRowsPerTable: 3 },
      onMetadata: () => {
        metadataCalled = true;
      },
    })) {
      cards.push(card);
    }

    expect(cards).toHaveLength(0);
    expect(metadataCalled).toBe(false);
    expect(diagnostics.getErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
          details: expect.objectContaining({
            limitCode: "MAX_EXTRA_TABLE_ROWS_EXCEEDED",
            maxRows: 3,
          }),
        }),
      ]),
    );
  });

  it("records an exact count for an extra table below the sentinel", async () => {
    const dbPath = join(tempDir, "extra-within-limit.cdb");
    createDatabase(dbPath, 2);
    const diagnostics = new DiagnosticCollector();
    let metadata: { extraTables: readonly { name: string; rowCount: number }[] } | undefined;

    const cards: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, {
      diagnostics,
      limits: { maxRowsPerTable: 3 },
      onMetadata: (value) => {
        metadata = value;
      },
    })) {
      cards.push(card);
    }

    expect(cards).toHaveLength(1);
    expect(metadata?.extraTables).toEqual([
      expect.objectContaining({ name: "extra_table", rowCount: 2 }),
    ]);
    expect(diagnostics.getErrors()).toHaveLength(0);
  });
});
