/**
 * Setcode registry v1 - defines archetype setcode unpacking.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * The `setcode` field is a packed 32-bit integer that encodes
 * one or more archetype codes. The codes are stored in the lower
 * 16 bits, with additional codes using the upper bits.
 *
 * Bit layout:
 * - Lower 16 bits (0xFFFF): Primary setcode
 * - Next 16 bits (0xFFFF0000): Secondary setcode(s)
 *
 * Actually, looking at YGOPro, setcodes are unpacked differently:
 * Each archetype occupies 16 bits, so you can have:
 * - setcode & 0xFFFF: First archetype
 * - (setcode >> 16) & 0xFFFF: Second archetype
 * - (setcode >> 32) & 0xFFFF: Third archetype (rare)
 *
 * The archetype names are not stored in the CDB - they must be
 * resolved through a registry file.
 */

export const SETCODE_VERSION = "cdb-normalization/1" as const;

/**
 * Maximum number of setcodes that can be packed in a 32-bit integer.
 */
export const MAX_SETCODE_COUNT = 2;

/**
 * Mask for extracting a single setcode.
 */
export const SETCODE_MASK = 0xFFFF;

/**
 * Unpacked setcode entry.
 */
export interface UnpackedSetcode {
  /** The numeric archetype code */
  code: number;
  /** Resolved archetype name (if available) */
  name?: string;
  /** Registry hash if name is resolved */
  registryHash?: string;
}

/**
 * Decode result for setcode field.
 */
export interface SetcodeDecodeResult {
  /** Array of unpacked setcodes in order */
  setcodes: UnpackedSetcode[];
  /** Raw setcode value */
  rawValue: number;
  registry: string;
}

/**
 * Unpack a setcode into individual archetype codes.
 *
 * YGOPro stores archetype codes in 16-bit segments:
 * - bits 0-15: first archetype
 * - bits 16-31: second archetype
 * - bits 32-47: third archetype (rarely used)
 *
 * Note: JavaScript bitwise shifts are modulo 32, so shifting by 32 or more
 * bits wraps around. Since setcode values are typically 32-bit integers,
 * we only need to extract the first two 16-bit segments.
 */
export function unpackSetcode(setcodeValue: number): SetcodeDecodeResult {
  if (setcodeValue === 0) {
    return {
      setcodes: [],
      rawValue: setcodeValue,
      registry: SETCODE_VERSION,
    };
  }

  const setcodes: UnpackedSetcode[] = [];

  // Extract first setcode (lower 16 bits)
  const code1 = setcodeValue & SETCODE_MASK;
  if (code1 !== 0) {
    setcodes.push({ code: code1 });
  }

  // Extract second setcode (bits 16-31)
  // Note: JavaScript shifts are modulo 32, so >> 16 is safe for 32-bit values
  const code2 = (setcodeValue >> 16) & SETCODE_MASK;
  if (code2 !== 0) {
    setcodes.push({ code: code2 });
  }

  // For 32-bit setcode values, only two codes are possible (lower and upper 16 bits).
  // Shifting by 32 would wrap around due to JS shift modulo 32 behavior, so we
  // don't attempt to extract a third code. YGOPro setcode format uses at most
  // 32 bits anyway (2 x 16-bit codes).

  return {
    setcodes,
    rawValue: setcodeValue,
    registry: SETCODE_VERSION,
  };
}

/**
 * Validate a setcode value.
 * Returns null if valid, or an error message if invalid.
 */
export function validateSetcode(setcodeValue: number): string | null {
  // Setcode 0 is valid (no archetype)
  if (setcodeValue === 0) {
    return null;
  }

  // Check for invalid patterns
  // A valid setcode should have at least one non-zero 16-bit segment
  const code1 = setcodeValue & SETCODE_MASK;
  const code2 = (setcodeValue >> 16) & SETCODE_MASK;

  if (code1 === 0 && code2 === 0) {
    return "Invalid setcode: no valid archetype code found";
  }

  return null;
}

/**
 * Format a setcode as a hex string for display.
 */
export function formatSetcode(setcodeValue: number): string {
  return `0x${setcodeValue.toString(16)}`;
}
