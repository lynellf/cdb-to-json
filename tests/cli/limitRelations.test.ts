/**
 * Tests for limit relation validation.
 *
 * Validates:
 * - Zero/equal/less/greater relation vectors before discovery/open
 * - INVALID_LIMIT_RELATION exit code 2
 */

import { describe, it, expect } from "vitest";
import { getDefaultLimits, validateLimitRelations } from "../../dist/application/types.js";
import { computeExitCode, ExitCode } from "../../dist/cli/exitCodes.js";

describe("Limit Relations", () => {
  describe("validateLimitRelations", () => {
    it("accepts valid limit relations", () => {
      const limits = getDefaultLimits();

      const result = validateLimitRelations(limits);

      // Returns null if valid
      expect(result).toBeNull();
    });

    it("rejects when maxSpoolBytes exceeds maxStagingBytes", () => {
      const limits = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 2000,
      };

      const result = validateLimitRelations(limits);

      // Returns error string if invalid
      expect(result).not.toBeNull();
      expect(result).toContain("maxSpoolBytes");
    });

    it("rejects when maxSnapshotBytes exceeds maxStagingBytes", () => {
      const limits = {
        maxRowsPerTable: 1000,
        maxTextBytes: 1000,
        maxOutputBytes: 1000,
        maxStagingBytes: 1000,
        maxSpoolBytes: 500, // Under limit
        maxSnapshotBytes: 2000, // Over limit
      };

      const result = validateLimitRelations(limits);

      expect(result).not.toBeNull();
      expect(result).toContain("maxSnapshotBytes");
    });

    it("accepts when maxSpoolBytes equals maxStagingBytes", () => {
      const limits = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 1000,
        maxSnapshotBytes: 1000,
      };

      const result = validateLimitRelations(limits);

      expect(result).toBeNull();
    });
  });

  describe("exit code for invalid limits", () => {
    it("returns exit code 2 for invalid limit relations", () => {
      const limits = {
        ...getDefaultLimits(),
        maxStagingBytes: 1000,
        maxSpoolBytes: 2000,
      };

      const validationResult = validateLimitRelations(limits);
      const hasErrors = validationResult !== null;

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

  describe("default limits", () => {
    it("has reasonable default values", () => {
      const limits = getDefaultLimits();

      expect(limits.maxRowsPerTable).toBeGreaterThan(0);
      expect(limits.maxTextBytes).toBeGreaterThan(0);
      expect(limits.maxOutputBytes).toBeGreaterThan(0);
      expect(limits.maxStagingBytes).toBeGreaterThan(0);
      expect(limits.maxSpoolBytes).toBeGreaterThan(0);
      expect(limits.maxSnapshotBytes).toBeGreaterThan(0);
    });

    it("default limits satisfy their own constraints", () => {
      const limits = getDefaultLimits();

      const result = validateLimitRelations(limits);

      expect(result).toBeNull();
    });
  });
});
