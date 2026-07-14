/**
 * Backpressure failure handling tests.
 *
 * Per P5-AC4:
 * "Streamed JSON/JSONL output, including raw envelope datas/texts arrays,
 * matches a collected reference in order, honors backpressure, processes one
 * database at a time, and removes temporary state after injected writer
 * failure or cancellation without an all-record unmerged collector."
 *
 * Per INT-AC3:
 * "Input mutation, invalid encoding/text/ID, resource overflow,
 * duplicate/collision, writer failure, cancellation, and destination race
 * scenarios close all private resources and preserve the documented
 * final-output state."
 *
 * Evidence command: npm run test:streaming
 */

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { Writable, WritableOptions } from "node:stream";
import { JsonLinesWriter } from "../../src/serialization/jsonLinesWriter.js";
import { JsonArrayWriter } from "../../src/serialization/jsonArrayWriter.js";

// ---------------------------------------------------------------------------
// Mock writable stream that can simulate backpressure failure
// ---------------------------------------------------------------------------

/**
 * Create a writable stream that fails after a configurable number of writes.
 * Errors are passed to the callback asynchronously.
 */
function createFailingWritable(
  failAfter: number,
  failWith: Error = new Error("Simulated write failure")
): Writable {
  let writeCount = 0;

  return new Writable({
    write(chunk: Buffer, _enc, callback) {
      writeCount++;
      if (writeCount > failAfter) {
        // Errors passed to callback become observed errors in Node.js.
        // Our writer implementation handles these and surfaces them via flush().
        callback(failWith);
      } else {
        callback();
      }
    },
    final(callback) {
      callback();
    },
  } as WritableOptions);
}

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
// JsonLinesWriter backpressure tests
// ---------------------------------------------------------------------------

describe("JsonLinesWriter backpressure handling (P5-AC4)", () => {
  describe("reserve callback failure", () => {
    it("throws when reserve callback returns false", async () => {
      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream, {
        reserve: () => false,
      });

      await expect(writer.write({ id: "1" })).rejects.toThrow("budget exceeded");
      end();
    });

    it("throws immediately before write when reserve fails", async () => {
      const { stream, getOutput, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream, {
        reserve: () => false,
      });

      await expect(writer.write({ id: "1" })).rejects.toThrow("budget exceeded");
      expect(getOutput()).toBe("");
      end();
    });

    it("calls reserve before each write", async () => {
      const { stream, end } = createCollectingStream();
      const reserve = vi.fn().mockReturnValue(true);

      const writer = new JsonLinesWriter(stream, { reserve });
      await writer.write({ id: "1" });
      await writer.write({ id: "2" });
      await writer.write({ id: "3" });

      expect(reserve).toHaveBeenCalledTimes(3);
      end();
    });

    it("throws when reserve fails mid-stream", async () => {
      const { stream, end } = createCollectingStream();
      let callCount = 0;

      const writer = new JsonLinesWriter(stream, {
        reserve: () => {
          callCount++;
          return callCount <= 2; // Fail on 3rd write
        },
      });

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });

      await expect(writer.write({ id: "3" })).rejects.toThrow("budget exceeded");
      end();
    });
  });

  describe("stream write failure", () => {
    it("flush rejects with error after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" }); // First write succeeds
      await writer.write({ id: "2" }); // Second write fails (callback with error)

      // flush() should reject with the observed error
      await expect(writer.flush()).rejects.toThrow("Simulated write failure");
    });

    it("writer is marked as aborted after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });

      await expect(writer.flush()).rejects.toThrow("Simulated write failure");

      expect(writer.isAborted).toBe(true);
    });

    it("write rejects after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" }); // Fails

      // After stream failure, writer is still OPEN (error is recorded but
      // not yet observed via flush). Subsequent writes still work.
      expect(writer.isAborted).toBe(false);

      // After flush observes the error, writer transitions to ABORTED.
      await expect(writer.flush()).rejects.toThrow("Simulated write failure");
      expect(writer.isAborted).toBe(true);

      // Now subsequent writes should throw.
      await expect(writer.write({ id: "3" })).rejects.toThrow(
        "Cannot write to an aborted JSON Lines writer"
      );
    });

    it("close rejects after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });

      await expect(writer.close()).rejects.toThrow("Simulated write failure");
      expect(writer.isAborted).toBe(true);
    });
  });

  describe("reconcile callback", () => {
    it("reconcile is called after successful write", async () => {
      const { stream, end } = createCollectingStream();
      const reconcile = vi.fn();

      const writer = new JsonLinesWriter(stream, {
        reserve: () => true,
        reconcile,
      });

      await writer.write({ id: "1" });

      expect(reconcile).toHaveBeenCalledTimes(1);
      end();
    });

    it("reconcile is not called when reserve fails", async () => {
      const { stream, end } = createCollectingStream();
      const reconcile = vi.fn();

      const writer = new JsonLinesWriter(stream, {
        reserve: () => false,
        reconcile,
      });

      await expect(writer.write({ id: "1" })).rejects.toThrow();
      expect(reconcile).not.toHaveBeenCalled();
      end();
    });

    it("reconcile receives bytes written", async () => {
      const { stream, end } = createCollectingStream();
      const reconcile = vi.fn();

      const writer = new JsonLinesWriter(stream, {
        reserve: () => true,
        reconcile,
      });

      await writer.write({ id: "123456789" }); // 17 bytes JSON

      expect(reconcile).toHaveBeenCalledWith(expect.any(Number));
      end();
    });
  });

  describe("writer lifecycle after failure", () => {
    it("close returns silently after abort (no throw)", async () => {
      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      writer.abort();

      // close() should return silently after abort
      await expect(writer.close()).resolves.toBeUndefined();
      end();
    });

    it("isClosed is false after abort", () => {
      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      writer.abort();

      expect(writer.isClosed).toBe(false);
      end();
    });

    it("state transitions: OPEN -> ABORTED", () => {
      const { stream, end } = createCollectingStream();
      const writer = new JsonLinesWriter(stream);

      expect(writer.isClosed).toBe(false);
      expect(writer.isAborted).toBe(false);

      writer.abort();

      expect(writer.isClosed).toBe(false);
      expect(writer.isAborted).toBe(true);
      end();
    });

    it("flush properly surfaces stream errors", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" }); // Fails via callback

      // flush() should observe the error and reject
      await expect(writer.flush()).rejects.toThrow("Simulated write failure");
      expect(writer.isAborted).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// JsonArrayWriter backpressure tests
// ---------------------------------------------------------------------------

describe("JsonArrayWriter backpressure handling (P5-AC4)", () => {
  describe("reserve callback failure", () => {
    it("throws when reserve callback returns false", async () => {
      const { stream, end } = createCollectingStream();
      const writer = new JsonArrayWriter(stream, {
        reserve: () => false,
      });

      await expect(writer.write({ id: "1" })).rejects.toThrow("budget exceeded");
      end();
    });
  });

  describe("stream write failure", () => {
    it("flush rejects with error after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonArrayWriter(failStream);

      await writer.write({ id: "1" }); // First write succeeds
      await writer.write({ id: "2" }); // Second write fails

      await expect(writer.flush()).rejects.toThrow("Simulated write failure");
    });

    it("writer is marked as aborted after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonArrayWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });

      await expect(writer.flush()).rejects.toThrow("Simulated write failure");

      expect(writer.isAborted).toBe(true);
    });

    it("close rejects after stream failure", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonArrayWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });

      await expect(writer.close()).rejects.toThrow("Simulated write failure");
      expect(writer.isAborted).toBe(true);
    });

    it("flush properly surfaces stream errors", async () => {
      const failStream = createFailingWritable(1);
      const writer = new JsonArrayWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" }); // Fails via callback

      await expect(writer.flush()).rejects.toThrow("Simulated write failure");
      expect(writer.isAborted).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: writer error propagates through flush/close
// ---------------------------------------------------------------------------

describe("Writer error propagation (INT-AC3)", () => {
  it("JsonLinesWriter flush failure allows caller cleanup", async () => {
    const failStream = createFailingWritable(2);
    const writer = new JsonLinesWriter(failStream);

    // Write three records, third fails
    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    await writer.write({ id: "3" });

    // flush() rejects with the error
    await expect(writer.flush()).rejects.toThrow("Simulated write failure");

    // Writer is now aborted, allowing cleanup
    expect(writer.isAborted).toBe(true);
    expect(writer.isClosed).toBe(false);
  });

  it("JsonArrayWriter flush failure allows caller cleanup", async () => {
    const failStream = createFailingWritable(2);
    const writer = new JsonArrayWriter(failStream);

    await writer.write({ id: "1" });
    await writer.write({ id: "2" });
    await writer.write({ id: "3" });

    await expect(writer.flush()).rejects.toThrow("Simulated write failure");

    expect(writer.isAborted).toBe(true);
    expect(writer.isClosed).toBe(false);
  });

  it("no unhandled errors in full test suite run", async () => {
    // This test exists to ensure the backpressure suite itself doesn't
    // leave unhandled errors that would fail npm test.
    const unhandledErrors: Error[] = [];
    const handler = (err: Error) => unhandledErrors.push(err);
    process.on("unhandledRejection", handler);

    try {
      const failStream = createFailingWritable(1);
      const writer = new JsonLinesWriter(failStream);

      await writer.write({ id: "1" });
      await writer.write({ id: "2" });
      await writer.flush().catch(() => {}); // Expected to fail

      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", handler);
    }

    expect(unhandledErrors).toHaveLength(0);
  });
});
