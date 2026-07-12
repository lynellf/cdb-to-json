/**
 * Integration tests for CDB reader.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { openDatabaseSafe, closeDatabaseSafe } from "../../src/cdb/openDatabase.js";
import { iterateRawCards } from "../../src/cdb/iterateRows.js";
import { discoverInputs } from "../../src/discovery/discoverCdbInputs.js";
import type Database from "better-sqlite3";

const FIXTURE_PATH = join(process.cwd(), "__tests__", "input_dir", "cards.cdb");

describe("CDB Reader", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = openDatabaseSafe(FIXTURE_PATH);
  });

  afterAll(() => {
    closeDatabaseSafe(db);
  });

  it("opens database successfully", () => {
    expect(db).toBeDefined();
  });

  it("reads metadata correctly", () => {
    const datasCount = (db.prepare("SELECT COUNT(*) as count FROM datas").get() as { count: number }).count;
    const textsCount = (db.prepare("SELECT COUNT(*) as count FROM texts").get() as { count: number }).count;
    expect(datasCount).toBeGreaterThan(0);
    expect(textsCount).toBeGreaterThan(0);
  });

  it("iterates card rows successfully", async () => {
    const cards: unknown[] = [];
    for await (const cardRow of iterateRawCards(FIXTURE_PATH)) {
      cards.push(cardRow);
    }
    expect(cards.length).toBeGreaterThan(0);
  });

  it("card rows have complete pairs for most cards", async () => {
    let completePairs = 0;
    let totalCards = 0;

    for await (const cardRow of iterateRawCards(FIXTURE_PATH)) {
      totalCards++;
      if (cardRow.datas && cardRow.texts) {
        completePairs++;
      }
    }

    expect(completePairs).toBeGreaterThan(totalCards * 0.9);
  });
});

describe("Input Discovery", () => {
  it("discovers CDB files in a directory", async () => {
    const inputDir = join(process.cwd(), "__tests__", "input_dir");
    const discovered = await discoverInputs([inputDir], { recursive: false });

    expect(discovered.length).toBe(1);
    expect(discovered[0].name).toBe("cards.cdb");
    expect(discovered[0].isDirectory).toBe(false);
  });

  it("discovers CDB file directly", async () => {
    const discovered = await discoverInputs([FIXTURE_PATH]);
    expect(discovered.length).toBe(1);
    expect(discovered[0].path).toBe(FIXTURE_PATH);
  });

  it("returns empty for non-existent paths", async () => {
    const discovered = await discoverInputs(["/nonexistent/path"]);
    expect(discovered.length).toBe(0);
  });
});
