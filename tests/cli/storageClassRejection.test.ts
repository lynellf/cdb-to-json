/**
 * Storage class rejection tests for P1-AC3.
 *
 * Proves that the reader rejects invalid storage class inputs
 * (TEXT id, REAL type, BLOB type) with INVALID_INTEGER_VALUE (exit 4)
 * before the join/value-selection path can publish a record.
 *
 * Per P1-AC3: "invalid storage-class rejection" must be proven
 * by the test suite. These tests run the CLI against invalid fixtures
 * and verify the documented exit classification and diagnostic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

// Path to compiled CLI
const CLI_PATH = join(process.cwd(), "dist", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Create a CDB with TEXT storage for an INTEGER column (invalid).
 * The id column is TEXT instead of INTEGER.
 */
function createTextIdCdb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE datas (
      id TEXT PRIMARY KEY,
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
      str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT,
      str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT,
      str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
    );
    INSERT INTO datas VALUES ('100', 1, 0, 0, 2, 1000, 1000, 4, 16, 1, 0);
    INSERT INTO texts VALUES (100, 'Text ID', 'Invalid storage', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  db.close();
}

/**
 * Create a CDB with REAL storage for an INTEGER column (invalid).
 * The ot column is REAL instead of INTEGER.
 */
function createRealOtCdb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY,
      ot REAL,
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
      str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT,
      str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT,
      str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
    );
    INSERT INTO datas VALUES (101, 1.5, 0, 0, 2, 1000, 1000, 4, 16, 1, 0);
    INSERT INTO texts VALUES (101, 'Real OT', 'Invalid storage', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  db.close();
}

/**
 * Create a CDB with BLOB storage for an INTEGER column (invalid).
 * The category column is BLOB instead of INTEGER.
 */
function createBlobCategoryCdb(dbPath: string): void {
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
      category BLOB
    );
    CREATE TABLE texts (
      id INTEGER PRIMARY KEY,
      name TEXT,
      desc TEXT,
      str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT,
      str6 TEXT, str7 TEXT, str8 TEXT, str9 TEXT, str10 TEXT,
      str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
    );
    INSERT INTO datas VALUES (102, 0, 0, 0, 2, 1000, 1000, 4, 16, 1, X'FFFF');
    INSERT INTO texts VALUES (102, 'Blob Cat', 'Invalid storage', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  db.close();
}

describe("Storage class rejection (P1-AC3)", () => {
  describe("CLI rejection with exit 4", () => {
    it("TEXT id column is rejected with exit 4", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "cdb-storage-text-"));
      const dbPath = join(tmpDir, "test.cdb");
      createTextIdCdb(dbPath);

      try {
        const { exitCode, stderr } = runCli(["convert", dbPath, "-f", "json", "-p", "raw"]);

        // Exit 4 is INVALID_INTEGER_VALUE / RESOURCE_LIMIT_EXCEEDED
        expect(exitCode).toBe(4);
        // Should report the storage class problem
        expect(stderr).toMatch(/INVALID_INTEGER_VALUE|storage.*class/i);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("REAL integer column is rejected with exit 4", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "cdb-storage-real-"));
      const dbPath = join(tmpDir, "test.cdb");
      createRealOtCdb(dbPath);

      try {
        const { exitCode, stderr } = runCli(["convert", dbPath, "-f", "json", "-p", "raw"]);

        expect(exitCode).toBe(4);
        expect(stderr).toMatch(/INVALID_INTEGER_VALUE|storage.*class/i);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("BLOB integer column is rejected with exit 4", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "cdb-storage-blob-"));
      const dbPath = join(tmpDir, "test.cdb");
      createBlobCategoryCdb(dbPath);

      try {
        const { exitCode, stderr } = runCli(["convert", dbPath, "-f", "json", "-p", "raw"]);

        expect(exitCode).toBe(4);
        expect(stderr).toMatch(/INVALID_INTEGER_VALUE|storage.*class/i);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Rejection precedes output", () => {
    it("no valid JSON envelope is emitted when storage class is invalid", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "cdb-storage-precedence-"));
      const dbPath = join(tmpDir, "test.cdb");
      createTextIdCdb(dbPath);

      try {
        const { stdout, exitCode } = runCli(["convert", dbPath, "-f", "json", "-p", "raw"]);

        expect(exitCode).toBe(4);
        // No valid JSON envelope in stdout - rejection happens before output
        const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
        const validJsonCount = lines.filter((l) => {
          try {
            JSON.parse(l);
            return true;
          } catch {
            return false;
          }
        }).length;
        expect(validJsonCount).toBe(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
