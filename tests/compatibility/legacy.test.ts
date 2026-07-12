/**
 * Tests for the legacy compatibility bridge.
 *
 * Validates that the v1-shaped API correctly reproduces the
 * old fixture's logical content.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

// Import the built legacy module
const FIXTURE_DIR = join(process.cwd(), "__tests__", "input_dir");

describe("Legacy bridge", () => {
  it("has correct default export", async () => {
    // The legacy module should be importable
    const legacyModule = await import("../../dist/legacy.js");
    expect(legacyModule.default).toBeDefined();
    expect(typeof legacyModule.default).toBe("function");
  });

  it("returns expected table shape for valid input", async () => {
    const legacyModule = await import("../../dist/legacy.js");
    const result = await legacyModule.default(FIXTURE_DIR, undefined, {
      emit: true,
      ignore: [],
    });

    // Should return array of { name, data }
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);

    const entry = result[0];
    expect(entry).toHaveProperty("name");
    expect(entry).toHaveProperty("data");
    expect(entry.data).toHaveProperty("datas");
    expect(entry.data).toHaveProperty("texts");

    // Should have actual card data
    expect(entry.data.datas.length).toBeGreaterThan(0);
    expect(entry.data.texts.length).toBeGreaterThan(0);
  });

  it("returns void when emit is false without outputDir", async () => {
    const legacyModule = await import("../../dist/legacy.js");
    const result = await legacyModule.default(FIXTURE_DIR, undefined, {
      emit: false,
    });

    expect(result).toBeUndefined();
  });

  it("writes to output directory when outputDir is specified", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "legacy-test-"));
    try {
      const legacyModule = await import("../../dist/legacy.js");
      await legacyModule.default(FIXTURE_DIR, tmpDir, {
        emit: true,
        ignore: [],
      });

      // Should have created the output file
      const outputPath = join(tmpDir, "cards.json");
      expect(existsSync(outputPath)).toBe(true);

      // Verify the content is parseable JSON
      const content = JSON.parse(readFileSync(outputPath, "utf-8"));
      expect(content).toHaveProperty("datas");
      expect(content).toHaveProperty("texts");
      expect(content.datas.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});