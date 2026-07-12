/**
 * Stats registry v1 - defines attack/defense decoding.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * The `atk` and `def` fields store numeric stats. However, YGOPro
 * uses special sentinel values to indicate unknown or variable stats:
 *
 * - For LINK monsters, `def` field stores link markers instead
 * - For some monsters, stats can be "?" (unknown)
 * - Some ancient cards have stats stored differently
 *
 * Sentinels used by YGOPro:
 * - -1 or 0xFFFFFFFF: Unknown/variable stat
 * - Some databases may use other conventions
 *
 * The raw integer from SQLite may be:
 * - A valid non-negative integer
 * - A sentinel value indicating unknown
 * - A two's complement negative for special cases
 */

export const STATS_VERSION = "cdb-normalization/1" as const;

/**
 * Sentinel value for unknown/variable stats.
 * YGOPro uses -1 (as signed int) or 0xFFFFFFFF (as unsigned).
 */
export const UNKNOWN_STAT_SENTINEL = -1;

/**
 * Maximum valid stat value.
 * YGOPro stats are typically bounded by game rules.
 */
export const MAX_VALID_STAT = 99999;

/**
 * Minimum valid stat value.
 */
export const MIN_VALID_STAT = -1;

/**
 * Decoded stat result.
 */
export interface StatDecodeResult {
  /** The stat value (null if unknown sentinel) */
  value: number | null;
  /** Display string (null if unknown) */
  display: string | null;
  /** Raw integer value from database */
  rawValue: number;
  /** Whether the stat is marked as unknown/sentinel */
  isUnknown: boolean;
  registry: string;
}

/**
 * Decode an attack or defense stat from the raw database value.
 *
 * @param statValue - The raw atk or def value from datas
 * @param isLink - Whether this is a LINK monster (def contains link markers)
 */
export function decodeStat(statValue: number, isLink: boolean = false): StatDecodeResult {
  // For LINK monsters, def contains link markers, not defense
  if (isLink) {
    return {
      value: null,
      display: null,
      rawValue: statValue,
      isUnknown: false,
      registry: STATS_VERSION,
    };
  }

  // Check for sentinel value (unknown/variable)
  if (statValue === UNKNOWN_STAT_SENTINEL || statValue === 0xFFFFFFFF) {
    return {
      value: null,
      display: null,
      rawValue: statValue,
      isUnknown: true,
      registry: STATS_VERSION,
    };
  }

  // Check for reasonable stat range
  // YGOPro stats should be non-negative and within game bounds
  if (statValue < 0) {
    // Negative stats (other than sentinel) are unusual
    // Return as-is but mark as unknown
    return {
      value: statValue,
      display: String(statValue),
      rawValue: statValue,
      isUnknown: true,
      registry: STATS_VERSION,
    };
  }

  // Check if within valid range
  if (statValue > MAX_VALID_STAT) {
    // Suspiciously high - might indicate corruption or different format
    return {
      value: statValue,
      display: String(statValue),
      rawValue: statValue,
      isUnknown: true,
      registry: STATS_VERSION,
    };
  }

  return {
    value: statValue,
    display: String(statValue),
    rawValue: statValue,
    isUnknown: false,
    registry: STATS_VERSION,
  };
}

/**
 * Decode defense stat, handling LINK markers specially.
 */
export function decodeDefense(defValue: number, typeValue: number): StatDecodeResult {
  // Check if it's a LINK monster
  const isLink = (typeValue & 0x20000000) !== 0;

  if (isLink) {
    // LINK monsters don't have defense
    return {
      value: null,
      display: null,
      rawValue: defValue,
      isUnknown: false,
      registry: STATS_VERSION,
    };
  }

  return decodeStat(defValue, false);
}

/**
 * Format a stat value for display.
 */
export function formatStat(value: number | null): string {
  if (value === null) {
    return "?";
  }
  return String(value);
}
