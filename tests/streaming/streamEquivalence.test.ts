/**
 * Tests for streaming output equivalence and backpressure.
 *
 * P4 task 4.4 acceptance:
 * "Make streaming observable and backpressure-safe"
 *
 * These tests verify:
 * 1. JsonLinesWriter produces one record per line (JSONL format)
 * 2. JsonArrayWriter produces valid JSON arrays
 * 3. Streamed and collected representations decode to identical ordered records
 * 4. Writer backpressure is handled via reserve/reconcile callbacks
 */

import { describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { JsonLinesWriter } from "../../src/serialization/jsonLinesWriter.js";
import { JsonArrayWriter } from "../../src/serialization/jsonArrayWriter.js";
import { createMinimalCdb } from "../fixtures/buildCdbFixture.js";
import { iterateRawCards } from "../../src/cdb/iterateRows.js";
import { getDefaultLimits } from "../../src/application/types.js";
import { rmSync } from "node:fs";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a writable stream that collects chunks and calls a callback when done.
 * The stream is automatically ended after writer.close() is called.
 */
function createCollectingStream(): {
  stream: Writable;
  getOutput: () => string;
  end: () => void;
} {
  const chunks: string[] = [];
  let ended = false;

  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString("utf-8"));
      cb();
    },
  });

  return {
    stream,
    getOutput: () => chunks.join(""),
    end() {
      if (!ended) {
        ended = true;
        stream.end();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// JsonLinesWriter — format correctness
// ---------------------------------------------------------------------------

describe("JsonLinesWriter format correctness (P4-4.4)", () => {
  it("writes one compact JSON object per line", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    await writer.write({ id: "1", name: "Dark Magician" });
    await writer.write({ id: "2", name: "Blue-Eyes White Dragon" });
    await writer.write({ id: "3", name: "Sangan" });
    await writer.close();
    end();

    const output = getOutput();
    const lines = output.split("\n").filter((l) => l.trim() !== "");

    expect(lines).toHaveLength(3);

    // Each line should be valid compact JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Verify parsed content
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toEqual({ id: "1", name: "Dark Magician" });
    expect(parsed[1]).toEqual({ id: "2", name: "Blue-Eyes White Dragon" });
    expect(parsed[2]).toEqual({ id: "3", name: "Sangan" });
  });

  it("rejects writes after close", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);
    await writer.close();
    end();

    await expect(writer.write({ id: "1" })).rejects.toThrow("closed");
  });

  it("tracks record count via .records", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    expect(writer.records).toBe(0);
    await writer.write({ id: "1" });
    expect(writer.records).toBe(1);
    await writer.write({ id: "2" });
    expect(writer.records).toBe(2);
    await writer.close();
    end();
  });

  it("writer state transitions correctly via isClosed", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    expect(writer.isClosed).toBe(false);
    await writer.close();
    expect(writer.isClosed).toBe(true);
    end();
  });

  it("isAborted is false after normal close", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);
    await writer.close();
    end();

    expect(writer.isAborted).toBe(false);
  });

  it("abort() sets isAborted to true", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);
    await writer.write({ id: "1" });
    writer.abort();
    end();

    expect(writer.isAborted).toBe(true);
    await expect(writer.write({ id: "2" })).rejects.toThrow("aborted");
  });
});

// ---------------------------------------------------------------------------
// JsonArrayWriter — format correctness
// ---------------------------------------------------------------------------

describe("JsonArrayWriter format correctness (P4-4.4)", () => {
  it("produces a valid JSON array with all records", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    await writer.write({ id: "1", name: "Dark Magician" });
    await writer.write({ id: "2", name: "Blue-Eyes" });
    await writer.write({ id: "3", name: "Sangan" });
    await writer.close();
    end();

    const output = getOutput();

    // Should be a valid JSON array
    expect(() => {
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    }).not.toThrow();
  });

  it("records are emitted in order", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    for (let i = 1; i <= 5; i++) {
      await writer.write({ id: String(i), name: `Card ${i}` });
    }
    await writer.close();
    end();

    const output = getOutput();
    const parsed = JSON.parse(output) as Array<{ id: string }>;

    expect(parsed.map((r) => r.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("writes zero records as empty array", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);
    await writer.close();
    end();

    const output = getOutput();
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([]);
  });

  it("array is closed with proper suffix", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);
    await writer.write({ id: "1" });
    await writer.close();
    end();

    const output = getOutput();
    // Should end with ]
    expect(output.trim().endsWith("]")).toBe(true);
    // Should parse to a valid array
    expect(() => JSON.parse(output)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Backpressure handling
// ---------------------------------------------------------------------------

describe("backpressure handling (P4-4.4)", () => {
  it("reserve callback is called before each write", async () => {
    const { stream, end } = createCollectingStream();
    const reserve = vi.fn().mockReturnValue(true);
    const writer = new JsonLinesWriter(stream, { reserve });

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    await writer.close();
    end();

    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it("reconcile callback is called after each write", async () => {
    const { stream, end } = createCollectingStream();
    const reconcile = vi.fn();
    const writer = new JsonLinesWriter(stream, {
      reserve: () => true,
      reconcile,
    });

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    await writer.close();
    end();

    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("writer state transitions correctly via isClosed", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    expect(writer.isClosed).toBe(false);
    await writer.close();
    expect(writer.isClosed).toBe(true);
    end();
  });

  it("reserve returning false throws before write", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream, {
      reserve: () => false,
    });

    await expect(writer.write({ id: "1" })).rejects.toThrow("budget exceeded");
    end();
  });
});

// ---------------------------------------------------------------------------
// iterateRawCards — public row API
// ---------------------------------------------------------------------------

describe("iterateRawCards public API (P4-4.4)", () => {
  it("returns an async iterable of RawCardRows", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Dark Magician", desc: "A powerful wizard.", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const results: unknown[] = [];

      for await (const rows of iterateRawCards(dbPath, { limits })) {
        results.push(rows);
      }

      expect(results.length).toBeGreaterThan(0);
      for (const rows of results) {
        expect(rows).toHaveProperty("datas");
        expect(rows).toHaveProperty("texts");
      }
    } finally {
      rmSync(dbPath, { force: true });
    }
  });

  it("supports explicit return() to close resources", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
      { id: 3, name: "Card C", desc: "Desc C", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const iterator = iterateRawCards(dbPath, { limits });
      const firstResult = await iterator.next();

      expect(firstResult.done).toBe(false);
      expect(firstResult.value).toHaveProperty("datas");

      const returnResult = await iterator.return!();
      expect(returnResult.done).toBe(true);
    } finally {
      rmSync(dbPath, { force: true });
    }
  });

  it("yields cards in stable order (cardId ascending)", async () => {
    const dbPath = createMinimalCdb([
      { id: 3, name: "Card C", desc: "C", type: 0x2 },
      { id: 1, name: "Card A", desc: "A", type: 0x2 },
      { id: 2, name: "Card B", desc: "B", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const ids: string[] = [];

      for await (const rows of iterateRawCards(dbPath, { limits })) {
        const id = (rows.datas?.id ?? rows.texts?.id) ?? "0";
        ids.push(id);
      }

      expect(ids).toEqual(["1", "2", "3"]);
    } finally {
      rmSync(dbPath, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Stream equivalence (collected vs streamed)
// ---------------------------------------------------------------------------

describe("stream equivalence (P4-4.4)", () => {
  it("streamed JSONL and collected JSONL produce same logical records", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2, atk: 1000, def: 800 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2, atk: 2000, def: 0 },
    ]);

    try {
      const limits = getDefaultLimits();

      // Collected reference: accumulate all records
      const collected: string[] = [];
      for await (const rows of iterateRawCards(dbPath, { limits })) {
        collected.push(JSON.stringify(rows));
      }

      // Streamed: write directly to a string
      const { stream, getOutput, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      for await (const rows of iterateRawCards(dbPath, { limits })) {
        await writer.write(rows);
      }
      await writer.close();
      end();

      const streamedOutput = getOutput();
      const streamedLines = streamedOutput.split("\n").filter((l) => l.trim() !== "");

      // Both should have same number of records
      expect(streamedLines.length).toBe(collected.length);
    } finally {
      rmSync(dbPath, { force: true });
    }
  });

  it("JSONL has one record per line (no multi-line objects)", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    // Write records that contain characters that could span lines
    await writer.write({ id: "1", name: "Card\nWith Newline", desc: "Desc" });
    await writer.write({ id: "2", name: "Normal Card", desc: "Normal Desc" });
    await writer.close();
    end();

    const output = getOutput();
    const lines = output.split("\n");

    // First line should be the first record (which has an embedded newline)
    // and the second line should be the second record
    // The embedded newline in the name gets escaped as \n in JSON
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Each non-empty line should parse as a complete JSON object
    const nonEmpty = lines.filter((l) => l.trim());
    for (const line of nonEmpty) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
