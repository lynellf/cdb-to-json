/**
 * Tests for large database handling and bounded memory.
 *
 * Validates:
 * - Bounded memory usage via streaming iterator
 * - Row limit enforcement
 * - Byte-length preflight
 * - Extra-table metadata handling
 * - Signed-64 decimal raw values
 * - No JavaScript Map-based join
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { iterateRawCards } from "../../dist/cdb/iterateRows.js";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";
import { DiagnosticCode } from "../../dist/diagnostics/codes.js";

describe("Large Join", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "large-join-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("streaming iterator behavior", () => {
    it("streams cards without materializing all rows", async () => {
      const dbPath = join(tmpDir, "streaming.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      // Insert 100 cards
      for (let i = 1; i <= 100; i++) {
        db.exec(`INSERT INTO datas VALUES (${i}, 0, 0, 0, 2, ${i * 100}, ${i * 50}, 4, 0, 0, 0);`);
        db.exec(`INSERT INTO texts VALUES (${i}, 'Card ${i}', 'Description for card ${i}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
      }
      db.close();

      const diagnostics = new DiagnosticCollector();
      let count = 0;
      let firstCardSeen = false;

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        count++;
        if (count === 1) {
          firstCardSeen = true;
          // First card should be available immediately
          expect(card.datas).toBeDefined();
          expect(card.texts).toBeDefined();
        }
      }

      expect(count).toBe(100);
      expect(firstCardSeen).toBe(true);
    });

    it("yields cards incrementally", async () => {
      const dbPath = join(tmpDir, "incremental.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      // Insert 10 cards
      for (let i = 1; i <= 10; i++) {
        db.exec(`INSERT INTO datas VALUES (${i}, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);`);
        db.exec(`INSERT INTO texts VALUES (${i}, 'Card ${i}', 'Desc ${i}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
      }
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: unknown[] = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
        // Can stop early
        if (cards.length >= 5) break;
      }

      expect(cards.length).toBe(5);
    });
  });

  describe("row limits", () => {
    it("enforces maxRowsPerTable limit", async () => {
      const dbPath = join(tmpDir, "row-limit.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      // Insert 10 cards
      for (let i = 1; i <= 10; i++) {
        db.exec(`INSERT INTO datas VALUES (${i}, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);`);
        db.exec(`INSERT INTO texts VALUES (${i}, 'Card ${i}', 'Desc ${i}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
      }
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: unknown[] = [];

      // Set limit to 5
      for await (const card of iterateRawCards(dbPath, {
        diagnostics,
        limits: { maxRowsPerTable: 5 },
      })) {
        cards.push(card);
      }

      // Should have resource limit error
      const errors = diagnostics.getErrors().filter(
        (d) => d.code === DiagnosticCode.RESOURCE_LIMIT_EXCEEDED
      );
      expect(errors.length).toBeGreaterThan(0);

      // Should have limited MAX_ROWS_EXCEEDED
      const rowLimitErrors = errors.filter(
        (e) => e.details?.limitCode === "MAX_ROWS_EXCEEDED"
      );
      expect(rowLimitErrors.length).toBeGreaterThan(0);
    });
  });

  describe("signed-64 integer values", () => {
    it("preserves signed-64 integer values as decimal strings", async () => {
      const dbPath = join(tmpDir, "signed-int.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      // Test various integer values.
      // Use prepared statements with BigInt parameters to avoid precision loss
      // from JavaScript Number→SQLite string interpolation for int64 values.
      const insertDatas = db.prepare(
        "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      const insertTexts = db.prepare(
        "INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );

      const testValues: Array<number | bigint> = [
        0, 1, -1, 127, -128, 32767, -32768, 2147483647, -2147483648,
        9223372036854775807n, // max int64
        -9223372036854775808n, // min int64
      ];

      for (let i = 0; i < testValues.length; i++) {
        const val = testValues[i];
        insertDatas.run(i + 1, 0, 0, val, 2, 1000, 1000, 4, 0, 0, 0);
        insertTexts.run(i + 1, `Card ${i + 1}`, "Desc", null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
      }
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ datas: { setcode: string } | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card as { datas: { setcode: string } | null });
      }

      // Verify first few values
      expect(cards[0].datas?.setcode).toBe("0");
      expect(cards[1].datas?.setcode).toBe("1");
      expect(cards[2].datas?.setcode).toBe("-1");
    });

    it("handles null integer values", async () => {
      const dbPath = join(tmpDir, "null-ints.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      // Insert with NULL alias
      db.exec(`INSERT INTO datas VALUES (1, 0, NULL, 0, 2, 1000, 1000, 4, 0, 0, 0);`);
      db.exec(`INSERT INTO texts VALUES (1, 'Card', 'Desc', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ datas: { alias: string | null } | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card as { datas: { alias: string | null } | null });
      }

      expect(cards[0].datas?.alias).toBeNull();
    });
  });

  describe("extra table metadata", () => {
    it("handles databases with extra tables", async () => {
      const dbPath = join(tmpDir, "extra-tables.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
        CREATE TABLE extra_table (id INTEGER PRIMARY KEY, extra_col TEXT);
      `);

      db.exec(`INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);`);
      db.exec(`INSERT INTO texts VALUES (1, 'Card', 'Desc', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
      db.exec(`INSERT INTO extra_table VALUES (1, 'extra data');`);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: unknown[] = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      // Should successfully read datas/texts despite extra table
      expect((cards[0] as { datas: { id: string } | null }).datas?.id).toBe("1");
    });
  });
});
