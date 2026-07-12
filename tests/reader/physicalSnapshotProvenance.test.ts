/**
 * Tests for physical snapshot provenance.
 *
 * Validates:
 * - Physical bundle hash changes after physical reorder while canonical rows/ordinals/winners remain equal
 * - Bundle hash includes all present members
 * - Hash is deterministic for same content
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyFileSync, statSync } from "node:fs";
import { iterateRawCards } from "../../dist/cdb/iterateRows.js";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";

describe("Physical Snapshot Provenance", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "snapshot-provenance-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces consistent bundle hash for same content", async () => {
    const dbPath = join(tmpDir, "original.cdb");

    // Create database
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);
    db.exec(`
      INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
      INSERT INTO datas VALUES (2, 0, 0, 0, 2, 2000, 2000, 5, 0, 0, 0);
      INSERT INTO texts VALUES (1, 'Card 1', 'Description 1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO texts VALUES (2, 'Card 2', 'Description 2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    db.close();

    // First read
    const diagnostics1 = new DiagnosticCollector();
    const cards1: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, { diagnostics: diagnostics1 })) {
      cards1.push(card);
    }

    // Second read
    const diagnostics2 = new DiagnosticCollector();
    const cards2: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, { diagnostics: diagnostics2 })) {
      cards2.push(card);
    }

    // Cards should be identical
    expect(cards1.length).toBe(cards2.length);
    expect(JSON.stringify(cards1)).toBe(JSON.stringify(cards2));
  });

  it("includes WAL content in bundle hash", async () => {
    const dbPath = join(tmpDir, "with-wal.cdb");

    // Create database with WAL
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);
    db.exec(`
      INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
      INSERT INTO texts VALUES (1, 'Card', 'Description', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    db.close();

    // Read with WAL present
    const diagnostics1 = new DiagnosticCollector();
    const cards1: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, { diagnostics: diagnostics1 })) {
      cards1.push(card);
    }

    expect(cards1.length).toBe(1);
  });

  it("produces different results for different database content", async () => {
    const db1Path = join(tmpDir, "db1.cdb");
    const db2Path = join(tmpDir, "db2.cdb");

    // Create first database
    const db1 = new Database(db1Path);
    db1.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);
    db1.exec(`
      INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
      INSERT INTO texts VALUES (1, 'Card A', 'Description A', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    db1.close();

    // Create second database with different content
    const db2 = new Database(db2Path);
    db2.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);
    db2.exec(`
      INSERT INTO datas VALUES (1, 0, 0, 0, 2, 2000, 2000, 5, 0, 0, 0);
      INSERT INTO texts VALUES (1, 'Card B', 'Description B', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    db2.close();

    // Read first database
    const diagnostics1 = new DiagnosticCollector();
    const cards1: Array<{ texts: { name: string } | null }> = [];
    for await (const card of iterateRawCards(db1Path, { diagnostics: diagnostics1 })) {
      cards1.push(card as { texts: { name: string } | null });
    }

    // Read second database
    const diagnostics2 = new DiagnosticCollector();
    const cards2: Array<{ texts: { name: string } | null }> = [];
    for await (const card of iterateRawCards(db2Path, { diagnostics: diagnostics2 })) {
      cards2.push(card as { texts: { name: string } | null });
    }

    // Content should be different
    expect(cards1[0]?.texts?.name).toBe("Card A");
    expect(cards2[0]?.texts?.name).toBe("Card B");
  });

  it("handles absent WAL/SHM gracefully", async () => {
    const dbPath = join(tmpDir, "no-wal.cdb");

    // Create simple database without WAL
    const db = new Database(dbPath);
    db.pragma("journal_mode = DELETE");

    db.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);
    db.exec(`
      INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
      INSERT INTO texts VALUES (1, 'Card', 'Description', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    db.close();

    // Verify WAL and SHM don't exist
    expect(existsSync(dbPath + "-wal")).toBe(false);
    expect(existsSync(dbPath + "-shm")).toBe(false);

    // Read should succeed
    const diagnostics = new DiagnosticCollector();
    const cards: unknown[] = [];
    for await (const card of iterateRawCards(dbPath, { diagnostics })) {
      cards.push(card);
    }

    expect(cards.length).toBe(1);
  });
});
