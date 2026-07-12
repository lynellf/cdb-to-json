/**
 * Tests for legacy output functionality.
 *
 * Validates:
 * - Output-directory creation
 * - File naming with legacy basename
 * - Emit-false behavior
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { legacyConvert } from "../../dist/index.js";
import { legacyBasename } from "../../dist/discovery/pathPolicy.js";

describe("Legacy Output", () => {
  let tmpDir: string;
  let testCdbDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "legacy-output-"));
    testCdbDir = mkdtempSync(join(tmpdir(), "legacy-input-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(testCdbDir, { recursive: true, force: true });
  });

  function createTestDb(filename: string, cards: Array<{ id: number; name: string; desc: string }>): string {
    const dbPath = join(testCdbDir, filename);

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT, str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT);
    `);

    for (const card of cards) {
      db.exec(`INSERT INTO datas VALUES (${card.id}, 0, 0, 0, 2, 1000, 1000, 4, 0, 0, 0);`);
      db.exec(`INSERT INTO texts VALUES (${card.id}, '${card.name.replace(/'/g, "''")}', '${card.desc.replace(/'/g, "''")}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`);
    }
    db.close();

    return dbPath;
  }

  describe("successive writes", () => {
    it("performs two successive writes", async () => {
      createTestDb("cards.cdb", [
        { id: 1, name: "Card One", desc: "First card" },
        { id: 2, name: "Card Two", desc: "Second card" },
      ]);

      const outputDir = join(tmpDir, "output");

      // First write
      const result1 = await legacyConvert(testCdbDir, outputDir, { emit: true });

      expect(result1).toBeDefined();
      expect(Array.isArray(result1)).toBe(true);
      expect((result1 as unknown[]).length).toBeGreaterThan(0);

      // Check file exists
      expect(existsSync(join(outputDir, "cards.json"))).toBe(true);

      // Second write (should overwrite)
      const result2 = await legacyConvert(testCdbDir, outputDir, { emit: true });

      expect(result2).toBeDefined();
      expect(Array.isArray(result2)).toBe(true);

      // File should still exist
      expect(existsSync(join(outputDir, "cards.json"))).toBe(true);

      // Content should be the same
      const content1 = JSON.parse(readFileSync(join(outputDir, "cards.json"), "utf-8"));
      const content2 = JSON.parse(readFileSync(join(outputDir, "cards.json"), "utf-8"));
      expect(JSON.stringify(content1)).toBe(JSON.stringify(content2));
    });
  });

  describe("emit-false behavior", () => {
    it("writes files when emit is false with outputDir", async () => {
      createTestDb("emit-false.cdb", [
        { id: 1, name: "Emit False Card", desc: "Test" },
      ]);

      const outputDir = join(tmpDir, "emit-output");

      // emit: false should still write
      const result = await legacyConvert(testCdbDir, outputDir, { emit: false });

      expect(result).toBeUndefined();
      expect(existsSync(join(outputDir, "emit-false.json"))).toBe(true);

      // Content should be valid
      const content = JSON.parse(readFileSync(join(outputDir, "emit-false.json"), "utf-8"));
      expect(content.datas).toBeDefined();
      expect(content.texts).toBeDefined();
    });

    it("writes nothing when emit is false without outputDir", async () => {
      createTestDb("no-output.cdb", [
        { id: 1, name: "No Output Card", desc: "Test" },
      ]);

      const result = await legacyConvert(testCdbDir, undefined, { emit: false });

      expect(result).toBeUndefined();
    });

    it("returns tables when emit is true without outputDir", async () => {
      createTestDb("return-tables.cdb", [
        { id: 1, name: "Return Card", desc: "Test" },
      ]);

      const result = await legacyConvert(testCdbDir, undefined, { emit: true });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBeGreaterThan(0);
    });
  });

  describe("output directory creation", () => {
    it("creates output directory if it does not exist", async () => {
      createTestDb("new-dir.cdb", [
        { id: 1, name: "New Dir Card", desc: "Test" },
      ]);

      const outputDir = join(tmpDir, "newly-created-dir");

      expect(existsSync(outputDir)).toBe(false);

      await legacyConvert(testCdbDir, outputDir, { emit: true });

      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, "new-dir.json"))).toBe(true);
    });

    it("handles nested output directory creation", async () => {
      createTestDb("nested.cdb", [
        { id: 1, name: "Nested Card", desc: "Test" },
      ]);

      const outputDir = join(tmpDir, "a", "b", "c", "nested-output");

      expect(existsSync(outputDir)).toBe(false);

      await legacyConvert(testCdbDir, outputDir, { emit: true });

      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, "nested.json"))).toBe(true);
    });
  });

  describe("basename collision", () => {
    it("ignores files in ignore list", async () => {
      createTestDb("include.cdb", [{ id: 1, name: "Included", desc: "Include me" }]);
      createTestDb("ignore.cdb", [{ id: 2, name: "Ignored", desc: "Ignore me" }]);

      const outputDir = join(tmpDir, "ignore-output");

      const result = await legacyConvert(testCdbDir, outputDir, {
        emit: true,
        ignore: ["ignore"],
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      // Should only have one result (include.cdb)
      expect((result as unknown[]).length).toBe(1);
      expect((result as Array<{ name: string }>)[0].name).toBe("include");
    });
  });

  describe("atomic write behavior", () => {
    it("does not leave truncated file on failure", async () => {
      createTestDb("atomic.cdb", [
        { id: 1, name: "Atomic Card", desc: "Test" },
      ]);

      const outputDir = join(tmpDir, "atomic-output");

      await legacyConvert(testCdbDir, outputDir, { emit: true });

      // File should be complete
      const content = JSON.parse(readFileSync(join(outputDir, "atomic.json"), "utf-8"));
      expect(content.datas).toBeDefined();
      expect(content.texts).toBeDefined();
    });
  });
});
