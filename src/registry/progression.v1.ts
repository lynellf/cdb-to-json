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
 * Progression type bits in the card type field.
 * These are mutually exclusive for valid cards.
 */
export const ProgressionTypeBits = {
  /** LINK monster bit (0x20000000) */
  LINK: 0x20000000,
  /** XYZ monster bit (0x400000) */
  XYZ: 0x400000,
  /** Pendulum monster bit (0x1000000) */
  PENDULUM: 0x1000000,
} as const;

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
 * Names of conflicting progression type bits.
 */
export type ConflictingType = "LINK" | "XYZ" | "PENDULUM";

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
  /** Conflicting progression type bits, if detected (per INV-007) */
  conflictingTypes: readonly ConflictingType[];
  registry: string;
}

/**
 * Detect conflicting progression type bits in a type field.
 *
 * Per INV-007: Conflicting progression types are when more than one mutually
 * exclusive type is set. LINK is mutually exclusive with both XYZ and PENDULUM.
 * However, XYZ + PENDULUM together form a valid "xyz_pendulum" monster and is
 * NOT a conflict.
 *
 * Conflict scenarios:
 * - LINK + XYZ: conflict (LINK and XYZ are mutually exclusive)
 * - LINK + PENDULUM: conflict (LINK monsters can't have pendulum scales)
 * - LINK + XYZ + PENDULUM: conflict (has LINK)
 *
 * Valid scenarios:
 * - LINK alone: valid LINK monster
 * - XYZ alone: valid XYZ monster
 * - PENDULUM alone: valid Pendulum monster
 * - XYZ + PENDULUM: valid XYZ Pendulum monster
 *
 * @param typeValue - The card type field value
 * @returns Array of conflicting type names, empty if no conflict
 */
export function detectConflictingProgressionBits(typeValue: number): readonly ConflictingType[] {
  const hasLink = (typeValue & ProgressionTypeBits.LINK) !== 0;
  const hasXyz = (typeValue & ProgressionTypeBits.XYZ) !== 0;
  const hasPendulum = (typeValue & ProgressionTypeBits.PENDULUM) !== 0;

  // Conflict: LINK + any other progression type
  // LINK is mutually exclusive with both XYZ and PENDULUM
  if (hasLink && (hasXyz || hasPendulum)) {
    const conflicts: ConflictingType[] = ["LINK"];
    if (hasXyz) conflicts.push("XYZ");
    if (hasPendulum) conflicts.push("PENDULUM");
    return conflicts;
  }

  // XYZ + PENDULUM is valid (xyz_pendulum monster)
  // No conflict
  return [];
}

/**
 * Determine the progression type based on card type bits.
 *
 * Returns: 'regular' | 'xyz' | 'link' | 'pendulum' | 'xyz_pendulum' | 'conflicting'
 */
export function getProgressionType(typeValue: number): string {
  // Check for conflicting bits first
  const conflicts = detectConflictingProgressionBits(typeValue);
  if (conflicts.length > 0) {
    return 'conflicting';
  }

  const isLink = (typeValue & ProgressionTypeBits.LINK) !== 0;
  const isXyz = (typeValue & ProgressionTypeBits.XYZ) !== 0;
  const isPendulum = (typeValue & ProgressionTypeBits.PENDULUM) !== 0;

  if (isLink) return 'link';
  if (isXyz && isPendulum) return 'xyz_pendulum';
  if (isXyz) return 'xyz';
  if (isPendulum) return 'pendulum';
  return 'regular';
}

/**
 * Decode the level/rank/link/pendulum field based on card type.
 *
 * Per INV-007 (null-on-conflict): When conflicting progression type bits
 * are detected (e.g., LINK + XYZ), all primary fields (level, rank,
 * linkRating) are set to null. The rawValue is always preserved for
 * diagnostics.
 *
 * Per INV-007 (scale independence): Pendulum scales are decoded
 * independently of the primary frame. A pendulum object is produced
 * only when both scales are valid (0 or 1-13). level/rank/linkRating
 * are null-on-conflict but scales remain extractable for diagnostic
 * purposes.
 *
 * @param levelValue - The raw level field value from datas
 * @param typeValue - The type field value from datas (determines interpretation)
 */
export function decodeProgression(levelValue: number, typeValue: number): ProgressionDecodeResult {
  const progressionType = getProgressionType(typeValue);
  const conflictingTypes = detectConflictingProgressionBits(typeValue);

  // Per INV-007: null-on-conflict for primary progression fields
  const hasConflict = conflictingTypes.length > 0;

  let level: number | null = null;
  let rank: number | null = null;
  let linkRating: number | null = null;
  let pendulum: { leftScale: number; rightScale: number } | null = null;

  // Extract base level/rank (lower byte)
  const baseLevel = levelValue & LevelField.LEVEL_MASK;

  // Track unknown bits
  let unknownBits = 0;

  // Extract pendulum scales (independent of conflict state)
  // Per INV-007: scales are decoded independently; pendulum object is produced
  // only when BOTH packed values are valid (0 or 1-13)
  const leftScaleRaw = (levelValue >> LevelField.LEFT_SCALE_SHIFT) & LevelField.LEFT_SCALE_MASK;
  const rightScaleRaw = (levelValue >> LevelField.RIGHT_SCALE_SHIFT) & LevelField.RIGHT_SCALE_MASK;

  // Validate left scale: must be 0 or 1-13
  const leftScaleValid = leftScaleRaw === 0 ||
    (leftScaleRaw >= PENDULUM_SCALE_MIN && leftScaleRaw <= PENDULUM_SCALE_MAX);

  // Validate right scale: must be 0 or 1-13
  const rightScaleValid = rightScaleRaw === 0 ||
    (rightScaleRaw >= PENDULUM_SCALE_MIN && rightScaleRaw <= PENDULUM_SCALE_MAX);

  // Track invalid scale bits in unknownBits
  if (!leftScaleValid) {
    unknownBits |= (leftScaleRaw << LevelField.LEFT_SCALE_SHIFT);
  }
  if (!rightScaleValid) {
    unknownBits |= (rightScaleRaw << LevelField.RIGHT_SCALE_SHIFT);
  }

  // Pendulum object is produced only when both scales are valid AND at least one is non-zero
  if (leftScaleValid && rightScaleValid && (leftScaleRaw !== 0 || rightScaleRaw !== 0)) {
    pendulum = {
      leftScale: leftScaleRaw,
      rightScale: rightScaleRaw,
    };
  }

  // Primary frame interpretation (level/rank/linkRating) - null-on-conflict
  if (!hasConflict) {
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

      case 'xyz_pendulum':
        // XYZ Pendulum monsters use rank (scales already extracted above)
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
        // Pendulum monsters have level
        if (baseLevel >= 1 && baseLevel <= 12) {
          level = baseLevel;
        } else if (baseLevel === 0) {
          // Level 0 is unusual but possible for some pendulums
          level = baseLevel;
        }
        // pendulum object already set above when both scales valid
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
  }

  // Check for unexpected bits in upper portion (bits 16+)
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
    conflictingTypes,
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
