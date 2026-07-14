/**
 * Tests for limit relation validation.
 *
 * Validates:
 * - Zero/equal/less/greater relation vectors before discovery/open
 * - INVALID_LIMIT_RELATION exit code 2
 * - Pre-open behavior: validateLimitRelations runs before any input access
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Writable } from "node:stream";
import { getDefaultLimits, validateLimitRelations, type LimitRelationResult } from "../../dist/application/types.js";
import { computeExitCode, ExitCode } from "../../dist/cli/exitCodes.js";
import { main } from "../../dist/cli.js";

describe("Limit Relations", () => {
  describe("validateLimitRelations", () => {
    it("accepts valid limit relations", () => {
      const limits = getDefaultLimits();
      const result = validateLimitRelations(limits);
      // Returns { valid: true } if limits are consistent
      expect(result.valid).toBe(true);
    });

    it("rejects when maxSpoolBytes exceeds maxStagingBytes with INVALID_LIMIT_RELATION", () => {
      const limits = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 2000,
      };
      const result = validateLimitRelations(limits);
      // Returns { valid: false, code: "INVALID_LIMIT_RELATION" }
      expect(result.valid).toBe(false);
      const r = result as Extract<LimitRelationResult, { valid: false }>;
      expect(r.code).toBe("INVALID_LIMIT_RELATION");
      expect(r.message).toContain("maxSpoolBytes");
    });

    it("rejects when maxSnapshotBytes exceeds maxStagingBytes with INVALID_LIMIT_RELATION", () => {
      const limits: Parameters<typeof validateLimitRelations>[0] = {
        maxRowsPerTable: 1000,
        maxTextBytes: 1000,
        maxOutputBytes: 1000,
        maxStagingBytes: 1000,
        maxSpoolBytes: 500, // Under limit
        maxSnapshotBytes: 2000, // Over limit
      };
      const result = validateLimitRelations(limits);
      expect(result.valid).toBe(false);
      const r = result as Extract<LimitRelationResult, { valid: false }>;
      expect(r.code).toBe("INVALID_LIMIT_RELATION");
      expect(r.message).toContain("maxSnapshotBytes");
    });

    it("accepts when maxSpoolBytes equals maxStagingBytes", () => {
      const limits: Parameters<typeof validateLimitRelations>[0] = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 1000,
        maxSnapshotBytes: 1000,
      };
      const result = validateLimitRelations(limits);
      expect(result.valid).toBe(true);
    });
  });

  describe("exit code for invalid limits", () => {
    it("returns exit code 2 for invalid limit relations", () => {
      const limits: Parameters<typeof validateLimitRelations>[0] = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 2000,
      };
      const result = validateLimitRelations(limits);
      const hasErrors = !result.valid;
      const exitCode = computeExitCode({
        optionError: hasErrors,
        hasUsableInput: true,
        inputError: false,
        strictFailure: false,
        resourceOrIntegerFailure: false,
        mergeCollision: false,
        outputError: false,
        cancelled: false,
        continued: false,
        completedInputCount: 0,
        failedInputCount: 0,
        internalError: false,
      });
      expect(exitCode).toBe(ExitCode.INVALID_USAGE);
    });

    it("precedence: option error > no input", () => {
      const exitCode = computeExitCode({
        optionError: true,
        hasUsableInput: false,
        inputError: false,
        strictFailure: false,
        resourceOrIntegerFailure: false,
        mergeCollision: false,
        outputError: false,
        cancelled: false,
        continued: false,
        completedInputCount: 0,
        failedInputCount: 0,
        internalError: false,
      });
      expect(exitCode).toBe(ExitCode.INVALID_USAGE);
    });
  });

  describe("pre-open sentinel (P1-AC3 proof)", () => {
    /**
     * Behavioral proof that INVALID_LIMIT_RELATION is emitted before any input access.
     * The CLI runs validateLimitRelations before discoverInputs or openDatabase.
     * We verify this by running the CLI with invalid limits and no inputs —
     * no database file exists, so any attempt to access inputs would fail.
     */
    it("INVALID_LIMIT_RELATION exits 2 before input access with no inputs provided", async () => {
      // Use a path that definitely does not exist to prove we never reach input access
      const nonexistentPath = "/this/path/definitely/does/not/exist.cdb";
      const stderrChunks: Buffer[] = [];
      const mockStderr = new Writable({
        write(chunk, _encoding, callback) {
          stderrChunks.push(Buffer.from(chunk));
          callback();
        },
      });

      // Invoke CLI with invalid limits (maxSpoolBytes > maxStagingBytes)
      // and a nonexistent input path. If input access were attempted first,
      // the CLI would produce a different error (no usable input / CDB open failed).
      const exitCode = await main(
        [
          "--max-spool-bytes", "8589934592", // 8 GiB
          "--max-staging-bytes", "4294967296", // 4 GiB (less than spool)
          nonexistentPath,
        ],
        { stdout: new Writable({ write() {} }), stderr: mockStderr }
      );

      // Exit 2: INVALID_USAGE (option error)
      expect(exitCode).toBe(2);

      // The error message contains INVALID_LIMIT_RELATION, proving the check
      // runs before any attempt to access the nonexistent input path.
      const stderrText = Buffer.concat(stderrChunks).toString("utf-8");
      expect(stderrText).toContain("INVALID_LIMIT_RELATION");
      expect(stderrText).not.toContain("ENOENT"); // No file-not-found error
      expect(stderrText).not.toContain("CDB_OPEN_FAILED");
    });

    it("empty args return 0 (help) — no INVALID_LIMIT_RELATION from valid limits", async () => {
      const stderrChunks: Buffer[] = [];
      const mockStderr = new Writable({
        write(chunk, _encoding, callback) {
          stderrChunks.push(Buffer.from(chunk));
          callback();
        },
      });

      // No args → CLI parses to help command and returns 0 (not exit 2).
      // INVALID_LIMIT_RELATION never fires because limit validation never runs
      // (help command short-circuits before the convert path).
      const exitCode = await main(
        [],
        { stdout: new Writable({ write() {} }), stderr: mockStderr }
      );

      // Exit 0: help was shown
      expect(exitCode).toBe(0);

      // No INVALID_LIMIT_RELATION since no limit validation was reached
      const stderrText = Buffer.concat(stderrChunks).toString("utf-8");
      expect(stderrText).not.toContain("INVALID_LIMIT_RELATION");
    });
  });
});
