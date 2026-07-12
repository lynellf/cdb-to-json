/**
 * Unit tests for diagnostics policy: merge, promote, and exit codes.
 */

import { describe, it, expect } from "vitest";
import { DiagnosticCollector } from "../../src/diagnostics/collector.js";
import { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { computeExitCode, type ExitCodeState } from "../../src/cli/exitCodes.js";

describe("DiagnosticCollector", () => {
  it("collects diagnostics by severity", () => {
    const collector = new DiagnosticCollector();
    collector.error(DiagnosticCode.NO_CDB_INPUT, "No input found");
    collector.warning(DiagnosticCode.MISSING_TEXT_ROW, "Missing text row");
    collector.info(DiagnosticCode.INVALID_PATH, "Skipping path");

    const summary = collector.getSummary();
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.totalCount).toBe(3);
  });

  it("merges diagnostics from multiple collectors", () => {
    const c1 = new DiagnosticCollector();
    c1.error(DiagnosticCode.CDB_OPEN_FAILED, "Failed to open");

    const c2 = new DiagnosticCollector();
    c2.warning(DiagnosticCode.MISSING_DATA_ROW, "Missing data row");

    c1.merge(c2);
    expect(c1.count).toBe(2);
    expect(c1.getErrors().length).toBe(1);
    expect(c1.getWarnings().length).toBe(1);
  });

  it("promotes warnings to errors in strict mode", () => {
    const collector = new DiagnosticCollector();
    collector.warning(DiagnosticCode.MISSING_TEXT_ROW, "Missing text row");

    collector.promote(true);
    expect(collector.getWarnings().length).toBe(0);
    expect(collector.getErrors().length).toBe(1);
  });

  it("does not promote warnings when not strict", () => {
    const collector = new DiagnosticCollector();
    collector.warning(DiagnosticCode.MISSING_TEXT_ROW, "Missing text row");

    collector.promote(false);
    expect(collector.getWarnings().length).toBe(1);
    expect(collector.getErrors().length).toBe(0);
  });
});

describe("computeExitCode", () => {
  const successState: ExitCodeState = {
    optionError: false,
    hasUsableInput: true,
    inputError: false,
    strictFailure: false,
    resourceOrIntegerFailure: false,
    mergeCollision: false,
    outputError: false,
    cancelled: false,
    continued: false,
    completedInputCount: 1,
    failedInputCount: 0,
    internalError: false,
  };

  it("returns 0 for success", () => {
    expect(computeExitCode(successState)).toBe(0);
  });

  it("returns 2 for option errors (highest precedence)", () => {
    const state = { ...successState, optionError: true };
    expect(computeExitCode(state)).toBe(2);
  });

  it("returns 3 when no usable input", () => {
    const state = { ...successState, hasUsableInput: false };
    expect(computeExitCode(state)).toBe(3);
  });

  it("returns 4 for input errors", () => {
    const state = { ...successState, inputError: true };
    expect(computeExitCode(state)).toBe(4);
  });

  it("returns 5 for merge collisions", () => {
    const state = { ...successState, mergeCollision: true };
    expect(computeExitCode(state)).toBe(5);
  });

  it("returns 6 for output errors", () => {
    const state = { ...successState, outputError: true };
    expect(computeExitCode(state)).toBe(6);
  });

  it("returns 6 for cancellation", () => {
    const state = { ...successState, cancelled: true };
    expect(computeExitCode(state)).toBe(6);
  });

  it("returns 7 for partial conversion", () => {
    const state: ExitCodeState = {
      ...successState,
      continued: true,
      completedInputCount: 2,
      failedInputCount: 1,
    };
    expect(computeExitCode(state)).toBe(7);
  });

  it("returns 1 for internal errors", () => {
    const state: ExitCodeState = {
      ...successState,
      hasUsableInput: true,
      internalError: true,
    };
    expect(computeExitCode(state)).toBe(1);
  });
});