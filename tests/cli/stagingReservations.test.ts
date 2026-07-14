/**
 * Staging reservation tests.
 *
 * Tests the StagingBudget tracker and end-to-end reservation/reconciliation
 * behavior for snapshot bundles, materialized databases, output staging,
 * and temporary files.
 *
 * Key behaviors:
 * - Reserve before growth, reconcile actual, release exactly once
 * - Aggregate budget protects against over-commit
 * - Stdout does NOT charge encoded chunks to private staging budget
 * - Unique reservation paths prevent reuse/stale releases
 * - Duplicate active keys are rejected
 * - Non-positive reservations are no-ops
 * - reconcile() returns boolean: true for accepted, false for over-limit
 */

import { describe, it, expect } from "vitest";
import { StagingBudget } from "../../src/application/stagingBudget.js";
import { DiagnosticCollector } from "../../src/diagnostics/collector.js";

describe("StagingBudget", () => {
  it("accepts reservations within budget", () => {
    const budget = new StagingBudget(1000);
    expect(budget.reserve("snapshot/main.cdb", 500)).toBe(true);
    expect(budget.currentBytes).toBe(500);
    expect(budget.remainingBytes).toBe(500);
  });

  it("rejects reservations that exceed budget", () => {
    const budget = new StagingBudget(100);
    expect(budget.reserve("snapshot/main.cdb", 60)).toBe(true);
    expect(budget.reserve("materialized/main.db", 60)).toBe(false);
    expect(budget.currentBytes).toBe(60);
  });

  it("releases bytes and makes them available", () => {
    const budget = new StagingBudget(100);
    budget.reserve("a", 60);
    budget.reserve("b", 30);
    expect(budget.remainingBytes).toBe(10);

    budget.release("a");
    expect(budget.remainingBytes).toBe(70);
    expect(budget.reserve("c", 70)).toBe(true);
  });

  it("handles zero-byte reservation", () => {
    const budget = new StagingBudget(100);
    expect(budget.reserve("zero", 0)).toBe(true);
    expect(budget.currentBytes).toBe(0);
  });

  it("handles negative byte request as true (no-op)", () => {
    const budget = new StagingBudget(100);
    expect(budget.reserve("neg", -1)).toBe(true);
    expect(budget.currentBytes).toBe(0);
  });

  it("reconcile returns true on success", () => {
    const budget = new StagingBudget(100);
    budget.reserve("file", 30);

    const result = budget.reconcile("file", 25);
    expect(result).toBe(true);
    expect(budget.currentBytes).toBe(25);
  });

  it("reconcile adjusts reserved bytes for actual growth", () => {
    const budget = new StagingBudget(100);

    // Reserve 30, actual is 25
    budget.reserve("file", 30);
    budget.reconcile("file", 25);
    expect(budget.currentBytes).toBe(25);

    // Reserve another 50, actual is 40
    budget.reserve("file2", 50);
    budget.reconcile("file2", 40);
    expect(budget.currentBytes).toBe(65);
  });

  it("reconcile adds extra bytes when actual exceeds reserved", () => {
    const budget = new StagingBudget(100);

    budget.reserve("file", 20);
    budget.reconcile("file", 35); // actual > reserved
    expect(budget.currentBytes).toBe(35);
  });

  it("reconcile returns false on over-limit with prior accounting preserved", () => {
    const collector = new DiagnosticCollector();
    const budget = new StagingBudget(100, collector);

    budget.reserve("file", 80);
    budget.reconcile("file", 80);
    expect(budget.currentBytes).toBe(80);

    // Try to reconcile with bytes that would exceed limit
    const result = budget.reconcile("file", 50); // Would be 80 - 80 + 50 = 50, but diff = 50 - 80 = -30 => 80 - 30 = 50... wait
    // Actually: currentBytes=80, entry.actualBytes=80, reconciled=true
    // New diff = 50 - 80 = -30, newTotal = 80 + (-30) = 50 <= 100, should pass

    // Let me redo this test
    budget.release("file");
    expect(budget.currentBytes).toBe(0);

    // Now test: reserve 80, reconcile to 80, then try to grow by 30 (would be -50 delta)
    budget.reserve("file", 80);
    budget.reconcile("file", 80);
    expect(budget.currentBytes).toBe(80);

    // Now add another reservation
    budget.reserve("file2", 15);
    expect(budget.currentBytes).toBe(95);

    // Try to grow file by 20 more (would be 80 - 80 + 20 = 20 delta, total 95 + 20 = 115 > 100)
    const result2 = budget.reconcile("file", 100);
    expect(result2).toBe(false);
    // Prior accounting preserved
    expect(budget.currentBytes).toBe(95);
    expect(collector.getSummary().errors.some(e => e.code === "RESOURCE_LIMIT_EXCEEDED")).toBe(true);
  });

  it("reconcile returns false and preserves accounting on over-limit", () => {
    const collector = new DiagnosticCollector();
    const budget = new StagingBudget(100, collector);

    // Reserve 60
    budget.reserve("a", 60);
    expect(budget.currentBytes).toBe(60);

    // Try to reserve another 60 (would be 120 > 100)
    expect(budget.reserve("b", 60)).toBe(false);
    expect(budget.currentBytes).toBe(60); // Prior accounting preserved

    // Now try to grow "a" beyond the limit
    // currentBytes=60, entry.actual=0, reconciled=false
    // Try reconcile to 80: diff = 80 - 60 = 20, newTotal = 60 + 20 = 80 <= 100
    const result = budget.reconcile("a", 80);
    expect(result).toBe(true);
    expect(budget.currentBytes).toBe(80);

    // Now try to grow "a" by 30 more (would be 80 - 80 + 30 = 30, total 80 + 30 = 110 > 100)
    // entry.actualBytes=80, reconciled=true
    // diff = 110 - 80 = 30, newTotal = 80 + 30 = 110 > 100
    const result2 = budget.reconcile("a", 110);
    expect(result2).toBe(false);
    expect(budget.currentBytes).toBe(80); // Prior accounting preserved

    const summary = collector.getSummary();
    expect(summary.errors.some(e => e.code === "RESOURCE_LIMIT_EXCEEDED")).toBe(true);
  });

  it("reconcile on unknown path returns true (no-op)", () => {
    const budget = new StagingBudget(100);
    const result = budget.reconcile("unknown", 50);
    expect(result).toBe(true);
    expect(budget.currentBytes).toBe(0);
  });

  it("reconcile to zero is valid after positive reservation", () => {
    const budget = new StagingBudget(100);
    budget.reserve("file", 30);
    expect(budget.currentBytes).toBe(30);

    // Reconcile to 0 (file became empty)
    const result = budget.reconcile("file", 0);
    expect(result).toBe(true);
    expect(budget.currentBytes).toBe(0); // 30 - 30 = 0
  });

  it("duplicate active key is rejected", () => {
    const budget = new StagingBudget(100);
    expect(budget.reserve("file", 30)).toBe(true);
    expect(budget.currentBytes).toBe(30);

    // Duplicate should be rejected, original preserved
    expect(budget.reserve("file", 50)).toBe(false);
    expect(budget.currentBytes).toBe(30); // Original preserved

    // Can still release the original
    budget.release("file");
    expect(budget.currentBytes).toBe(0);
  });

  it("duplicate non-positive after positive is rejected", () => {
    const budget = new StagingBudget(100);
    expect(budget.reserve("file", 30)).toBe(true);
    expect(budget.currentBytes).toBe(30);

    // Duplicate non-positive should be rejected
    expect(budget.reserve("file", 0)).toBe(false);
    expect(budget.currentBytes).toBe(30); // Original preserved

    expect(budget.reserve("file", -10)).toBe(false);
    expect(budget.currentBytes).toBe(30); // Original preserved
  });

  it("release on unknown path is a no-op", () => {
    const budget = new StagingBudget(100);
    budget.reserve("known", 50);
    budget.release("unknown");
    expect(budget.currentBytes).toBe(50);
  });

  it("canReserve checks without committing", () => {
    const budget = new StagingBudget(100);
    budget.reserve("a", 60);

    expect(budget.canReserve(30)).toBe(true); // 60 + 30 = 90 <= 100
    expect(budget.canReserve(50)).toBe(false); // 60 + 50 = 110 > 100
    expect(budget.currentBytes).toBe(60); // reserve not committed
  });

  it("diagnostics are emitted on budget exceeded", () => {
    const collector = new DiagnosticCollector();
    const budget = new StagingBudget(50, collector);

    budget.reserve("a", 50);
    const result = budget.reserve("b", 10);

    expect(result).toBe(false);
    const summary = collector.getSummary();
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(summary.errors[0].code).toBe("RESOURCE_LIMIT_EXCEEDED");
  });

  it("release is idempotent on same path", () => {
    const budget = new StagingBudget(100);
    budget.reserve("path", 50);
    budget.release("path");
    budget.release("path"); // Second release must not throw or double-count
    expect(budget.currentBytes).toBe(0);
    expect(budget.remainingBytes).toBe(100);
  });

  it("repeated reconcile uses latest actual", () => {
    const budget = new StagingBudget(200);
    budget.reserve("file", 100);
    budget.reconcile("file", 80); // diff = 80 - 100 = -20, total = 100 - 20 = 80
    expect(budget.currentBytes).toBe(80);

    budget.reconcile("file", 60); // diff = 60 - 80 = -20, total = 80 - 20 = 60
    expect(budget.currentBytes).toBe(60);

    budget.reconcile("file", 90); // diff = 90 - 60 = 30, total = 60 + 30 = 90
    expect(budget.currentBytes).toBe(90);
  });
});

// =============================================================================
// End-to-end: staging budget lifecycle
// =============================================================================

describe("Staging budget lifecycle", () => {
  it("reserve → reconcile → release on snapshot member", () => {
    const budget = new StagingBudget(2000);

    // 1. Reserve before copying snapshot member
    expect(budget.reserve("snapshot/main.cdb", 800)).toBe(true);
    expect(budget.currentBytes).toBe(800);

    // 2. Reserve WAL member
    expect(budget.reserve("snapshot/main.cdb-wal", 200)).toBe(true);
    expect(budget.currentBytes).toBe(1000);

    // 3. Reconcile actual sizes
    budget.reconcile("snapshot/main.cdb", 780);
    budget.reconcile("snapshot/main.cdb-wal", 190);
    expect(budget.currentBytes).toBe(970);

    // 4. Reserve materialized output
    expect(budget.reserve("materialized/output.db", 500)).toBe(true);
    expect(budget.currentBytes).toBe(1470);

    // 5. Reconcile materialized
    budget.reconcile("materialized/output.db", 480);
    expect(budget.currentBytes).toBe(1450);

    // 6. Release snapshot members after materialization
    budget.release("snapshot/main.cdb");
    budget.release("snapshot/main.cdb-wal");
    expect(budget.currentBytes).toBe(480);

    // 7. Release materialized after reading
    budget.release("materialized/output.db");
    expect(budget.currentBytes).toBe(0);
  });

  it("multiple concurrent reservations are tracked independently", () => {
    const budget = new StagingBudget(500);

    budget.reserve("snapshot/a", 100);
    budget.reserve("snapshot/b", 100);
    budget.reserve("output/c", 100);

    expect(budget.currentBytes).toBe(300);
    expect(budget.remainingBytes).toBe(200);

    // Release one
    budget.release("snapshot/a");
    expect(budget.currentBytes).toBe(200);
    expect(budget.remainingBytes).toBe(300);
  });

  it("full lifecycle with snapshot, materialization, and output", () => {
    const budget = new StagingBudget(5000);
    const collector = new DiagnosticCollector();

    // Phase: Snapshot bundle copy
    expect(budget.reserve("snap/main", 1000)).toBe(true);
    budget.reconcile("snap/main", 950);
    expect(budget.reserve("snap/wal", 500)).toBe(true);
    budget.reconcile("snap/wal", 480);
    expect(budget.currentBytes).toBe(1430);

    // Phase: Materialization
    expect(budget.reserve("materialized", 800)).toBe(true);
    budget.reconcile("materialized", 790);
    expect(budget.currentBytes).toBe(2220);

    // Release snapshot after materialization
    budget.release("snap/main");
    budget.release("snap/wal");
    expect(budget.currentBytes).toBe(790);

    // Phase: Output staging
    expect(budget.reserve("output/stage", 1200)).toBe(true);
    budget.reconcile("output/stage", 1150);
    expect(budget.currentBytes).toBe(1940);

    // Release materialized after reading
    budget.release("materialized");
    expect(budget.currentBytes).toBe(1150);

    // Release output after commit
    budget.release("output/stage");
    expect(budget.currentBytes).toBe(0);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe("Staging budget edge cases", () => {
  it("zero maxStagingBytes rejects all reservations", () => {
    const budget = new StagingBudget(0);
    expect(budget.reserve("any", 1)).toBe(false);
    expect(budget.currentBytes).toBe(0);
  });

  it("very large budget accepts large reservations", () => {
    const budget = new StagingBudget(Number.MAX_SAFE_INTEGER);
    expect(budget.reserve("big", 1_000_000_000)).toBe(true);
    expect(budget.currentBytes).toBe(1_000_000_000);
  });

  it("release all then reuse paths", () => {
    const budget = new StagingBudget(100);

    budget.reserve("path", 50);
    budget.release("path");

    expect(budget.reserve("path", 50)).toBe(true);
    budget.release("path");
    expect(budget.currentBytes).toBe(0);
  });

  it("reconcile on unreleased path adjusts correctly", () => {
    const budget = new StagingBudget(100);

    budget.reserve("file", 30);
    budget.reconcile("file", 30); // exact match
    expect(budget.currentBytes).toBe(30);

    budget.reconcile("file", 50); // growth
    expect(budget.currentBytes).toBe(50);

    budget.release("file");
    expect(budget.currentBytes).toBe(0);
  });

  it("unique reservation handles don't overlap", () => {
    const budget = new StagingBudget(100);

    // Using different paths for logically distinct items
    budget.reserve("reader/snap/1", 40);
    budget.reserve("reader/snap/2", 40);
    expect(budget.reserve("reader/snap/3", 40)).toBe(false);

    budget.release("reader/snap/1");
    expect(budget.reserve("reader/snap/3", 40)).toBe(true);
  });
});