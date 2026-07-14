import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildHighCardinalityRawCdb } from "../fixtures/buildHighCardinalityRawCdb.js";
import { cleanupCdb } from "../fixtures/buildCdbFixture.js";
import { iterateRawCards } from "../../src/cdb/iterateRows.js";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");

describe("raw high-cardinality streaming", () => {
  it("matches an independently collected reference under a 256 MB heap", async () => {
    const databasePath = buildHighCardinalityRawCdb();
    try {
      const referenceDatas: unknown[] = [];
      const referenceTexts: unknown[] = [];
      for await (const row of iterateRawCards(databasePath)) {
        if (row.datas) referenceDatas.push(row.datas);
        if (row.texts) referenceTexts.push(row.texts);
      }

      const child = spawnSync(
        process.execPath,
        [
          "--max-old-space-size=256",
          CLI_PATH,
          "convert",
          databasePath,
          "--profile",
          "raw",
        ],
        {
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 50 * 1024 * 1024,
        },
      );

      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      const output = JSON.parse(child.stdout);
      expect(output.tables.datas).toEqual(referenceDatas);
      expect(output.tables.texts).toEqual(referenceTexts);
      expect(output.tables.datas).toHaveLength(3_000);
      expect(output.tables.texts).toHaveLength(3_000);
    } finally {
      cleanupCdb(databasePath);
    }
  }, 180_000);

  it("keeps the CLI path free of the complete-envelope accumulator", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "application", "convertCatalog.ts"),
      "utf8",
    );
    expect(source).toContain("streamRawDatabase");
    expect(source).not.toContain("RawEnvelopeBuilder");
    expect(source).not.toContain("envelopeBuilder.addCard");
  });
});
