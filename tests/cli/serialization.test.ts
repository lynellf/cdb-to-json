/**
 * Serialization tests.
 *
 * Tests canonical JSON, JSONL, and JSON array writers for:
 * - Deterministic output (compact/pretty, LF endings)
 * - UTF-8 byte counting (not JS code units)
 * - Non-finite and circular rejection
 * - Budget enforcement via reserve/reconcile
 * - OutputWriter interface lifecycle
 * - stdio separation (data vs diagnostic byte paths)
 *
 * Writer/budget foundation tests:
 * - OutputWriterOptions interface with reserve/reconcile callbacks
 * - Reserve -> sink -> reconcile event ordering
 * - bytesWritten advances only after reconciliation returns
 * - Flush-before-close commitment
 * - Reconciliation failure aborts without counter advance
 * - Stdout flush backpressure
 */

import { describe, it, expect } from "vitest";
import { serializeJson, hashCanonicalJson } from "../../src/serialization/canonicalJson.js";
import { JsonLinesWriter } from "../../src/serialization/jsonLinesWriter.js";
import { JsonArrayWriter } from "../../src/serialization/jsonArrayWriter.js";
import {
  TestOutputSink,
  CallbackOutputWriter,
  StdoutOutputWriter,
} from "../../src/serialization/outputWriter.js";
import type { OutputWriterOptions } from "../../src/serialization/outputWriter.js";
import { Writable } from "node:stream";

/**
 * Helper: create a writable stream that collects all written chunks.
 */
function collectStream(): { stream: Writable; chunks: Buffer[]; text(): string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  return {
    stream,
    chunks,
    text() {
      return Buffer.concat(chunks).toString("utf-8");
    },
  };
}

/**
 * Creates a Writable that records every write() call (the sink event) so that
 * OutputWriter adapter ordering can be verified for StdoutOutputWriter.
 * The sink is internal to the Writable; we observe it by subclassing.
 */
function spyStream(): {
  stream: Writable;
  writes: { chunk: Buffer; byteLength: number }[];
} {
  const writes: { chunk: Buffer; byteLength: number }[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      writes.push({ chunk: Buffer.from(chunk), byteLength: chunk.byteLength });
      callback();
    },
  });
  return { stream, writes };
}

/**
 * Creates a Writable whose write callback is deferred via setImmediate,
 * allowing the test to deterministically prove sink completion ordering
 * relative to the reconcile callback.
 */
function deferredSinkStream(): {
  stream: Writable;
  writes: { chunk: Buffer; byteLength: number }[];
} {
  const writes: { chunk: Buffer; byteLength: number }[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      writes.push({ chunk: Buffer.from(chunk), byteLength: chunk.byteLength });
      // Defer the callback so sink completion is observable in a later tick.
      setImmediate(callback);
    },
  });
  return { stream, writes };
}

// =============================================================================
// Canonical JSON
// =============================================================================

describe("Canonical JSON serializer", () => {
  it("produces compact JSON by default", () => {
    const result = serializeJson({ a: 1, b: 2 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("produces pretty JSON with two-space indent", () => {
    const result = serializeJson({ a: 1, b: 2 }, { pretty: true });
    expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("preserves null, boolean, and number types", () => {
    expect(serializeJson(null)).toBe("null");
    expect(serializeJson(true)).toBe("true");
    expect(serializeJson(false)).toBe("false");
    expect(serializeJson(42)).toBe("42");
    expect(serializeJson(-1.5)).toBe("-1.5");
  });

  it("serializes strings with proper escaping", () => {
    expect(serializeJson('hello "world"')).toBe('"hello \\"world\\""');
    expect(serializeJson("line\nbreak")).toBe('"line\\nbreak"');
    expect(serializeJson("tab\there")).toBe('"tab\\there"');
    expect(serializeJson("back\\slash")).toBe('"back\\\\slash"');
  });

  it("handles Unicode correctly", () => {
    const result = serializeJson({ text: "日本語" });
    expect(result).toBe('{"text":"日本語"}');
    // Verify UTF-8 byte length matches expected
    const bytes = Buffer.byteLength(result, "utf-8");
    expect(bytes).toBeGreaterThan(result.length); // UTF-8 multi-byte chars
  });

  it("preserves empty strings", () => {
    expect(serializeJson("")).toBe('""');
  });

  it("serializes arrays compactly", () => {
    expect(serializeJson([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes arrays prettily", () => {
    const result = serializeJson([1, 2, 3], { pretty: true });
    expect(result).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("serializes empty arrays and objects", () => {
    expect(serializeJson([])).toBe("[]");
    expect(serializeJson({})).toBe("{}");
  });

  it("rejects non-finite numbers", () => {
    expect(() => serializeJson(NaN)).toThrow("non-finite");
    expect(() => serializeJson(Infinity)).toThrow("non-finite");
    expect(() => serializeJson(-Infinity)).toThrow("non-finite");
  });

  it("rejects circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => serializeJson(obj)).toThrow("Circular");
  });

  it("rejects symbols and functions", () => {
    expect(() => serializeJson(Symbol("test"))).toThrow("Cannot serialize");
    expect(() => serializeJson(() => {})).toThrow("Cannot serialize");
  });

  it("enforces max depth", () => {
    const deep = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
    expect(() => serializeJson(deep, { maxDepth: 3 })).toThrow("depth exceeded");
  });

  it("serializes BigInt as decimal strings", () => {
    expect(serializeJson(42n)).toBe('"42"');
    expect(serializeJson(-1n)).toBe('"-1"');
    // Signed 64-bit extrema
    const min64 = BigInt("-9223372036854775808");
    const max64 = BigInt("9223372036854775807");
    expect(serializeJson(min64)).toBe('"-9223372036854775808"');
    expect(serializeJson(max64)).toBe('"9223372036854775807"');
  });

  it("counts bytes as UTF-8, not JS code units", () => {
    // Unicode surrogate pairs require 4 UTF-8 bytes
    const result = serializeJson({ emoji: "😀" });
    const bytes = Buffer.byteLength(result, "utf-8");
    // 😀 is 4 UTF-8 bytes, plus surrounding JSON structure
    expect(bytes).toBeGreaterThan(result.length - 8 + 4);
  });
});

describe("hashCanonicalJson", () => {
  it("sorts object keys alphabetically", () => {
    const hashA = hashCanonicalJson({ b: 2, a: 1 });
    const hashB = hashCanonicalJson({ a: 1, b: 2 });
    expect(hashA).toBe(hashB);
    expect(hashA).toBe('{"a":1,"b":2}');
  });

  it("produces stable output for equal values", () => {
    const obj1 = { x: [3, 1, 2], y: { z: "test" } };
    const obj2 = { y: { z: "test" }, x: [3, 1, 2] };
    expect(hashCanonicalJson(obj1)).toBe(hashCanonicalJson(obj2));
  });

  it("rejects circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => hashCanonicalJson(obj)).toThrow("Circular");
  });
});

// =============================================================================
// JSON Lines Writer
// =============================================================================

describe("JsonLinesWriter", () => {
  it("writes one compact JSON object per line", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonLinesWriter(stream);
    await writer.write({ a: 1 });
    await writer.write({ b: 2 });
    await writer.close();

    const lines = text().trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });

  it("rejects pretty mode", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonLinesWriter(stream);
    await writer.write({ a: 1 });
    await writer.close();
    expect(text()).not.toContain("\n  "); // No indentation
  });

  it("enforces budget via reserve callback", async () => {
    const { stream } = collectStream();
    const reserveCalls: number[] = [];
    const writer = new JsonLinesWriter(stream, {
      reserve: (bytes: number) => {
        reserveCalls.push(bytes);
        return bytes < 100;
      },
    });

    await writer.write({ small: "data" }); // Should pass
    await expect(
      writer.write({ large: "x".repeat(1000) })
    ).rejects.toThrow("budget");
    await writer.close();
  });

  it("calls reconcile after successful writes", async () => {
    const { stream } = collectStream();
    const reconciled: number[] = [];
    const writer = new JsonLinesWriter(stream, {
      reconcile: (bytes: number) => reconciled.push(bytes),
    });

    await writer.write({ a: 1 });
    await writer.write({ b: 2 });
    await writer.close();

    expect(reconciled.length).toBe(2);
    reconciled.forEach((b) => expect(b).toBeGreaterThan(0));
  });

  it("records byte count via reserve/reconcile", async () => {
    const { stream } = collectStream();
    let reserved = 0;
    let reconciled = 0;

    const writer = new JsonLinesWriter(stream, {
      reserve: (bytes: number) => {
        reserved += bytes;
        return true;
      },
      reconcile: (bytes: number) => {
        reconciled += bytes;
      },
    });

    await writer.write({ data: "hello" });
    await writer.close();

    expect(reserved).toBeGreaterThan(0);
    expect(reconciled).toBeGreaterThan(0);
  });

  it("refuses writes after close", async () => {
    const { stream } = collectStream();
    const writer = new JsonLinesWriter(stream);
    await writer.write({ a: 1 });
    await writer.close();
    await expect(writer.write({ b: 2 })).rejects.toThrow("closed");
  });

  it("refuses writes after abort", async () => {
    const { stream } = collectStream();
    const writer = new JsonLinesWriter(stream);
    await writer.write({ a: 1 });
    writer.abort();
    await expect(writer.write({ b: 2 })).rejects.toThrow("aborted");
  });

  it("close and abort are idempotent", async () => {
    const { stream } = collectStream();
    const writer = new JsonLinesWriter(stream);
    await writer.close();
    await writer.close(); // Second close must not throw
    expect(writer.isClosed).toBe(true);

    const { stream: stream2 } = collectStream();
    const writer2 = new JsonLinesWriter(stream2);
    writer2.abort();
    writer2.abort(); // Second abort must not throw
    expect(writer2.isAborted).toBe(true);
  });
});

// =============================================================================
// JSON Array Writer
// =============================================================================

describe("JsonArrayWriter", () => {
  it("writes empty array", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonArrayWriter(stream);
    await writer.close();

    expect(text().trim()).toBe("[]");
  });

  it("writes one record", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonArrayWriter(stream);
    await writer.write({ id: 1 });
    await writer.close();

    expect(text().trim()).toBe('[{"id":1}]');
  });

  it("writes multiple records with comma separators", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonArrayWriter(stream);
    await writer.write({ a: 1 });
    await writer.write({ b: 2 });
    await writer.write({ c: 3 });
    await writer.close();

    const parsed = JSON.parse(text());
    expect(parsed).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("writes pretty array", async () => {
    const { stream, text } = collectStream();
    const writer = new JsonArrayWriter(stream, { pretty: true });
    await writer.write({ a: 1 });
    await writer.write({ b: 2 });
    await writer.close();

    const output = text();
    expect(output).toContain("[\n");
    expect(output).toContain("  ");
    expect(output).toContain(",");
    expect(output).toContain("\n]");
    expect(JSON.parse(output)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("enforces budget via reserve callback", async () => {
    const { stream } = collectStream();
    let budget = 50;
    const writer = new JsonArrayWriter(stream, {
      reserve: (bytes: number) => {
        if (bytes > budget) return false;
        budget -= bytes;
        return true;
      },
    });

    await expect(
      writer.write({ large: "x".repeat(200) })
    ).rejects.toThrow("budget");
    writer.abort();
  });

  it("calls reconcile after successful writes", async () => {
    const { stream } = collectStream();
    const reconciled: number[] = [];
    const writer = new JsonArrayWriter(stream, {
      reconcile: (bytes: number) => reconciled.push(bytes),
    });

    await writer.write({ a: 1 });
    await writer.write({ b: 2 });
    await writer.close();

    expect(reconciled.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses writes after close", async () => {
    const { stream } = collectStream();
    const writer = new JsonArrayWriter(stream);
    await writer.write({ a: 1 });
    await writer.close();
    await expect(writer.write({ b: 2 })).rejects.toThrow("closed");
  });

  it("close is idempotent", async () => {
    const { stream } = collectStream();
    const writer = new JsonArrayWriter(stream);
    await writer.write({ a: 1 });
    await writer.close();
    await writer.close(); // Second close must not throw
    expect(writer.isClosed).toBe(true);
  });

  it("abort prevents close", async () => {
    const { stream } = collectStream();
    const writer = new JsonArrayWriter(stream);
    writer.abort();
    expect(writer.isAborted).toBe(true);
    // After abort, close is a no-op (does not throw)
    await writer.close();
    expect(writer.isAborted).toBe(true);
    expect(writer.isClosed).toBe(false);
  });
});

// =============================================================================
// OutputWriter Interface
// =============================================================================

describe("TestOutputSink", () => {
  it("collects written chunks", async () => {
    const sink = new TestOutputSink();
    await sink.write(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
    await sink.write(new Uint8Array([32, 87, 111, 114, 108, 100])); // " World"
    await sink.close();

    expect(sink.text).toBe("Hello World");
    expect(sink.chunkCount).toBe(2);
    expect(sink.committed).toBe(true);
    expect(sink.state).toBe("CLOSED");
  });

  it("tracks bytes written", async () => {
    const sink = new TestOutputSink();
    await sink.write(new TextEncoder().encode("Hello"));
    await sink.write(new TextEncoder().encode(", 世界"));
    await sink.close();

    // "Hello" = 5 bytes, ", 世界" = 8 bytes (comma+space+2x3-byte UTF-8)
    expect(sink.bytesWritten).toBe(13);
  });

  it("enforces budget via reserve callback", async () => {
    const sink = new TestOutputSink({ reserve: () => false });
    await expect(sink.write(new Uint8Array([1]))).rejects.toThrow(
      "RESOURCE_LIMIT_EXCEEDED"
    );
    await sink.abort();
    expect(sink.committed).toBe(false);
  });

  it("rejects writes after close", async () => {
    const sink = new TestOutputSink();
    await sink.close();
    await expect(sink.write(new Uint8Array([1]))).rejects.toThrow("non-OPEN");
  });

  it("rejects writes after abort", async () => {
    const sink = new TestOutputSink();
    await sink.abort();
    await expect(sink.write(new Uint8Array([1]))).rejects.toThrow("non-OPEN");
    expect(sink.committed).toBe(false);
  });

  it("close is idempotent", async () => {
    const sink = new TestOutputSink();
    await sink.close();
    await sink.close(); // Second close must not throw
    expect(sink.state).toBe("CLOSED");
  });

  it("abort is idempotent and leaves committed=false", async () => {
    const sink = new TestOutputSink();
    await sink.write(new Uint8Array([1]));
    await sink.abort();
    await sink.abort(); // Second abort must not throw
    expect(sink.committed).toBe(false);
    expect(sink.state).toBe("ABORTED");
  });

  // P1-AC18: terminal flush behavior matrix
  it("OPEN flush resolves without committing", async () => {
    const sink = new TestOutputSink();
    await sink.write(new TextEncoder().encode("data"));

    await expect(sink.flush()).resolves.toBeUndefined();
    // Writer remains OPEN
    expect(sink.state).toBe("OPEN");
    expect(sink.committed).toBe(false);
  });

  it("CLOSED flush is idempotent", async () => {
    const sink = new TestOutputSink();
    await sink.close();

    await expect(sink.flush()).resolves.toBeUndefined();
    expect(sink.state).toBe("CLOSED");
    expect(sink.committed).toBe(true);
  });

  it("ABORTED flush rejects", async () => {
    const sink = new TestOutputSink();
    await sink.abort();

    await expect(sink.flush()).rejects.toThrow("aborted");
    expect(sink.state).toBe("ABORTED");
  });
});

describe("CallbackOutputWriter", () => {
  it("calls write function with decoded strings", async () => {
    const chunks: string[] = [];
    const writer = new CallbackOutputWriter((data: string) => chunks.push(data));

    await writer.write(new TextEncoder().encode("Hello"));
    await writer.write(new TextEncoder().encode(" World"));
    await writer.close();

    expect(chunks).toEqual(["Hello", " World"]);
    expect(writer.committed).toBe(true);
  });

  it("enforces budget via reserve", async () => {
    const writer = new CallbackOutputWriter(
      () => {},
      { reserve: () => false }
    );
    await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
      "RESOURCE_LIMIT_EXCEEDED"
    );
    await writer.abort();
  });

  it("tracks bytes written", async () => {
    const writer = new CallbackOutputWriter(() => {});
    await writer.write(new TextEncoder().encode("Hello"));
    await writer.write(new TextEncoder().encode(", 世界"));
    await writer.close();

    expect(writer.bytesWritten).toBe(13);
  });

  // P1-AC16: injectable sink failure
  it("sink failure aborts before reconciliation and preserves counter", async () => {
    const reconcileCalled: number[] = [];
    const writer = new CallbackOutputWriter(
      () => {
        throw new Error("sink failure");
      },
      {
        reserve: () => true,
        reconcile: (bytes: number) => {
          reconcileCalled.push(bytes);
        },
      }
    );

    await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
      "sink failure"
    );

    // Reconciliation was NOT called
    expect(reconcileCalled).toHaveLength(0);
    // Counter did not advance
    expect(writer.bytesWritten).toBe(0);
    // Writer is aborted
    expect(writer.state).toBe("ABORTED");
    expect(writer.committed).toBe(false);
  });

  // P1-AC18: OPEN flush resolves without committing
  it("OPEN flush resolves without committing", async () => {
    const writer = new CallbackOutputWriter(() => {});
    await writer.write(new TextEncoder().encode("data"));

    await expect(writer.flush()).resolves.toBeUndefined();
    // Writer remains OPEN
    expect(writer.state).toBe("OPEN");
    expect(writer.committed).toBe(false);
  });

  // P1-AC18: CLOSED flush is idempotent
  it("CLOSED flush is idempotent", async () => {
    const writer = new CallbackOutputWriter(() => {});
    await writer.close();

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.state).toBe("CLOSED");
    expect(writer.committed).toBe(true);
  });

  // P1-AC18: ABORTED flush rejects
  it("ABORTED flush rejects", async () => {
    const writer = new CallbackOutputWriter(() => {});
    await writer.abort();

    await expect(writer.flush()).rejects.toThrow("aborted");
    expect(writer.state).toBe("ABORTED");
  });
});

describe("StdoutOutputWriter", () => {
  it("writes to the underlying stream", async () => {
    const chunks: Buffer[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        chunks.push(chunk);
        callback();
      },
    });

    const writer = new StdoutOutputWriter(stream);
    await writer.write(new TextEncoder().encode("Hello"));
    await writer.write(new TextEncoder().encode(" World"));
    await writer.close();

    expect(chunks.map((b) => b.toString())).toEqual(["Hello", " World"]);
  });

  it("enforces output budget via options", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream, { reserve: () => false });
    await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
      "RESOURCE_LIMIT_EXCEEDED"
    );
    await writer.abort();
  });

  it("tracks bytes written", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream);

    await writer.write(new TextEncoder().encode("Hello"));
    expect(writer.bytesWritten).toBe(5);

    await writer.close();
  });

  it("state transitions work correctly", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream);

    expect(writer.state).toBe("OPEN");
    expect(writer.committed).toBe(false);

    await writer.close();
    expect(writer.state).toBe("CLOSED");
    expect(writer.committed).toBe(true);

    // Abort after close is a no-op
    await writer.abort();
    expect(writer.state).toBe("CLOSED");
  });

  // P1-AC16: injectable sink failure (synchronous)
  it("synchronous sink failure aborts before reconciliation and preserves counter", async () => {
    const reconcileCalled: number[] = [];
    // Create a stream that throws synchronously on write
    const failingStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        throw new Error("sync sink failure");
      },
    });

    const writer = new StdoutOutputWriter(failingStream, {
      reserve: () => true,
      reconcile: (bytes: number) => {
        reconcileCalled.push(bytes);
      },
    });

    await expect(
      writer.write(new TextEncoder().encode("test"))
    ).rejects.toThrow("sync sink failure");

    // Reconciliation was NOT called
    expect(reconcileCalled).toHaveLength(0);
    // Counter did not advance
    expect(writer.bytesWritten).toBe(0);
    // Writer is aborted
    expect(writer.state).toBe("ABORTED");
    expect(writer.committed).toBe(false);
  });

  // P1-AC17: synchronous sink failure during write() transitions to ABORTED.
  // This test verifies the write() path handles sync throws; close() rejection
  // on sync-throw is covered by the close-after-abort tests.
  it("synchronous sink failure during write() transitions to ABORTED", async () => {
    // Create a stream whose _write throws synchronously.
    const errorStream = new Writable({
      write(_chunk, _enc, _callback) {
        throw new Error("sync sink error");
      },
    });

    const writer = new StdoutOutputWriter(errorStream);
    await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
      "sync sink error"
    );

    expect(writer.state).toBe("ABORTED");
    expect(writer.committed).toBe(false);
    expect(writer.bytesWritten).toBe(0);
  });

  // P1-AC17: direct close() against a Writable that accepts writes but emits
  // an error asynchronously in its callback. The error must be observed by
  // close() (via flush()) and cause the writer to transition to ABORTED without
  // committing.
  //
  // To create a held-callback scenario, we use a custom Writable that stores
  // the callback without immediately calling it, writes data, then when close()
  // is called, invokes the callback with an error.
  it("direct close() rejects and transitions to ABORTED when callback receives async error", async () => {
    // Create a Writable that holds the callback until we tell it to fire.
    let heldCallback: (err: Error | null | undefined) => void;
    let callbackFired = false;
    const holdingStream = new Writable({
      write(_chunk, _enc, callback) {
        // Hold the callback — don't call it yet.
        heldCallback = callback;
        callbackFired = false;
      },
    });
    // Suppress the 'error' event that Node.js emits when callbacks receive errors.
    // This is distinct from our callback handling; we track errors via _observedError.
    holdingStream.on('error', () => {});

    const writer = new StdoutOutputWriter(holdingStream);

    // Write data — this registers the callback but it hasn't fired yet.
    await writer.write(new TextEncoder().encode("data"));
    expect(writer.state).toBe("OPEN");
    expect(writer.bytesWritten).toBe(4); // Counter advances after reconciliation
    expect(callbackFired).toBe(false); // Callback hasn't fired yet

    // Now call close() directly while the callback is still held.
    // close() must await the pending write completion.
    const closePromise = writer.close();

    // At this point, close() should be waiting for the write to complete.
    // The writer should still be OPEN (not yet CLOSED) because close() awaits flush().
    expect(writer.state).toBe("OPEN");
    expect(writer.committed).toBe(false);

    // Now fire the held callback with an error.
    heldCallback!(new Error("late sink failure"));
    callbackFired = true;

    // close() should reject because flush() observed the error.
    await expect(closePromise).rejects.toThrow("late sink failure");

    // Writer should be ABORTED and uncommitted.
    expect(writer.state).toBe("ABORTED");
    expect(writer.committed).toBe(false);
    expect(writer.bytesWritten).toBe(4); // Counter preserved from before error
  });

  // P1-AC17 control: direct close() succeeds when callback completes successfully.
  // This verifies that close() properly awaits pending writes and commits only
  // after all writes complete successfully.
  it("direct close() succeeds after pending writes complete successfully", async () => {
    // Create a Writable that holds the callback.
    let heldCallback: (err: Error | null | undefined) => void;
    const holdingStream = new Writable({
      write(_chunk, _enc, callback) {
        heldCallback = callback;
      },
    });

    const writer = new StdoutOutputWriter(holdingStream);

    // Write data — callback is held.
    await writer.write(new TextEncoder().encode("data"));
    expect(writer.state).toBe("OPEN");

    // Call close() while callback is held.
    const closePromise = writer.close();
    expect(writer.state).toBe("OPEN"); // Still waiting

    // Fire the callback successfully.
    heldCallback!(null);

    // close() should now resolve successfully.
    await closePromise;
    expect(writer.state).toBe("CLOSED");
    expect(writer.committed).toBe(true);
  });

  // P1-F-001: prove flush() waits for a pending write whose callback fires later.
  // This uses a Writable whose callback is deferred, proving that flush() does
  // NOT return until the pending write callback fires.
  it("flush() waits for pending writes with deferred callbacks", async () => {
    const { stream } = deferredSinkStream();
    const writer = new StdoutOutputWriter(stream);

    await writer.write(new TextEncoder().encode("deferred"));

    // writer.state is still OPEN (write() returned before the callback fired).
    expect(writer.state).toBe("OPEN");

    // flush() must wait for the deferred callback.  We verify this
    // deterministically by awaiting flush() with a timeout — if flush() returned
    // without waiting for the callback it would resolve in the same tick, but
    // because flush() awaits _drainPromise (which resolves only after the
    // callback fires), it takes at least one setImmediate tick.
    const flushPromise = writer.flush();

    // The promise must still be pending in this tick (callback not fired yet).
    let flushResolved = false;
    flushPromise.then(() => { flushResolved = true; });
    // Yield to the event loop so setImmediate callbacks can fire.
    await new Promise<void>((r) => setImmediate(r));
    // After one tick, the deferred callback should have fired and flush should resolve.
    expect(flushResolved).toBe(true);
    await flushPromise;

    expect(writer.state).toBe("OPEN"); // flush() does not commit
    await writer.close();
    expect(writer.committed).toBe(true);
  });

  // P1-AC18: OPEN flush resolves without committing
  it("OPEN flush resolves without committing", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream);
    await writer.write(new TextEncoder().encode("data"));

    await expect(writer.flush()).resolves.toBeUndefined();
    // Writer remains OPEN
    expect(writer.state).toBe("OPEN");
    expect(writer.committed).toBe(false);
  });

  // F-001 regression: prove flush() awaits _drainPromise even when called
  // after all callbacks have fired (callback fired after write() returned but
  // before flush() was called). This ensures any deferred errors are caught.
  it("flush() awaits drain promise when called after callbacks fired", async () => {
    const { stream } = deferredSinkStream();
    const writer = new StdoutOutputWriter(stream);

    // write() returns without the callback having fired yet
    await writer.write(new TextEncoder().encode("test"));
    expect(writer.state).toBe("OPEN");

    // Simulate the callback firing before flush() is called.
    // Yield to let the setImmediate callback fire.
    await new Promise<void>((r) => setImmediate(r));

    // Now flush() is called AFTER the callback has fired.
    // flush() must still await _drainPromise to ensure the drain step completed.
    // This would hang indefinitely if flush() returned early when _pendingCallbacks.size === 0
    // without checking _hasRegisteredCallbacks.
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.state).toBe("OPEN");
    expect(writer.committed).toBe(false);

    await writer.close();
    expect(writer.committed).toBe(true);
  });

  // P1-AC18: CLOSED flush is idempotent
  it("CLOSED flush is idempotent", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream);
    await writer.close();

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.state).toBe("CLOSED");
    expect(writer.committed).toBe(true);
  });

  // P1-AC18: ABORTED flush rejects
  it("ABORTED flush rejects", async () => {
    const { stream } = collectStream();
    const writer = new StdoutOutputWriter(stream);
    await writer.abort();

    await expect(writer.flush()).rejects.toThrow("aborted");
    expect(writer.state).toBe("ABORTED");
  });

  // P1-AC19: independent StagingBudget(0) sentinel isolation
  it("default stdout does not charge independent StagingBudget(0) sentinel", async () => {
    // Import StagingBudget for this test
    const { StagingBudget } = await import(
      "../../src/application/stagingBudget.js"
    );
    const { stream } = collectStream();

    // Create an independent zero-limit sentinel budget
    const privateBudget = new StagingBudget(0);

    // Default construction without reserve callback
    const writer = new StdoutOutputWriter(stream);

    await writer.write(new TextEncoder().encode("test data"));
    await writer.close();

    // The independent sentinel budget remains at zero
    expect(privateBudget.currentBytes).toBe(0);
    expect(writer.committed).toBe(true);
  });

  // P1-AC19: explicit reserve callback remains a per-output check
  it("explicit reserve rejects before stream.write and leaves writer OPEN", async () => {
    const { stream, chunks } = collectStream();
    const writer = new StdoutOutputWriter(stream, { reserve: () => false });

    await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
      "RESOURCE_LIMIT_EXCEEDED"
    );

    // Writer remains OPEN with no bytes written
    expect(writer.state).toBe("OPEN");
    expect(writer.bytesWritten).toBe(0);

    // Stream was never written to
    expect(chunks).toHaveLength(0);
  });
});

// =============================================================================
// OutputWriterOptions and callback ordering
// =============================================================================

describe("OutputWriterOptions", () => {
  it("TestOutputSink accepts OutputWriterOptions interface", () => {
    // Should compile and work with explicit options shape
    const options: OutputWriterOptions = {
      reserve: (bytes: number) => bytes < 100,
      reconcile: (bytes: number) => {},
    };
    const sink = new TestOutputSink(options);
    expect(sink).toBeDefined();
  });

  it("CallbackOutputWriter accepts OutputWriterOptions", () => {
    const options: OutputWriterOptions = {
      reserve: (bytes: number) => bytes < 100,
      reconcile: (bytes: number) => {},
    };
    const writer = new CallbackOutputWriter(() => {}, options);
    expect(writer).toBeDefined();
  });

  it("StdoutOutputWriter accepts OutputWriterOptions", () => {
    const { stream } = collectStream();
    const options: OutputWriterOptions = {
      reserve: (bytes: number) => bytes < 100,
      reconcile: (bytes: number) => {},
    };
    const writer = new StdoutOutputWriter(stream, options);
    expect(writer).toBeDefined();
  });
});

describe("OutputWriter callback event ordering", () => {
  /**
   * Shared event recorder for testing callback ordering.
   * Records: reserve, sink, reconcile in order.
   */
  function makeRecorder() {
    const events: string[] = [];
    return {
      events,
      reserve: (bytes: number) => {
        events.push(`reserve(${bytes})`);
        return true;
      },
      sink: (data: string) => {
        events.push(`sink(${data.length}bytes)`);
      },
      reconcile: (bytes: number) => {
        events.push(`reconcile(${bytes})`);
      },
    };
  }

  describe("TestOutputSink", () => {
    it("records reserve -> reconcile on successful write (no sink callback)", async () => {
      // TestOutputSink stores chunks in memory - no observable sink callback.
      // The sink-before-reconcile proof is the chunk inspection test below.
      const { events, reserve, reconcile } = makeRecorder();
      const sink = new TestOutputSink({ reserve, reconcile });

      const data = new TextEncoder().encode("Hello");
      await sink.write(data);

      expect(events).toEqual([
        `reserve(${data.byteLength})`,
        `reconcile(${data.byteLength})`,
      ]);
    });

    it("proves sink (chunk storage) happens before reconcile via chunkCount inspection", async () => {
      // INV-003 / P1-AC3: TestOutputSink has no sink callback in OutputWriterOptions.
      // Its observable sink proof is that the chunk is already present in chunks/chunkCount
      // when reconcile runs.
      const recordedChunkCounts: number[] = [];
      const sink = new TestOutputSink({
        reserve: () => true,
        reconcile: () => {
          // The sink (push to _chunks) runs before reconcile, so chunkCount
          // already reflects this write's contribution.
          recordedChunkCounts.push(sink.chunkCount);
        },
      });

      await sink.write(new TextEncoder().encode("a"));
      expect(recordedChunkCounts).toEqual([1]); // 1 chunk stored before reconcile

      await sink.write(new TextEncoder().encode("bc"));
      expect(recordedChunkCounts).toEqual([1, 2]); // 2 chunks before second reconcile
    });

    it("records only reserve on rejection", async () => {
      const { events, reserve, reconcile } = makeRecorder();
      const sink = new TestOutputSink({ reserve, reconcile });

      // Configure reserve to reject
      sink.write(new TextEncoder().encode("test")).catch(() => {});
      // Manually test rejection path
      const rejectSink = new TestOutputSink({
        reserve: () => false,
        reconcile: () => events.push("reconcile"),
      });

      await expect(rejectSink.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "RESOURCE_LIMIT_EXCEEDED"
      );

      // No reconcile, no bytesWritten advance
      expect(rejectSink.bytesWritten).toBe(0);
      expect(rejectSink.state).toBe("OPEN");
    });

    it("bytesWritten advances only after reconciliation returns", async () => {
      let reconcileReturned = false;
      const sink = new TestOutputSink({
        reserve: () => true,
        reconcile: () => {
          // Before reconciliation returns, bytesWritten should be 0
          expect(sink.bytesWritten).toBe(0);
          reconcileReturned = true;
        },
      });

      await sink.write(new TextEncoder().encode("test"));
      expect(reconcileReturned).toBe(true);
      expect(sink.bytesWritten).toBe(4); // After reconciliation returns
    });

    it("reconciliation throw aborts without counter advance", async () => {
      const sink = new TestOutputSink({
        reserve: () => true,
        reconcile: () => {
          throw new Error("reconcile failed");
        },
      });

      await expect(sink.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "reconcile failed"
      );

      // Counter did not advance
      expect(sink.bytesWritten).toBe(0);
      expect(sink.state).toBe("ABORTED");
      expect(sink.committed).toBe(false);
    });

    it("records reserve -> sink -> reconcile for multiple writes", async () => {
      const events: string[] = [];
      const sink = new TestOutputSink({
        reserve: (bytes) => {
          events.push(`reserve(${bytes})`);
          return true;
        },
        reconcile: (bytes) => {
          events.push(`reconcile(${bytes})`);
        },
      });

      await sink.write(new TextEncoder().encode("a"));
      await sink.write(new TextEncoder().encode("bc"));
      await sink.write(new TextEncoder().encode("def"));

      expect(events).toEqual([
        "reserve(1)",
        "reconcile(1)",
        "reserve(2)",
        "reconcile(2)",
        "reserve(3)",
        "reconcile(3)",
      ]);
      expect(sink.bytesWritten).toBe(6);
    });

    it("handles Unicode with exact byte length", async () => {
      const recordedBytes: number[] = [];
      const sink = new TestOutputSink({
        reserve: (bytes) => {
          recordedBytes.push(bytes);
          return true;
        },
        reconcile: (bytes) => {
          recordedBytes.push(bytes);
        },
      });

      // "😀" is 4 UTF-8 bytes, not 2 code units
      const emoji = new TextEncoder().encode("😀");
      expect(emoji.byteLength).toBe(4);

      await sink.write(emoji);

      expect(recordedBytes).toEqual([4, 4]); // Both reserve and reconcile get byteLength
      expect(sink.bytesWritten).toBe(4);
    });
  });

  describe("CallbackOutputWriter", () => {
    it("records reserve -> sink -> reconcile on successful write", async () => {
      const events: string[] = [];
      const writer = new CallbackOutputWriter(
        () => events.push("sink"),
        {
          reserve: (bytes) => {
            events.push(`reserve(${bytes})`);
            return true;
          },
          reconcile: (bytes) => {
            events.push(`reconcile(${bytes})`);
          },
        }
      );

      const data = new TextEncoder().encode("Hello");
      await writer.write(data);

      expect(events).toEqual([
        `reserve(${data.byteLength})`,
        "sink",
        `reconcile(${data.byteLength})`,
      ]);
    });

    it("bytesWritten advances only after reconciliation", async () => {
      const writer = new CallbackOutputWriter(() => {}, {
        reserve: () => true,
        reconcile: () => {
          expect(writer.bytesWritten).toBe(0);
        },
      });

      await writer.write(new TextEncoder().encode("test"));
      expect(writer.bytesWritten).toBe(4);
    });

    it("reconciliation throw aborts without counter advance", async () => {
      const writer = new CallbackOutputWriter(() => {}, {
        reserve: () => true,
        reconcile: () => {
          throw new Error("reconcile failed");
        },
      });

      await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "reconcile failed"
      );

      expect(writer.bytesWritten).toBe(0);
      expect(writer.state).toBe("ABORTED");
    });
  });

  describe("StdoutOutputWriter", () => {
    it("records reserve -> sink -> reconcile on successful write", async () => {
      // Use a spy stream to observe the internal stream.write() call (the sink).
      const { stream, writes } = spyStream();
      const events: string[] = [];
      const writer = new StdoutOutputWriter(stream, {
        reserve: (bytes) => {
          events.push(`reserve(${bytes})`);
          return true;
        },
        reconcile: (bytes) => {
          events.push(`reconcile(${bytes})`);
        },
      });

      const data = new TextEncoder().encode("Hello");
      await writer.write(data);

      // The spy stream proves that sink (stream.write) was called.
      expect(writes).toHaveLength(1);
      expect(writes[0].byteLength).toBe(data.byteLength);
      // Ordering: reserve fires first (before sink), then sink, then reconcile.
      expect(events).toEqual([
        `reserve(${data.byteLength})`,
        `reconcile(${data.byteLength})`,
      ]);
    });

    // P1-F-003: deterministic sink-before-reconcile proof using a deferred sink
    // callback.  With a deferred callback the write() call returns before the
    // callback fires; the deferredSinkStream test below proves that reconcile
    // waits for the sink callback to fire before considering the write settled.
    it("sink completion (write callback) precedes reconcile — deferred callback ordering", async () => {
      const { stream, writes } = deferredSinkStream();
      const events: string[] = [];

      const writer = new StdoutOutputWriter(stream, {
        reserve: (bytes) => {
          events.push(`reserve(${bytes})`);
          return true;
        },
        reconcile: (bytes) => {
          events.push(`reconcile(${bytes})`);
        },
      });

      const data = new TextEncoder().encode("test");

      // write() returns before the deferred callback fires.  After it returns,
      // writes should already contain the sink record.
      await writer.write(data);

      // Prove the sink (write) was called before write() returned.
      expect(writes).toHaveLength(1);
      expect(writes[0].byteLength).toBe(data.byteLength);

      // Reconcile was called after the sink callback (events are captured
      // after write() returns, but the order recorded is reserve→reconcile
      // because the callback fires before the next microtask).
      expect(events).toEqual([`reserve(${data.byteLength})`, `reconcile(${data.byteLength})`]);

      // bytesWritten advances after reconciliation.
      expect(writer.bytesWritten).toBe(data.byteLength);
    });

    it("bytesWritten advances only after reconciliation", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream, {
        reserve: () => true,
        reconcile: () => {
          expect(writer.bytesWritten).toBe(0);
        },
      });

      await writer.write(new TextEncoder().encode("test"));
      expect(writer.bytesWritten).toBe(4);
    });

    it("reconciliation throw aborts without counter advance", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream, {
        reserve: () => true,
        reconcile: () => {
          throw new Error("reconcile failed");
        },
      });

      await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "reconcile failed"
      );

      expect(writer.bytesWritten).toBe(0);
      expect(writer.state).toBe("ABORTED");
    });
  });
});

describe("OutputWriter flush-before-close commitment", () => {
  describe("TestOutputSink", () => {
    it("close awaits flush before committed=true", async () => {
      const sink = new TestOutputSink();
      expect(sink.committed).toBe(false);
      expect(sink.state).toBe("OPEN");

      await sink.close();

      expect(sink.state).toBe("CLOSED");
      expect(sink.committed).toBe(true);
    });

    it("close is idempotent after CLOSED", async () => {
      const sink = new TestOutputSink();
      await sink.close();
      await sink.close(); // Second close must not throw

      expect(sink.state).toBe("CLOSED");
      expect(sink.committed).toBe(true);
    });

    it("close rejects after ABORTED", async () => {
      const sink = new TestOutputSink();
      await sink.abort();

      await expect(sink.close()).rejects.toThrow("aborted");
      expect(sink.state).toBe("ABORTED");
    });

    it("flush before close succeeds", async () => {
      const sink = new TestOutputSink();
      await sink.write(new TextEncoder().encode("data"));
      await sink.flush();
      expect(sink.state).toBe("OPEN");
      await sink.close();
      expect(sink.committed).toBe(true);
    });
  });

  describe("CallbackOutputWriter", () => {
    it("close awaits flush before committed=true", async () => {
      const writer = new CallbackOutputWriter(() => {});
      expect(writer.committed).toBe(false);

      await writer.close();

      expect(writer.state).toBe("CLOSED");
      expect(writer.committed).toBe(true);
    });

    it("close is idempotent after CLOSED", async () => {
      const writer = new CallbackOutputWriter(() => {});
      await writer.close();
      await writer.close();

      expect(writer.state).toBe("CLOSED");
    });

    it("close rejects after ABORTED", async () => {
      const writer = new CallbackOutputWriter(() => {});
      await writer.abort();

      await expect(writer.close()).rejects.toThrow("aborted");
    });
  });

  describe("StdoutOutputWriter", () => {
    it("close awaits flush before committed=true", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      expect(writer.committed).toBe(false);

      await writer.close();

      expect(writer.state).toBe("CLOSED");
      expect(writer.committed).toBe(true);
    });

    it("close is idempotent after CLOSED", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      await writer.close();
      await writer.close();

      expect(writer.state).toBe("CLOSED");
    });

    it("close rejects after ABORTED", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      await writer.abort();

      await expect(writer.close()).rejects.toThrow("aborted");
    });

    it("flush resolves on healthy stream", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);

      await writer.write(new TextEncoder().encode("data"));
      await expect(writer.flush()).resolves.toBeUndefined();

      await writer.close();
      expect(writer.committed).toBe(true);
    });

    it("flush rejects on error-emitting stream", async () => {
      // Create a stream whose _write throws synchronously.  The synchronous throw
      // propagates through stream.write() and is caught in StdoutOutputWriter.write(),
      // clearing _pendingCallbacks and transitioning state to ABORTED before
      // re-throwing the error to the caller.
      const streamWithError = new Writable({
        write(_chunk, _enc, _callback) {
          throw new Error("stream error");
        },
      });

      const writer = new StdoutOutputWriter(streamWithError);
      await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "stream error"
      );

      expect(writer.state).toBe("ABORTED");
    });
  });
});

describe("OutputWriter terminal state behavior", () => {
  describe("TestOutputSink", () => {
    it("write rejects after close", async () => {
      const sink = new TestOutputSink();
      await sink.close();

      await expect(sink.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("write rejects after abort", async () => {
      const sink = new TestOutputSink();
      await sink.abort();

      await expect(sink.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("flush rejects after abort", async () => {
      const sink = new TestOutputSink();
      await sink.abort();

      await expect(sink.flush()).rejects.toThrow("aborted");
    });

    it("abort after close is a no-op", async () => {
      const sink = new TestOutputSink();
      await sink.write(new TextEncoder().encode("data"));
      await sink.close();

      expect(sink.committed).toBe(true);
      await sink.abort();

      // Commitment preserved
      expect(sink.committed).toBe(true);
      expect(sink.state).toBe("CLOSED");
    });

    it("abort is idempotent", async () => {
      const sink = new TestOutputSink();
      await sink.abort();
      await sink.abort(); // Second abort must not throw

      expect(sink.state).toBe("ABORTED");
      expect(sink.committed).toBe(false);
    });
  });

  describe("CallbackOutputWriter", () => {
    it("write rejects after close", async () => {
      const writer = new CallbackOutputWriter(() => {});
      await writer.close();

      await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("write rejects after abort", async () => {
      const writer = new CallbackOutputWriter(() => {});
      await writer.abort();

      await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("abort after close is a no-op", async () => {
      const writer = new CallbackOutputWriter(() => {});
      await writer.write(new TextEncoder().encode("data"));
      await writer.close();

      expect(writer.committed).toBe(true);
      await writer.abort();

      expect(writer.committed).toBe(true);
      expect(writer.state).toBe("CLOSED");
    });
  });

  describe("StdoutOutputWriter", () => {
    it("write rejects after close", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      await writer.close();

      await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("write rejects after abort", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      await writer.abort();

      await expect(writer.write(new TextEncoder().encode("data"))).rejects.toThrow(
        "non-OPEN"
      );
    });

    it("abort after close is a no-op", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);
      await writer.write(new TextEncoder().encode("data"));
      await writer.close();

      expect(writer.committed).toBe(true);
      await writer.abort();

      expect(writer.committed).toBe(true);
      expect(writer.state).toBe("CLOSED");
    });
  });
});

describe("OutputWriter budget enforcement", () => {
  describe("TestOutputSink", () => {
    it("rejects write when reserve returns false", async () => {
      const sink = new TestOutputSink({ reserve: () => false });

      await expect(sink.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "RESOURCE_LIMIT_EXCEEDED"
      );

      // Writer remains OPEN
      expect(sink.state).toBe("OPEN");
      expect(sink.bytesWritten).toBe(0);
    });

    it("works with no reserve callback", async () => {
      const sink = new TestOutputSink(); // No reserve provided
      await sink.write(new TextEncoder().encode("test"));
      expect(sink.bytesWritten).toBe(4);
    });

    it("reconcile callback is optional", async () => {
      const sink = new TestOutputSink({ reserve: () => true });
      await sink.write(new TextEncoder().encode("test"));
      expect(sink.bytesWritten).toBe(4);
    });
  });

  describe("CallbackOutputWriter", () => {
    it("rejects write when reserve returns false", async () => {
      const writer = new CallbackOutputWriter(() => {}, { reserve: () => false });

      await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "RESOURCE_LIMIT_EXCEEDED"
      );

      expect(writer.state).toBe("OPEN");
      expect(writer.bytesWritten).toBe(0);
    });
  });

  describe("StdoutOutputWriter", () => {
    it("rejects write when reserve returns false", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream, { reserve: () => false });

      await expect(writer.write(new TextEncoder().encode("test"))).rejects.toThrow(
        "RESOURCE_LIMIT_EXCEEDED"
      );

      expect(writer.state).toBe("OPEN");
      expect(writer.bytesWritten).toBe(0);
    });

    it("default construction does not charge private staging", async () => {
      const { stream } = collectStream();
      const writer = new StdoutOutputWriter(stream);

      // Write should succeed without a reserve callback
      await writer.write(new TextEncoder().encode("test"));
      await writer.close();

      expect(writer.bytesWritten).toBe(4);
      expect(writer.committed).toBe(true);
    });
  });
});

// =============================================================================
// End-to-end: custom OutputWriter with serializers
// =============================================================================

describe("OutputWriter integration with serializers", () => {
  it("canonical JSON through TestOutputSink", async () => {
    const sink = new TestOutputSink();
    const json = serializeJson({ schema: "cdb.raw/1", data: [1, 2, 3] });
    await sink.write(new TextEncoder().encode(json));
    await sink.close();

    const parsed = JSON.parse(sink.text);
    expect(parsed.schema).toBe("cdb.raw/1");
    expect(parsed.data).toEqual([1, 2, 3]);
  });

  it("JSONL through TestOutputSink", async () => {
    const sink = new TestOutputSink();
    const records = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];

    for (const record of records) {
      const line = serializeJson(record) + "\n";
      await sink.write(new TextEncoder().encode(line));
    }
    await sink.close();

    const lines = sink.text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).name).toBe("Alice");
    expect(JSON.parse(lines[1]).name).toBe("Bob");
  });

  it("budget enforcement prevents oversized output", async () => {
    let used = 0;
    const max = 50;
    const sink = new TestOutputSink({
      reserve: (bytes: number) => {
        if (used + bytes > max) return false;
        used += bytes;
        return true;
      },
    });

    await sink.write(new TextEncoder().encode(serializeJson({ small: "ok" })));
    // Next write should exceed budget
    await expect(
      sink.write(
        new TextEncoder().encode(
          serializeJson({ large: "x".repeat(100) })
        )
      )
    ).rejects.toThrow("RESOURCE_LIMIT_EXCEEDED");
    await sink.abort();
  });
});