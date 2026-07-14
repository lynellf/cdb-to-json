/**
 * Helper utilities for building CDB test fixtures.
 *
 * Creates temporary SQLite databases for testing.
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Create a minimal CDB database with the given card data.
 */
export function createMinimalCdb(
  cards: Array<{
    id: number | bigint;
    name: string;
    desc: string;
    type?: number;
    atk?: number;
    def?: number;
    level?: number;
    race?: number;
    attribute?: number;
    setcode?: number;
    ot?: number;
    alias?: number;
    category?: number;
    str1?: string | null;
    str2?: string | null;
    str3?: string | null;
    str4?: string | null;
    str5?: string | null;
    str6?: string | null;
    str7?: string | null;
    str8?: string | null;
    str9?: string | null;
    str10?: string | null;
    str11?: string | null;
    str12?: string | null;
    str13?: string | null;
    str14?: string | null;
    str15?: string | null;
    str16?: string | null;
  }>
): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "cdb-fixture-"));
  const dbPath = join(tmpDir, "test.cdb");

  const db = new Database(dbPath);

  // Create the standard CDB schema
  db.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY,
      ot INTEGER,
      alias INTEGER,
      setcode INTEGER,
      type INTEGER,
      atk INTEGER,
      def INTEGER,
      level INTEGER,
      race INTEGER,
      attribute INTEGER,
      category INTEGER
    );

    CREATE TABLE texts (
      id INTEGER PRIMARY KEY,
      name TEXT,
      desc TEXT,
      str1 TEXT,
      str2 TEXT,
      str3 TEXT,
      str4 TEXT,
      str5 TEXT,
      str6 TEXT,
      str7 TEXT,
      str8 TEXT,
      str9 TEXT,
      str10 TEXT,
      str11 TEXT,
      str12 TEXT,
      str13 TEXT,
      str14 TEXT,
      str15 TEXT,
      str16 TEXT
    );
  `);

  const insertDatas = db.prepare(`
    INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTexts = db.prepare(`
    INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const card of cards) {
    insertDatas.run(
      card.id,
      card.ot ?? 0,
      card.alias ?? 0,
      card.setcode ?? 0,
      card.type ?? 2, // Default to Effect Monster
      card.atk ?? 0,
      card.def ?? 0,
      card.level ?? 0,
      card.race ?? 0,
      card.attribute ?? 0,
      card.category ?? 0
    );

    insertTexts.run(
      card.id,
      card.name,
      card.desc,
      card.str1 ?? null,
      card.str2 ?? null,
      card.str3 ?? null,
      card.str4 ?? null,
      card.str5 ?? null,
      card.str6 ?? null,
      card.str7 ?? null,
      card.str8 ?? null,
      card.str9 ?? null,
      card.str10 ?? null,
      card.str11 ?? null,
      card.str12 ?? null,
      card.str13 ?? null,
      card.str14 ?? null,
      card.str15 ?? null,
      card.str16 ?? null
    );
  }

  db.close();

  // Return path and cleanup function
  return dbPath;
}

/**
 * Create a CDB with an orphaned datas row (no matching texts).
 */
export function createOrphanedDatasCdb(
  datasRows: Array<{
    id: number;
    type?: number;
    atk?: number;
    def?: number;
    level?: number;
    race?: number;
    attribute?: number;
    ot?: number | null;
    alias?: number | null;
    setcode?: number | null;
    category?: number | null;
  }>,
  textsRows: Array<{
    id: number;
    name: string;
    desc: string;
  }>
): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "cdb-fixture-"));
  const dbPath = join(tmpDir, "test.cdb");

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY,
      ot INTEGER,
      alias INTEGER,
      setcode INTEGER,
      type INTEGER,
      atk INTEGER,
      def INTEGER,
      level INTEGER,
      race INTEGER,
      attribute INTEGER,
      category INTEGER
    );

    CREATE TABLE texts (
      id INTEGER PRIMARY KEY,
      name TEXT,
      desc TEXT,
      str1 TEXT,
      str2 TEXT,
      str3 TEXT,
      str4 TEXT,
      str5 TEXT,
      str6 TEXT,
      str7 TEXT,
      str8 TEXT,
      str9 TEXT,
      str10 TEXT,
      str11 TEXT,
      str12 TEXT,
      str13 TEXT,
      str14 TEXT,
      str15 TEXT,
      str16 TEXT
    );
  `);

  const insertDatas = db.prepare(`
    INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTexts = db.prepare(`
    INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of datasRows) {
    insertDatas.run(
      row.id,
      row.ot !== undefined ? row.ot : 0,
      row.alias !== undefined ? row.alias : 0,
      row.setcode !== undefined ? row.setcode : 0,
      row.type ?? 2,
      row.atk ?? 0,
      row.def ?? 0,
      row.level ?? 0,
      row.race ?? 0,
      row.attribute ?? 0,
      row.category !== undefined ? row.category : 0
    );
  }

  for (const row of textsRows) {
    insertTexts.run(
      row.id,
      row.name,
      row.desc,
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null
    );
  }

  db.close();

  return dbPath;
}

/**
 * Create a CDB with duplicate IDs (should trigger error).
 */
export function createDuplicateIdCdb(duplicateId: number): string {
  const tmpDir = mkdtempSync(join(tmpdir(), "cdb-fixture-"));
  const dbPath = join(tmpDir, "test.cdb");

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY,
      ot INTEGER,
      alias INTEGER,
      setcode INTEGER,
      type INTEGER,
      atk INTEGER,
      def INTEGER,
      level INTEGER,
      race INTEGER,
      attribute INTEGER,
      category INTEGER
    );

    CREATE TABLE texts (
      id INTEGER PRIMARY KEY,
      name TEXT,
      desc TEXT,
      str1 TEXT,
      str2 TEXT,
      str3 TEXT,
      str4 TEXT,
      str5 TEXT,
      str6 TEXT,
      str7 TEXT,
      str8 TEXT,
      str9 TEXT,
      str10 TEXT,
      str11 TEXT,
      str12 TEXT,
      str13 TEXT,
      str14 TEXT,
      str15 TEXT,
      str16 TEXT
    );
  `);

  // Insert duplicate datas rows
  db.exec(`
    INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category)
    VALUES (${duplicateId}, 0, 0, 0, 2, 1000, 1000, 4, 16, 1, 0);
    INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category)
    VALUES (${duplicateId}, 0, 0, 0, 2, 2000, 2000, 5, 16, 1, 0);
  `);

  db.close();

  return dbPath;
}

/**
 * Clean up a temporary CDB file and its directory.
 */
export function cleanupCdb(dbPath: string): void {
  const dir = join(dbPath, "..");
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Get the temporary directory containing a CDB file.
 */
export function getCdbDir(dbPath: string): string {
  return join(dbPath, "..");
}
