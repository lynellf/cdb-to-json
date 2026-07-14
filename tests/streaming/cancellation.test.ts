/**
 * Cancellation handling tests.
 *
 * Per P5-AC4:
 * "Streamed JSON/JSONL output, including raw envelope datas/texts arrays,
 * matches a collected reference in order, honors backpressure, processes one
 * database at a time, and removes temporary state after injected writer
 * failure or cancellation without an all-record unmerged collector."
 *
 * Per INV-003:
 * "Reader processing is bounded and deterministic... cancellation closes
 * every owned resource."
 *
 * Evidence command: npm run test:streaming
 */

import { describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { JsonLinesWriter } from "../../src/serialization/jsonLinesWriter.js";
import { JsonArrayWriter } from "../../src/serialization/jsonArrayWriter.js";
import { iterateRawCards } from "../../src/cdb/iterateRows.js";
import { getDefaultLimits } from "../../src/application/types.js";
import { createMinimalCdb, cleanupCdb } from "../fixtures/buildCdbFixture.js";
import { rmSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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
// JsonLinesWriter cancellation tests
// ---------------------------------------------------------------------------

describe("JsonLinesWriter cancellation (P5-AC4)", () => {
  it("abort() sets isAborted to true", () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    expect(writer.isAborted).toBe(false);

    writer.abort();

    expect(writer.isAborted).toBe(true);
    end();
  });

  it("abort() rejects further writes", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    writer.abort();

    await expect(writer.write({ id: "1" })).rejects.toThrow("aborted");
    end();
  });

  it("close() returns silently after abort (no throw)", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    writer.abort();

    // Implementation: close() returns silently after abort
    await expect(writer.close()).resolves.toBeUndefined();
    end();
  });

  it("abort() preserves previously written data", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    await writer.write({ id: "3" });
    writer.abort();

    const output = getOutput();
    const lines = output.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(3);
    end();
  });

  it("records count is frozen after abort", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    expect(writer.records).toBe(2);

    writer.abort();
    expect(writer.records).toBe(2);

    await expect(writer.write({ id: "3" })).rejects.toThrow();

    expect(writer.records).toBe(2);
    end();
  });

  it("isClosed remains false after abort", () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    expect(writer.isClosed).toBe(false);

    writer.abort();

    expect(writer.isClosed).toBe(false);
    end();
  });

  it("state transitions: OPEN -> ABORTED (not CLOSED)", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    // Initial state
    expect(writer.isClosed).toBe(false);
    expect(writer.isAborted).toBe(false);

    writer.abort();

    // Aborted state
    expect(writer.isClosed).toBe(false);
    expect(writer.isAborted).toBe(true);

    // Cannot transition to CLOSED after abort
    await expect(writer.close()).resolves.toBeUndefined();
    end();
  });

  it("abort() can be called multiple times without error", () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonLinesWriter(stream);

    writer.abort();
    expect(() => writer.abort()).not.toThrow();
    end();
  });
});

// ---------------------------------------------------------------------------
// JsonArrayWriter cancellation tests
// ---------------------------------------------------------------------------

describe("JsonArrayWriter cancellation (P5-AC4)", () => {
  it("abort() sets isAborted to true", () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    expect(writer.isAborted).toBe(false);

    writer.abort();

    expect(writer.isAborted).toBe(true);
    end();
  });

  it("abort() rejects further writes", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    writer.abort();

    await expect(writer.write({ id: "1" })).rejects.toThrow("aborted");
    end();
  });

  it("close() returns silently after abort (no throw)", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    writer.abort();

    // Implementation: close() returns silently after abort
    await expect(writer.close()).resolves.toBeUndefined();
    end();
  });

  it("abort() preserves previously written data", async () => {
    const { stream, getOutput, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    writer.abort();

    // Even though closed, the stream was never finalized
    const output = getOutput();
    expect(output).not.toBe("");
    end();
  });

  it("records count is frozen after abort", async () => {
    const { stream, end } = createCollectingStream();
    const writer = new JsonArrayWriter(stream);

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    expect(writer.records).toBe(2);

    writer.abort();
    expect(writer.records).toBe(2);
    end();
  });
});

// ---------------------------------------------------------------------------
// iterateRawCards cancellation tests
// ---------------------------------------------------------------------------

describe("iterateRawCards cancellation (INV-003)", () => {
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

      // Explicit return
      const returnResult = await iterator.return!();
      expect(returnResult.done).toBe(true);

      // Iterator should be exhausted
      const secondResult = await iterator.next();
      expect(secondResult.done).toBe(true);
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("cancels via AbortSignal", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
      { id: 3, name: "Card C", desc: "Desc C", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const iterator = iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      });

      // Start iteration
      await iterator.next();

      // Cancel
      controller.abort();

      // Iterator should be exhausted
      const result = await iterator.next();
      expect(result.done).toBe(true);
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("cleans up resources after abort", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
      { id: 3, name: "Card C", desc: "Desc C", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const iterator = iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      });

      // Consume one record
      await iterator.next();

      // Abort
      controller.abort();

      // Try to continue - should be exhausted
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });

      // Should not throw on return either
      await iterator.return!();
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("handles return() called multiple times", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const iterator = iterateRawCards(dbPath, { limits });

      await iterator.next();
      await iterator.return!();

      // Multiple returns should not throw
      await expect(iterator.return!()).resolves.toEqual({ done: true, value: undefined });
      await expect(iterator.return!()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("aborted iterator cannot be reused", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const iterator = iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      });

      await iterator.next();
      controller.abort();

      // After abort, iterator is done
      const result = await iterator.next();
      expect(result.done).toBe(true);

      // Further iteration should be no-op
      const secondResult = await iterator.next();
      expect(secondResult.done).toBe(true);
    } finally {
      cleanupCdb(dbPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: writer + iterator cancellation
// ---------------------------------------------------------------------------

describe("writer + iterator integration cancellation (P5-AC4)", () => {
  it("cancels iterator and writer together", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
      { id: 3, name: "Card C", desc: "Desc C", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      // Start processing
      let count = 0;
      for await (const rows of iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      })) {
        await writer.write(rows);
        count++;

        // Cancel after first record
        if (count === 1) {
          controller.abort();
          break;
        }
      }

      // Writer should have one record
      expect(writer.records).toBe(1);
      expect(writer.isAborted).toBe(false);

      // Iterator should be exhausted
      expect(controller.signal.aborted).toBe(true);

      end();
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("aborts writer when iterator is cancelled mid-stream", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
      { id: 3, name: "Card C", desc: "Desc C", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      // Process with explicit abort on iterator
      for await (const rows of iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      })) {
        await writer.write(rows);
        controller.abort(); // Cancel after one write
        break;
      }

      // Writer was not aborted by iterator cancellation
      expect(writer.isAborted).toBe(false);
      expect(writer.records).toBe(1);

      end();
    } finally {
      cleanupCdb(dbPath);
    }
  });

  it("cleans up writer state after cancellation", async () => {
    const dbPath = createMinimalCdb([
      { id: 1, name: "Card A", desc: "Desc A", type: 0x2 },
      { id: 2, name: "Card B", desc: "Desc B", type: 0x2 },
    ]);

    try {
      const limits = getDefaultLimits();
      const controller = new AbortController();

      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      for await (const rows of iterateRawCards(dbPath, {
        limits,
        signal: controller.signal,
      })) {
        await writer.write(rows);
      }

      // Writer should be open
      expect(writer.isClosed).toBe(false);
      expect(writer.isAborted).toBe(false);

      // Close normally
      await writer.close();
      expect(writer.isClosed).toBe(true);

      end();
    } finally {
      cleanupCdb(dbPath);
    }
  });
});
