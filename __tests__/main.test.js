import { it, expect } from "vitest";
import path from "node:path";
import legacyConvert from "../app/index.js";

const basePath = `${process.cwd()}/__tests__`;
const inputDir = path.join(basePath, "input_dir");

it("legacy convert function runs without error", async () => {
  // legacyConvert takes inputDir, optional outputDir, and options
  // It should find the cards.cdb file and return LegacyTableResult[]
  const result = await legacyConvert(inputDir);

  // Should return an array with one result
  expect(result).toBeDefined();
  if (result && Array.isArray(result)) {
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].data.datas.length).toBeGreaterThan(0);
    expect(result[0].data.texts.length).toBeGreaterThan(0);
  }
});