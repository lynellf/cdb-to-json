/**
 * Build a deterministic high-cardinality raw-profile fixture.
 *
 * The fixture intentionally stays small per row so the test exercises the
 * number of records rather than an oversized single text value.
 */

import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function buildHighCardinalityRawCdb(cardCount = 3_000): string {
  if (!Number.isSafeInteger(cardCount) || cardCount < 1) {
    throw new Error("cardCount must be a positive safe integer");
  }

  const directory = mkdtempSync(join(tmpdir(), "cdb-high-cardinality-"));
  const databasePath = join(directory, "high-cardinality.cdb");
  const database = new Database(databasePath);

  database.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
      type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER,
      attribute INTEGER, category INTEGER
    );
    CREATE TABLE texts (
      id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT,
      str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT,
      str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT,
      str15 TEXT, str16 TEXT
    );
  `);

  const insertDatas = database.prepare(`
    INSERT INTO datas
      (id, ot, alias, setcode, type, atk, def, level, race, attribute, category)
    VALUES (?, 0, 0, 0, 2, ?, ?, ?, 0, 0, 0)
  `);
  const insertTexts = database.prepare(`
    INSERT INTO texts
      (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8,
       str9, str10, str11, str12, str13, str14, str15, str16)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  `);

  const insertCards = database.transaction(() => {
    for (let index = 0; index < cardCount; index += 1) {
      const id = index + 1;
      insertDatas.run(id, index, index * 2, (index % 12) + 1);
      insertTexts.run(id, `High-cardinality ${id}`, `Description ${id}`);
    }
  });
  insertCards();
  database.close();
  return databasePath;
}
