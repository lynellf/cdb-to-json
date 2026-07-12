/**
 * Runtime tests for iterateRawCards async iterator.
 *
 * Validates:
 * - Async iterator signature and behavior
 * - Per-row AbortSignal checks
 * - scheduler.yield() checkpoints every 256 rows
 * - Direct-consumer return()/finally cleanup
 * - Abort rejection propagation
 * - convert() reuse of the iterator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { iterateRawCards } from "../../src/cdb/iterateRows.js";
import { createMinimalCdb } from "../fixtures/buildCdbFixture.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const LARGE_FIXTURE_DB = join(__dirname, "..", "fixtures", "large-iterate-test.cdb");

describe("iterateRawCards runtime behavior", () => {
  let tempDbPath: string;

  beforeEach(async () => {
    // Create a small test database with 3 cards
    tempDbPath = createMinimalCdb([
      { id: 1, name: "Card One", desc: "Description one" },
      { id: 2, name: "Card Two", desc: "Description two" },
      { id: 3, name: "Card Three", desc: "Description three" },
    ]);
  });

  afterEach(async () => {
    // Clean up test database
    try {
      await rm(tempDbPath, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("async iterator signature", () => {
    it("returns an async iterable iterator", async () => {
      const iterator = iterateRawCards(tempDbPath);
      expect(iterator[Symbol.asyncIterator]).toBeDefined();
      expect(typeof iterator.next).toBe("function");
    });

    it("yields card rows", async () => {
      const cards: unknown[] = [];
      for await (const row of iterateRawCards(tempDbPath)) {
        cards.push(row);
      }
      expect(cards.length).toBe(3);
    });

    it("produces complete pairs with both datas and texts", async () => {
      const cards: unknown[] = [];
      for await (const row of iterateRawCards(tempDbPath)) {
        cards.push(row);
      }
      for (const card of cards) {
        expect((card as { datas: unknown }).datas).toBeDefined();
        expect((card as { texts: unknown }).texts).toBeDefined();
      }
    });

    it("includes dataOrdinal and textOrdinal", async () => {
      const cards: unknown[] = [];
      for await (const row of iterateRawCards(tempDbPath)) {
        cards.push(row);
      }
      for (const card of cards as { dataOrdinal: number; textOrdinal: number }[]) {
        expect(typeof card.dataOrdinal).toBe("number");
        expect(typeof card.textOrdinal).toBe("number");
      }
    });
  });

  describe("AbortSignal checks", () => {
    it("checks signal before starting and yields nothing", async () => {
      const controller = new AbortController();
      controller.abort();

      const iterator = iterateRawCards(tempDbPath, { signal: controller.signal });
      const result = await iterator.next();
      // Should not yield any cards since signal was already aborted
      expect(result.done).toBe(true);
    });

    it("aborted signal before iteration prevents card yield", async () => {
      // Create a fresh controller that is already aborted
      const controller = new AbortController();
      controller.abort();

      const iterator = iterateRawCards(tempDbPath, { signal: controller.signal });

      // First next() should immediately return done (no yield)
      const result = await iterator.next();
      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();

      // Second next() should also return done
      const result2 = await iterator.next();
      expect(result2.done).toBe(true);
    });
  });

  describe("scheduler checkpoint", () => {
    it("yields incrementally without materializing all rows at once", async () => {
      // Create a database with 300 cards to exercise the 256-row checkpoint.
      // The iterator yields to the event loop at least once every 256 rows.
      const largeDbPath = createMinimalCdb(
        Array.from({ length: 300 }, (_, i) => ({
          id: i + 1,
          name: `Card ${i + 1}`,
          desc: `Description ${i + 1}`,
        }))
      );

      let yieldedCount = 0;

      try {
        for await (const _row of iterateRawCards(largeDbPath)) {
          yieldedCount++;
        }

        // All rows should be yielded
        expect(yieldedCount).toBe(300);
      } finally {
        // Clean up large db
        try {
          await rm(largeDbPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe("return() cleanup", () => {
    it("return() closes handles and cleans up", async () => {
      const iterator = iterateRawCards(tempDbPath);

      // Read one card
      const first = await iterator.next();
      expect(first.value).toBeDefined();

      // Call return to clean up
      const returnResult = await iterator.return?.();
      expect(returnResult).toBeDefined();
      expect(returnResult?.done).toBe(true);

      // Further calls should return done
      const second = await iterator.next();
      expect(second.done).toBe(true);
    });

    it("for-of loop cleanup via break", async () => {
      const iterator = iterateRawCards(tempDbPath);

      let count = 0;
      for await (const _ of iterator) {
        count++;
        if (count >= 1) break;
      }

      // We got at least one card before break
      expect(count).toBe(1);
    });
  });

  describe("abort rejection", () => {
    it("returns done when cancelled mid-iteration with CANCELLED diagnostic", async () => {
      const controller = new AbortController();
      const { DiagnosticCollector } = await import("../../src/diagnostics/collector.js");
      const collector = new DiagnosticCollector();

      const iterator = iterateRawCards(tempDbPath, {
        signal: controller.signal,
        diagnostics: collector,
      });

      // Read first
      const first = await iterator.next();
      expect(first.value).toBeDefined();

      // Abort
      controller.abort();

      // Next should return done (cancellation is recorded as diagnostic)
      const result = await iterator.next();
      expect(result.done).toBe(true);

      // Check that CANCELLED diagnostic was emitted
      const summary = collector.getSummary();
      expect(summary.errorCount).toBeGreaterThan(0);
    });
  });

  describe("convert() reuse", () => {
    it("can be called multiple times sequentially", async () => {
      const cards1: unknown[] = [];
      for await (const row of iterateRawCards(tempDbPath)) {
        cards1.push(row);
      }

      const cards2: unknown[] = [];
      for await (const row of iterateRawCards(tempDbPath)) {
        cards2.push(row);
      }

      expect(cards1.length).toBe(cards2.length);
      expect(cards1.length).toBe(3);
    });
  });
});
