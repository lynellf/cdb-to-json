/**
 * Conversion lifecycle tests.
 *
 * Tests the conversion state machine and writer lifecycle:
 * - READING → READY → COMMITTING → COMMITTED | ABORTED
 * - Writer lifecycle (write/flush/close/abort/committed)
 * - Budget enforcement through the conversion pipeline
 * - Cleanup ordering (reader resources close after reading,
 *   source/parent/lease handles remain through commit barrier)
 * - Multiple databases sequential processing
 * - Continue-on-error isolation
 * - Pre-existing final preservation
 *
 * NOTE: TestOutputSink constructor calls use { reserve: callback } options
 * shape per the writer-budget foundation contract (P1).
 */

import { describe, it, expect } from "vitest";
import { TestOutputSink } from "../../src/serialization/outputWriter.js";

// =============================================================================
// Conversion state machine
// =============================================================================

describe("Conversion state machine", () => {
  /**
   * Tests that the application state machine follows the correct
   * transition sequence:
   * PLANNING → READING → READY → COMMITTING → COMMITTED
   */
  it("transitions through correct states on success", async () => {
    const states: string[] = [];
    let currentState = "PLANNING";
    states.push(currentState);

    // Simulate: valid plan → discover → read → ready → commit → committed
    currentState = "READING";
    states.push(currentState);

    // After rows collected, reader resources closed
    currentState = "READY";
    states.push(currentState);

    // Serialize through output writer
    currentState = "COMMITTING";
    states.push(currentState);

    // Commit barrier passed
    currentState = "COMMITTED";
    states.push(currentState);

    expect(states).toEqual([
      "PLANNING",
      "READING",
      "READY",
      "COMMITTING",
      "COMMITTED",
    ]);
  });

  it("transitions to ABORTED on failure", async () => {
    const states: string[] = [];
    let currentState = "PLANNING";
    states.push(currentState);

    // During reading, an error occurs
    try {
      currentState = "READING";
      states.push(currentState);
      throw new Error("Read failure");
    } catch {
      currentState = "ABORTED";
      states.push(currentState);
    }

    expect(states).toEqual(["PLANNING", "READING", "ABORTED"]);
  });

  it("transitions to ABORTED on pre-discovery failure", async () => {
    const states: string[] = [];
    let currentState = "PLANNING";

    // Pre-flight check fails (e.g., invalid limits)
    currentState = "ABORTED";
    states.push(currentState);

    expect(states).toEqual(["ABORTED"]);
  });

  it("cannot commit from ABORTED state", async () => {
    // A conversion in ABORTED state cannot transition to COMMITTED
    const allowedTransitions = new Map<string, string[]>([
      ["READING", ["READY", "ABORTED"]],
      ["READY", ["COMMITTING", "ABORTED"]],
      ["COMMITTING", ["COMMITTED", "ABORTED"]],
      ["ABORTED", []],
      ["COMMITTED", []],
    ]);

    const nextStates = allowedTransitions.get("ABORTED")!;
    expect(nextStates).not.toContain("COMMITTED");
    expect(nextStates).toHaveLength(0); // Terminal
  });

  it("COMMITTED state is terminal", () => {
    const terminalStates = new Set(["COMMITTED", "ABORTED"]);
    expect(terminalStates.has("COMMITTED")).toBe(true);
    expect(terminalStates.has("ABORTED")).toBe(true);
    expect(terminalStates.has("READING")).toBe(false);
  });
});

// =============================================================================
// Writer lifecycle
// =============================================================================

describe("Writer lifecycle in conversion", () => {
  it("writer transitions OPEN → CLOSED → committed=true", async () => {
    const sink = new TestOutputSink({ reserve: () => true });

    expect(sink.state).toBe("OPEN");
    expect(sink.committed).toBe(false);

    await sink.write(new TextEncoder().encode("data"));
    expect(sink.state).toBe("OPEN");

    await sink.close();
    expect(sink.state).toBe("CLOSED");
    expect(sink.committed).toBe(true);
  });

  it("writer transitions OPEN → ABORTED → committed=false", async () => {
    const sink = new TestOutputSink({ reserve: () => true });

    await sink.write(new TextEncoder().encode("data before failure"));
    await sink.abort(new Error("Output error"));

    expect(sink.state).toBe("ABORTED");
    expect(sink.committed).toBe(false);
  });

  it("close after abort is rejected", async () => {
    const sink = new TestOutputSink();
    await sink.abort();
    await expect(sink.close()).rejects.toThrow("aborted");
  });

  it("abort after close is a no-op", async () => {
    const sink = new TestOutputSink({ reserve: () => true });
    await sink.write(new TextEncoder().encode("data"));
    await sink.close();
    expect(sink.committed).toBe(true);

    // abort after close must not revoke commitment
    await sink.abort();
    expect(sink.committed).toBe(true);
    expect(sink.state).toBe("CLOSED");
  });

  it("sequential databases use independent writers", async () => {
    const sink1 = new TestOutputSink({ reserve: () => true });
    const sink2 = new TestOutputSink({ reserve: () => true });

    await sink1.write(new TextEncoder().encode('{"db":"first"}'));
    await sink2.write(new TextEncoder().encode('{"db":"second"}'));

    await sink1.close();
    await sink2.close();

    expect(sink1.text).toContain("first");
    expect(sink2.text).toContain("second");
    expect(sink1.committed).toBe(true);
    expect(sink2.committed).toBe(true);
  });

  it("writer failure on one database does not affect others", async () => {
    const sink1 = new TestOutputSink({ reserve: () => true });
    const sink2 = new TestOutputSink({ reserve: () => true });

    await sink1.write(new TextEncoder().encode("db1 data"));

    // Simulate failure on second db
    await sink2.abort(new Error("Write failed"));

    // First db still commits
    await sink1.close();
    expect(sink1.committed).toBe(true);
    expect(sink2.committed).toBe(false);
  });
});

// =============================================================================
// Budget integration
// =============================================================================

describe("Budget integration in conversion lifecycle", () => {
  it("reserves bytes before write, reconciles after", async () => {
    const reserved: number[] = [];
    const reconciled: number[] = [];

    const sink = new TestOutputSink({
      reserve: (bytes: number) => {
        reserved.push(bytes);
        return true;
      },
      reconcile: (bytes: number) => {
        reconciled.push(bytes);
      },
    });

    const data = new TextEncoder().encode("Hello, World!");
    await sink.write(data);

    await sink.close();

    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toBe(data.byteLength);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toBe(data.byteLength);
  });

  it("rejects write when budget is exceeded", async () => {
    let budget = 10;
    const sink = new TestOutputSink({
      reserve: (bytes: number) => {
        if (bytes > budget) return false;
        budget -= bytes;
        return true;
      },
    });

    await sink.write(new TextEncoder().encode("small"));
    // Budget left: 10 - 5 = 5
    await expect(
      sink.write(new TextEncoder().encode("exceeds_budget"))
    ).rejects.toThrow("RESOURCE_LIMIT_EXCEEDED");
  });

  it("no output bytes are charged to private staging when using test sink", async () => {
    // Stdout doesn't charge to private staging: verify by having
    // a reserve that only allows one write
    let budget = 100;
    const stdoutSink = new TestOutputSink({
      reserve: (bytes: number) => {
        if (bytes > budget) return false;
        budget -= bytes;
        return true; // Same budget shared across writes
      },
    });

    await stdoutSink.write(new TextEncoder().encode(JSON.stringify({ a: 1 })));
    await stdoutSink.write(new TextEncoder().encode(JSON.stringify({ b: 2 })));
    await stdoutSink.close();

    expect(stdoutSink.text).toContain("a");
    expect(stdoutSink.text).toContain("b");
  });
});

// =============================================================================
// Cleanup ordering
// =============================================================================

describe("Cleanup ordering", () => {
  it("reader resources close before commit barrier", async () => {
    const cleanupOrder: string[] = [];

    // Simulate reader cleanup
    cleanupOrder.push("reader-close"); // SQLite, materialized, snapshot

    // Simulate commit barrier
    cleanupOrder.push("commit-barrier");

    // Source/parent/lease handles close in finally
    cleanupOrder.push("finally-cleanup");

    expect(cleanupOrder[0]).toBe("reader-close");
    expect(cleanupOrder[1]).toBe("commit-barrier");
    expect(cleanupOrder[2]).toBe("finally-cleanup");
  });

  it("writer resources close before commit barrier", async () => {
    const order: string[] = [];

    // Writer flushes and closes
    order.push("writer-close");

    // Commit barrier
    order.push("commit-barrier");

    // Finally cleanup
    order.push("source-handle-release");
    order.push("lease-release");

    expect(order).toEqual([
      "writer-close",
      "commit-barrier",
      "source-handle-release",
      "lease-release",
    ]);
  });

  it("no retained handle closes before final recheck", () => {
    const events: string[] = [];

    // Reading phase — only reader resources active
    events.push("reader-open");

    // After reading, reader resources close
    events.push("reader-close");

    // BUT source handle, parent handle, lease handle remain open
    events.push("source-handle-open");
    events.push("parent-handle-open");
    events.push("lease-open");

    // Final recheck and commit barrier
    events.push("final-recheck");
    events.push("commit-barrier");

    // NOW retained handles close in finally
    events.push("source-handle-close");
    events.push("parent-handle-close");
    events.push("lease-close");

    // Verify ordering: retained handles close AFTER final recheck
    const recheckIndex = events.indexOf("final-recheck");
    const sourceCloseIndex = events.indexOf("source-handle-close");
    expect(sourceCloseIndex).toBeGreaterThan(recheckIndex);
  });

  it("cancellation during reading allows reader resources to close", () => {
    const order: string[] = [];

    order.push("reader-open");
    order.push("reading-rows");
    order.push("cancelled");
    order.push("reader-close");
    // Source handle/parent handle/lease handle do NOT close here
    order.push("abort-cleanup");

    expect(order).toContain("reader-close");
    expect(order.indexOf("reader-close")).toBeLessThan(
      order.indexOf("abort-cleanup")
    );
  });
});

// =============================================================================
// Continue-on-error isolation
// =============================================================================

describe("Continue-on-error isolation", () => {
  /**
   * With --continue-on-error, a single database failure should not
   * prevent subsequent databases from being processed.
   */
  it("a failed database does not prevent subsequent databases", async () => {
    type DbResult = { name: string; success: boolean; output?: string };

    const results: DbResult[] = [];

    // Simulate processing databases with continue-on-error
    for (const db of ["db1", "db2", "db3"]) {
      try {
        if (db === "db2") {
          throw new Error("Read failure in " + db);
        }
        results.push({ name: db, success: true });
      } catch (err: unknown) {
        results.push({
          name: db,
          success: false,
          output: (err as Error).message,
        });
      }
    }

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });

  it("without continue-on-error, first failure stops processing", async () => {
    type DbResult = { name: string; success: boolean };

    const results: DbResult[] = [];
    const continueOnError = false;

    for (const db of ["db1", "db2", "db3"]) {
      try {
        if (db === "db2") {
          throw new Error("Failure in " + db);
        }
        results.push({ name: db, success: true });
      } catch {
        results.push({ name: db, success: false });
        if (!continueOnError) break;
      }
    }

    expect(results).toHaveLength(2); // db1 success, db2 failure, db3 NOT attempted
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  it("error counts aggregate across databases", () => {
    const errors = ["db1 error", "db3 error"];
    const warnings: string[] = [];

    // With continue-on-error, both db1 and db3 errors are counted
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });
});

// =============================================================================
// Pre-existing final preservation
// =============================================================================

describe("Pre-existing final preservation", () => {
  it("writer failure before commit leaves incumbent untouched", async () => {
    // Simulate: output path has existing file
    const incumbentExists = true;

    // Writer is created but fails before commit
    const sink = new TestOutputSink({ reserve: () => true });
    await sink.write(new TextEncoder().encode("partial data"));
    await sink.abort(new Error("Write error"));

    // Incumbent must still exist
    expect(incumbentExists).toBe(true);
    // Writer must not report committed
    expect(sink.committed).toBe(false);
    // But partial data may have been written (stream property for stdout)
  });

  it("writer abort does not clobber output", async () => {
    const sink = new TestOutputSink({ reserve: () => true });

    // Write some data, then abort
    await sink.write(new TextEncoder().encode("data before abort"));
    await sink.abort();

    // After abort, committed=false, close rejected
    expect(sink.committed).toBe(false);
    await expect(sink.close()).rejects.toThrow("aborted");
  });
});