/**
 * Exit code precedence and state matrix tests.
 */

import { describe, it, expect } from "vitest";
import { computeExitCode, ExitCode, type ExitCodeState } from "../../src/cli/exitCodes.js";

const baseState: ExitCodeState = {
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

describe("Exit code precedence", () => {
  it("precedence: 2 over 3", () => {
    const state: ExitCodeState = {
      ...baseState,
      optionError: true,
      hasUsableInput: false,
    };
    expect(computeExitCode(state)).toBe(ExitCode.INVALID_USAGE);
  });

  it("precedence: 3 over 4", () => {
    const state: ExitCodeState = {
      ...baseState,
      hasUsableInput: false,
      inputError: true,
    };
    expect(computeExitCode(state)).toBe(ExitCode.NO_INPUT);
  });

  it("precedence: 4 over 5", () => {
    const state: ExitCodeState = {
      ...baseState,
      inputError: true,
      mergeCollision: true,
    };
    expect(computeExitCode(state)).toBe(ExitCode.VALIDATION_ERROR);
  });

  it("precedence: 6 over 5 (output error before collision)", () => {
    const state: ExitCodeState = {
      ...baseState,
      mergeCollision: true,
      outputError: true,
    };
    expect(computeExitCode(state)).toBe(ExitCode.OUTPUT_ERROR);
  });

  it("precedence: 6 over 7", () => {
    const state: ExitCodeState = {
      ...baseState,
      outputError: true,
      continued: true,
      completedInputCount: 2,
      failedInputCount: 1,
    };
    expect(computeExitCode(state)).toBe(ExitCode.OUTPUT_ERROR);
  });

  it("cancellation returns 6", () => {
    const state: ExitCodeState = {
      ...baseState,
      cancelled: true,
    };
    expect(computeExitCode(state)).toBe(ExitCode.OUTPUT_ERROR);
  });

  it("success with no errors", () => {
    expect(computeExitCode(baseState)).toBe(ExitCode.SUCCESS);
  });

  it("internal error fallback", () => {
    const state: ExitCodeState = {
      ...baseState,
      internalError: true,
    };
    expect(computeExitCode(state)).toBe(ExitCode.INTERNAL_ERROR);
  });
});