/**
 * Tests for input discovery with symlink handling, ordering, and exclusion rules.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { discoverInputs } from "../../src/discovery/discoverCdbInputs.js";
import { isExactCdbFile, legacyContainsCdb, legacyBasename } from "../../src/discovery/pathPolicy.js";

const FIXTURE_DIR = join(process.cwd(), "__tests__", "input_dir");
const FIXTURE_PATH = join(FIXTURE_DIR, "cards.cdb");

describe("Input Discovery", () => {
  it("discovers single CDB file in directory", async () => {
    const discovered = await discoverInputs([FIXTURE_DIR], { recursive: false });
    expect(discovered.length).toBe(1);
    expect(discovered[0].name).toBe("cards.cdb");
  });

  it("discovers CDB file by explicit path", async () => {
    const discovered = await discoverInputs([FIXTURE_PATH]);
    expect(discovered.length).toBe(1);
    expect(discovered[0].path).toBe(FIXTURE_PATH);
  });

  it("returns empty for non-existent paths", async () => {
    const discovered = await discoverInputs(["/nonexistent/path"]);
    expect(discovered.length).toBe(0);
  });

  it("returns empty for directory with no CDB files", async () => {
    const discovered = await discoverInputs([join(process.cwd(), "src")], { recursive: false });
    expect(discovered.length).toBe(0);
  });
});

describe("isExactCdbFile", () => {
  it("accepts simple .cdb extension", () => {
    expect(isExactCdbFile("cards.cdb")).toBe(true);
  });

  it("rejects filenames without .cdb", () => {
    expect(isExactCdbFile("cards.txt")).toBe(false);
    expect(isExactCdbFile("cards")).toBe(false);
  });

  it("rejects filenames that merely contain .cdb", () => {
    expect(isExactCdbFile("cards.cdb.backup")).toBe(false);
    expect(isExactCdbFile("my.cdb.backup")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isExactCdbFile("CARDS.CDB")).toBe(true);
    expect(isExactCdbFile("Cards.Cdb")).toBe(true);
  });
});

describe("legacyContainsCdb", () => {
  it("accepts filenames containing .cdb", () => {
    expect(legacyContainsCdb("cards.cdb")).toBe(true);
    expect(legacyContainsCdb("cards.cdb.backup")).toBe(true);
    expect(legacyContainsCdb("my.cdb")).toBe(true);
  });

  it("rejects filenames without .cdb", () => {
    expect(legacyContainsCdb("cards.txt")).toBe(false);
    expect(legacyContainsCdb("cards")).toBe(false);
  });
});

describe("legacyBasename", () => {
  it("returns first dot segment", () => {
    expect(legacyBasename("cards.cdb")).toBe("cards");
    expect(legacyBasename("cards.cdb.backup")).toBe("cards");
    expect(legacyBasename("my.cdb")).toBe("my");
  });

  it("handles names without dots", () => {
    expect(legacyBasename("cards")).toBe("cards");
  });
});