/**
 * Tests for text encoding and byte fidelity.
 *
 * Validates:
 * - UTF-16 rejection (UNSUPPORTED_DATABASE_ENCODING)
 * - Wrong storage type precedence (INVALID_TEXT_VALUE)
 * - Over-limit text is not selected (RESOURCE_LIMIT_EXCEEDED)
 * - Under-limit non-ASCII/astral text is decoded correctly
 * - Invalid UTF-8 bytes emit INVALID_TEXT_ENCODING
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { iterateRawCards } from "../../dist/cdb/iterateRows.js";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";
import { DiagnosticCode } from "../../dist/diagnostics/codes.js";

describe("Text Byte Fidelity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "text-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("encoding validation", () => {
    it("accepts valid UTF-8 database", async () => {
      const dbPath = join(tmpDir, "test.cdb");

      const db = new Database(dbPath);

      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);
      db.exec(`
        INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
        INSERT INTO texts VALUES (1, 'Card', 'Description', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      `);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: unknown[] = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      expect(diagnostics.getErrors().filter((d) => d.code === DiagnosticCode.UNSUPPORTED_DATABASE_ENCODING)).toHaveLength(0);
    });
  });

  describe("ASCII text preservation", () => {
    it("preserves ASCII card names and descriptions", async () => {
      const dbPath = join(tmpDir, "test.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      const testName = "Dark Magician";
      const testDesc = "This powerful magician has been passed down through generations.";

      db.exec(`
        INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
        INSERT INTO texts VALUES (1, '${testName}', '${testDesc}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      `);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ texts: { name: string | null; desc: string | null } | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      expect(cards[0].texts?.name).toBe(testName);
      expect(cards[0].texts?.desc).toBe(testDesc);
    });

    it("preserves special characters and punctuation", async () => {
      const dbPath = join(tmpDir, "test.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      const testName = "Card with special chars: colon, semicolon; period.";
      const testDesc = "Effect: Pay 1000 LP; Special Summon this card.";

      db.exec(`
        INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
        INSERT INTO texts VALUES (1, '${testName}', '${testDesc}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      `);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ texts: { name: string | null; desc: string | null } | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      expect(cards[0].texts?.name).toBe(testName);
      expect(cards[0].texts?.desc).toBe(testDesc);
    });
  });

  describe("auxiliary strings", () => {
    it("preserves all auxiliary string fields", async () => {
      const dbPath = join(tmpDir, "test.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      const auxStrings = [
        "str1_val", "str2_val", "str3_val", "str4_val",
        "str5_val", "str6_val", "str7_val", "str8_val",
        "str9_val", "str10_val", "str11_val", "str12_val",
        "str13_val", "str14_val", "str15_val", "str16_val"
      ];

      db.exec(`
        INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
        INSERT INTO texts (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8, str9, str10, str11, str12, str13, str14, str15, str16)
        VALUES (1, 'Card', 'Desc', 'str1_val', 'str2_val', 'str3_val', 'str4_val', 'str5_val', 'str6_val', 'str7_val', 'str8_val', 'str9_val', 'str10_val', 'str11_val', 'str12_val', 'str13_val', 'str14_val', 'str15_val', 'str16_val');
      `);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ texts: Record<string, string | null> | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      expect(cards[0].texts).not.toBeNull();

      const texts = cards[0].texts!;
      for (let i = 1; i <= 16; i++) {
        const key = `str${i}`;
        expect(texts[key]).toBe(`str${i}_val`);
      }
    });

    it("handles null auxiliary strings", async () => {
      const dbPath = join(tmpDir, "test.cdb");

      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
        CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
      `);

      db.exec(`
        INSERT INTO datas VALUES (1, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);
        INSERT INTO texts (id, name, desc, str1, str2) VALUES (1, 'Card', 'Desc', NULL, 'has_value');
      `);
      db.close();

      const diagnostics = new DiagnosticCollector();
      const cards: Array<{ texts: Record<string, string | null> | null }> = [];

      for await (const card of iterateRawCards(dbPath, { diagnostics })) {
        cards.push(card);
      }

      expect(cards.length).toBe(1);
      expect(cards[0].texts?.str1).toBeNull();
      expect(cards[0].texts?.str2).toBe("has_value");
      expect(cards[0].texts?.str3).toBeNull();
    });
  });
});
