/**
 * Output plan — pure structural planner for conversion operations.
 *
 * Validates the option matrix before discovery/snapshot/open.
 * Separates pre-discovery structural planning from post-discovery
 * concrete output file assignment.
 *
 * No method in this file opens SQLite.
 */

import type {
  NormalizedConvertOptions,
} from "./types.js";

/**
 * Result of output plan validation.
 */
export interface OutputPlanResult {
  valid: boolean;
  error?: string;
  /** The normalized, validated options ready for pre-open checks */
  plan?: OutputPlan;
}

/**
 * Concrete output destination for one logical output.
 */
export interface ConcreteOutput {
  inputOrdinal: number;
  inputPath: string;
  relativeName: string;
  logicalOutputId: string;
}

/**
 * Validated output plan for a conversion operation.
 */
export interface OutputPlan {
  /** Normalized convert options */
  options: NormalizedConvertOptions;
  /** Whether this is a raw profile conversion */
  isRawConversion: boolean;
  /** Retained for compatibility with callers that distinguish unavailable profiles */
  isProfileNotAvailable: boolean;
  /** Number of logical outputs expected */
  logicalOutputCount: number;
  /** Whether stdout is allowed as destination */
  allowsStdout: boolean;
}

/**
 * Validates the profile/format/split/merge/conflict matrix before
 * any discovery or snapshot access.
 */
export function validateOutputPlan(
  options: NormalizedConvertOptions
): OutputPlanResult {
  if (options.profile !== "raw") {
    if (options.merge || options.split === "card" || options.destination.kind === "directory") {
      return { valid: false, error: "Card and source merge/split output is not available yet. Use one input with stdout or --output <file>." };
    }
    if (options.pretty && options.format === "jsonl") {
      return { valid: false, error: "--pretty is not valid with --format jsonl." };
    }
    return { valid: true, plan: { options, isRawConversion: false, isProfileNotAvailable: false, logicalOutputCount: 1, allowsStdout: true } };
  }

  // Valid: raw profile
  return validateRawPlan(options);
}

/**
 * Validate the option matrix specific to raw profile conversion.
 */
function validateRawPlan(
  options: NormalizedConvertOptions
): OutputPlanResult {
  // Raw cannot use --merge
  if (options.merge) {
    return {
      valid: false,
      error: "'raw' profile does not support --merge. Use card or source profile for merge operations.",
    };
  }

  // Raw cannot use --split card
  if (options.split === "card") {
    return {
      valid: false,
      error: "'raw' profile does not support --split card. Use 'none' or 'database' split mode.",
    };
  }

  // split=database requires a directory output (even for single input)
  // because the semantic is "one file per database" which implies a directory structure
  if (options.split === "database" && options.destination.kind === "file") {
    return {
      valid: false,
      error: "--split database requires a directory output. Use --output <directory> instead of --output <file>.",
    };
  }

  // Pretty + JSONL is invalid
  if (options.pretty && options.format === "jsonl") {
    return {
      valid: false,
      error: "--pretty is not valid with --format jsonl.",
    };
  }

  // Validate destination kind
  if (options.destination.kind === "file" && !options.destination.path) {
    return {
      valid: false,
      error: "File destination requires a path. Use -o <path> or - for stdout.",
    };
  }

  // If one input, split=none + file/stdout is OK
  // If multiple inputs, split=none requires --merge (not allowed for raw)
  // If multiple inputs without merge, split=database is required
  // These are validated after discovery

  return {
    valid: true,
    plan: {
      options,
      isRawConversion: true,
      isProfileNotAvailable: false,
      logicalOutputCount: options.inputs.length,
      allowsStdout: options.inputs.length <= 1,
    },
  };
}

/**
 * Validate output cardinality rules after discovery.
 * Must be called with concrete discovered input count.
 */
export function validateOutputCardinality(
  options: NormalizedConvertOptions,
  discoveredInputCount: number
): OutputPlanResult {
  if (options.profile !== "raw") {
    if (discoveredInputCount !== 1) {
      return { valid: false, error: "Card and source conversion currently require exactly one input database." };
    }
    return { valid: true, plan: { options, isRawConversion: false, isProfileNotAvailable: false, logicalOutputCount: 1, allowsStdout: true } };
  }

  // Raw with no inputs
  if (discoveredInputCount === 0) {
    return {
      valid: true,
      plan: {
        options,
        isRawConversion: true,
        isProfileNotAvailable: false,
        logicalOutputCount: 0,
        allowsStdout: true,
      },
    };
  }

  // One input: split=none or split=auto
  if (discoveredInputCount === 1) {
    const allowsStdout =
      options.destination.kind !== "directory";

    return {
      valid: true,
      plan: {
        options,
        isRawConversion: true,
        isProfileNotAvailable: false,
        logicalOutputCount: 1,
        allowsStdout,
      },
    };
  }

  // Multiple inputs: split=none (without merge) is invalid for raw
  if (options.split === "none") {
    return {
      valid: false,
      error: `Multiple inputs (${discoveredInputCount}) with --split none requires --merge, which is not available for 'raw' profile. Use --split database.`,
    };
  }

  // Multiple inputs with split=database: requires directory destination
  if (options.destination.kind !== "directory") {
    return {
      valid: false,
      error: `Multiple inputs (${discoveredInputCount}) with --split database requires a directory output destination (--output <dir>).`,
    };
  }

  return {
    valid: true,
    plan: {
      options,
      isRawConversion: true,
      isProfileNotAvailable: false,
      logicalOutputCount: discoveredInputCount,
      allowsStdout: false,
    },
  };
}
