import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";
import { DiagnosticCode } from "../../dist/diagnostics/codes.js";
import { iterateRawCards } from "../../dist/cdb/iterateRows.js";

function createSchema(db: Database.Database): void {
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
  `);
}

describe("required-table resource limits", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cdb-resource-limits-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects a datas table over maxRowsPerTable before yielding cards", async () => {
    const dbPath = join(tempDir, "datas-over-limit.cdb");
    const db = new Database(dbPath);
    createSchema(db);
    const insertData = db.prepare(
      "INSERT INTO datas VALUES (?, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0)",
    );
    const insertText = db.prepare(
      "INSERT INTO texts VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
    );
    for (let id = 1; id <= 3; id += 1) {
      insertData.run(id);
      insertText.run(id, `Card ${id}`, `Description ${id}`);
    }
    db.close();

    const diagnostics = new DiagnosticCollector();
    const cards: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, {
      diagnostics,
      limits: { maxRowsPerTable: 2 },
    })) {
      cards.push(card);
    }

    expect(cards).toHaveLength(0);
    expect(diagnostics.getErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
          details: expect.objectContaining({
            limitCode: "MAX_ROWS_EXCEEDED",
          }),
        }),
      ]),
    );
  });

  it("rejects a texts table over maxRowsPerTable before yielding cards", async () => {
    const dbPath = join(tempDir, "texts-over-limit.cdb");
    const db = new Database(dbPath);
    createSchema(db);
    const insertData = db.prepare(
      "INSERT INTO datas VALUES (?, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0)",
    );
    const insertText = db.prepare(
      "INSERT INTO texts VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
    );
    insertData.run(1);
    for (let id = 1; id <= 3; id += 1) {
      insertText.run(id, `Card ${id}`, `Description ${id}`);
    }
    db.close();

    const diagnostics = new DiagnosticCollector();
    const cards: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, {
      diagnostics,
      limits: { maxRowsPerTable: 2 },
    })) {
      cards.push(card);
    }

    expect(cards).toHaveLength(0);
    expect(
      diagnostics
        .getErrors()
        .some(
          (diagnostic) =>
            diagnostic.code === DiagnosticCode.RESOURCE_LIMIT_EXCEEDED &&
            diagnostic.details?.limitCode === "MAX_ROWS_EXCEEDED",
        ),
    ).toBe(true);
  });
});
