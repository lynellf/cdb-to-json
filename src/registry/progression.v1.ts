/**
 * Progression registry v1 - defines level/rank/link/pendulum decoding.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * The `level` field is packed with different data depending on card type:
 *
 * Regular monsters (non-XYZ, non-LINK, non-Pendulum):
 * - bits 0-7: level (1-12)
 * - bits 8-31: unused (should be 0)
 *
 * XYZ monsters:
 * - bits 0-7: rank (1-12)
 * - bits 8-31: unused (should be 0)
 * - Note: level field is used for rank
 *
 * LINK monsters:
 * - bits 0-7: link rating (1-6)
 * - bits 8-31: unused (should be 0)
 *
 * Pendulum monsters:
 * - bits 0-7: level (1-12)
 * - bits 8-11: left scale (1-13, 0 means no pendulum effect)
 * - bits 12-15: right scale (1-13, 0 means no pendulum effect)
 * - bits 16-31: unused (should be 0)
 *
 * The card type (from datas.type) determines how to interpret this field.
 */

export const PROGRESSION_VERSION = "cdb-normalization/1" as const;

/**
 * Level field bit masks and shifts.
 */
export const LevelField = {
  /** Level value mask (lower byte) */
  LEVEL_MASK: 0xFF,
  /** Left pendulum scale shift */
  LEFT_SCALE_SHIFT: 8,
  LEFT_SCALE_MASK: 0xF,
  /** Right pendulum scale shift */
  RIGHT_SCALE_SHIFT: 12,
  RIGHT_SCALE_MASK: 0xF,
} as const;

/**
 * Link rating constants.
 */
export const LINK_RATING_MIN = 1;
export const LINK_RATING_MAX = 6;

/**
 * Pendulum scale constants.
 */
export const PENDULUM_SCALE_MIN = 1;
export const PENDULUM_SCALE_MAX = 13;

/**
 * Decoded progression result.
 */
export interface ProgressionDecodeResult {
  /** Level (for regular monsters) or null */
  level: number | null;
  /** Rank (for XYZ monsters) or null */
  rank: number | null;
  /** Link rating (for LINK monsters) or null */
  linkRating: number | null;
  /** Pendulum scales (if pendulum monster) or null */
  pendulum: { leftScale: number; rightScale: number } | null;
  /** Raw level field value */
  rawValue: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  registry: string;
}

/**
 * Determine the progression type based on card type bits.
 *
 * Returns: 'regular' | 'xyz' | 'link' | 'pendulum' | 'xyz_pendulum'
 */
export function getProgressionType(typeValue: number): string {
  const isLink = (typeValue & 0x20000000) !== 0;
  const isXyz = (typeValue & 0x400000) !== 0;
  const isPendulum = (typeValue & 0x1000000) !== 0;

  if (isLink) return 'link';
  if (isXyz && isPendulum) return 'xyz_pendulum';
  if (isXyz) return 'xyz';
  if (isPendulum) return 'pendulum';
  return 'regular';
}

/**
 * Decode the level/rank/link/pendulum field based on card type.
 *
 * @param levelValue - The raw level field value from datas
 * @param typeValue - The type field value from datas (determines interpretation)
 */
export function decodeProgression(levelValue: number, typeValue: number): ProgressionDecodeResult {
  const progressionType = getProgressionType(typeValue);
  let level: number | null = null;
  let rank: number | null = null;
  let linkRating: number | null = null;
  let pendulum: { leftScale: number; rightScale: number } | null = null;

  // Extract base level/rank (lower byte)
  const baseLevel = levelValue & LevelField.LEVEL_MASK;

  // Track unknown bits
  let unknownBits = 0;

  switch (progressionType) {
    case 'link':
      // LINK monsters use link rating
      if (baseLevel >= LINK_RATING_MIN && baseLevel <= LINK_RATING_MAX) {
        linkRating = baseLevel;
      } else if (baseLevel === 0) {
        // Valid link rating 0 shouldn't happen, but handle gracefully
        linkRating = null;
      } else {
        // Invalid link rating
        unknownBits = levelValue;
      }
      break;

    case 'xyz':
      // XYZ monsters use rank
      if (baseLevel >= 1 && baseLevel <= 12) {
        rank = baseLevel;
      } else if (baseLevel === 0) {
        // Rank 0 is invalid
        unknownBits = levelValue;
      } else {
        // Invalid rank
        unknownBits = levelValue;
      }
      break;

    case 'pendulum':
      // Pendulum monsters have level + scales
      if (baseLevel >= 1 && baseLevel <= 12) {
        level = baseLevel;
      } else if (baseLevel === 0) {
        // Level 0 is unusual but possible for some pendulums
        level = baseLevel;
      }

      // Extract pendulum scales
      const leftScaleRaw = (levelValue >> LevelField.LEFT_SCALE_SHIFT) & LevelField.LEFT_SCALE_MASK;
      const rightScaleRaw = (levelValue >> LevelField.RIGHT_SCALE_SHIFT) & LevelField.RIGHT_SCALE_MASK;

      // Validate scales
      if ((leftScaleRaw >= PENDULUM_SCALE_MIN && leftScaleRaw <= PENDULUM_SCALE_MAX) ||
          leftScaleRaw === 0) {
        // leftScale 0 is valid for non-pendulum effect monsters
      } else {
        unknownBits |= leftScaleRaw << LevelField.LEFT_SCALE_SHIFT;
      }

      if ((rightScaleRaw >= PENDULUM_SCALE_MIN && rightScaleRaw <= PENDULUM_SCALE_MAX) ||
          rightScaleRaw === 0) {
        // rightScale 0 is valid
      } else {
        unknownBits |= rightScaleRaw << LevelField.RIGHT_SCALE_SHIFT;
      }

      // Only set pendulum object if at least one scale is non-zero
      // or if the structure suggests pendulum intent
      if (leftScaleRaw !== 0 || rightScaleRaw !== 0 || levelValue > 0xFF) {
        pendulum = {
          leftScale: leftScaleRaw,
          rightScale: rightScaleRaw,
        };
      }
      break;

    case 'xyz_pendulum':
      // XYZ Pendulum monsters (rare)
      if (baseLevel >= 1 && baseLevel <= 12) {
        rank = baseLevel; // Uses rank like XYZ
      } else {
        unknownBits = levelValue;
      }

      // Extract pendulum scales
      const lScale = (levelValue >> LevelField.LEFT_SCALE_SHIFT) & LevelField.LEFT_SCALE_MASK;
      const rScale = (levelValue >> LevelField.RIGHT_SCALE_SHIFT) & LevelField.RIGHT_SCALE_MASK;

      if (lScale !== 0 || rScale !== 0) {
        pendulum = {
          leftScale: lScale,
          rightScale: rScale,
        };
      }
      break;

    case 'regular':
    default:
      // Regular monsters have level
      if (baseLevel >= 1 && baseLevel <= 12) {
        level = baseLevel;
      } else if (baseLevel === 0) {
        // Level 0 is unusual but technically valid for some special monsters
        level = baseLevel;
      } else {
        unknownBits = levelValue;
      }
      break;
  }

  // Check for unexpected bits in upper portion
  const upperBits = levelValue & ~0xFFFF;
  if (upperBits !== 0) {
    unknownBits |= upperBits;
  }

  return {
    level,
    rank,
    linkRating,
    pendulum,
    rawValue: levelValue,
    unknownBits,
    registry: PROGRESSION_VERSION,
  };
}

/**
 * Validate a progression value.
 * Returns null if valid, or an error message if invalid.
 */
export function validateProgression(levelValue: number, typeValue: number): string | null {
  const result = decodeProgression(levelValue, typeValue);

  if (result.unknownBits !== 0) {
    return `Invalid packed progression: unknown bits 0x${result.unknownBits.toString(16)}`;
  }

  return null;
}
