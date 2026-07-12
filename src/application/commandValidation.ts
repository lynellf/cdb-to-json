/**
 * Pre-discovery command validation.
 *
 * Validates option combinations that can be checked without
 * discovering inputs or opening databases.
 */

import type { LimitsV1 } from "./types.js";
import { getDefaultLimits, validateLimitRelations } from "./types.js";

/**
 * Result of pre-discovery validation.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate numeric option values.
 */
export function validateNumericOption(
  value: unknown,
  name: string
): ValidationResult {
  if (value === undefined || value === null) {
    return { valid: true };
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return {
      valid: false,
      error: `Invalid ${name}: must be a non-negative safe integer`,
    };
  }

  return { valid: true };
}

/**
 * Build LimitsV1 from individual option values.
 */
export function buildLimits(options: {
  maxRows?: number;
  maxTextBytes?: number;
  maxOutputBytes?: number;
  maxStagingBytes?: number;
  maxSpoolBytes?: number;
  maxSnapshotBytes?: number;
}): { limits: LimitsV1; error?: string } {
  const defaults = getDefaultLimits();

  const limits: LimitsV1 = {
    maxRowsPerTable: options.maxRows ?? defaults.maxRowsPerTable,
    maxTextBytes: options.maxTextBytes ?? defaults.maxTextBytes,
    maxOutputBytes: options.maxOutputBytes ?? defaults.maxOutputBytes,
    maxStagingBytes: options.maxStagingBytes ?? defaults.maxStagingBytes,
    maxSpoolBytes: options.maxSpoolBytes ?? defaults.maxSpoolBytes,
    maxSnapshotBytes: options.maxSnapshotBytes ?? defaults.maxSnapshotBytes,
  };

  // Validate each numeric value
  const numericChecks: Array<{ value: number; name: string }> = [
    { value: limits.maxRowsPerTable, name: "maxRowsPerTable" },
    { value: limits.maxTextBytes, name: "maxTextBytes" },
    { value: limits.maxOutputBytes, name: "maxOutputBytes" },
    { value: limits.maxStagingBytes, name: "maxStagingBytes" },
    { value: limits.maxSpoolBytes, name: "maxSpoolBytes" },
    { value: limits.maxSnapshotBytes, name: "maxSnapshotBytes" },
  ];

  for (const check of numericChecks) {
    if (!Number.isSafeInteger(check.value) || check.value < 0) {
      return {
        limits,
        error: `Invalid ${check.name}: must be a non-negative safe integer`,
      };
    }
  }

  // Validate limit relations
  const relationError = validateLimitRelations(limits);
  if (relationError) {
    return { limits, error: relationError };
  }

  return { limits };
}
