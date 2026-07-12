/**
 * Exit codes and precedence for the CLI.
 * These are stable and machine-readable.
 *
 * Precedence: 2 > 3 > 4 > 5 > 6 > 7 > 1
 */

export const ExitCode = {
  /** Success with no errors */
  SUCCESS: 0,
  /** Unexpected internal failure */
  INTERNAL_ERROR: 1,
  /** Invalid command or option combination */
  INVALID_USAGE: 2,
  /** No usable CDB input found */
  NO_INPUT: 3,
  /** Input schema or strict validation failure */
  VALIDATION_ERROR: 4,
  /** Card-ID collision under --on-conflict error */
  COLLISION: 5,
  /** Output conflict or write failure */
  OUTPUT_ERROR: 6,
  /** Partial conversion under --continue-on-error */
  PARTIAL_CONVERSION: 7,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * State required to compute the correct exit code.
 */
export interface ExitCodeState {
  optionError: boolean;
  hasUsableInput: boolean;
  inputError: boolean;
  strictFailure: boolean;
  resourceOrIntegerFailure: boolean;
  mergeCollision: boolean;
  outputError: boolean;
  cancelled: boolean;
  continued: boolean;
  completedInputCount: number;
  failedInputCount: number;
  internalError: boolean;
}

/**
 * Compute the appropriate exit code from the complete state.
 * Precedence: 2 > 3 > 4 > 5 > 6 > 7 > 1
 */
export function computeExitCode(state: ExitCodeState): ExitCode {
  // Option validation takes highest precedence
  if (state.optionError) {
    return ExitCode.INVALID_USAGE;
  }

  // No usable input
  if (!state.hasUsableInput) {
    return ExitCode.NO_INPUT;
  }

  // Input/schema/strict/resource/integer failure
  if (state.inputError || state.strictFailure || state.resourceOrIntegerFailure) {
    return ExitCode.VALIDATION_ERROR;
  }

  // Merge collision takes precedence over output when no output has failed
  if (state.mergeCollision) {
    return ExitCode.COLLISION;
  }

  // Output error / cancellation
  if (state.outputError || state.cancelled) {
    return ExitCode.OUTPUT_ERROR;
  }

  // Partial conversion requires continued processing,
  // at least one completed input, and at least one failed input
  if (
    state.continued &&
    state.completedInputCount > 0 &&
    state.failedInputCount > 0
  ) {
    return ExitCode.PARTIAL_CONVERSION;
  }

  // Internal error fallback
  if (state.internalError) {
    return ExitCode.INTERNAL_ERROR;
  }

  return ExitCode.SUCCESS;
}