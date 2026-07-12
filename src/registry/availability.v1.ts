/**
 * Availability (ot) registry v1 - defines card availability/sourcing flags.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * The `ot` field indicates where a card is available:
 * - OCG (Asian/English)
 * - TCG (Western)
 * - OCGT (OCG + TCG)
 * - Anime, Rush Duel, etc.
 *
 * This is NOT tournament legality - it just indicates sourcing.
 *
 * Bit layout (may be multiple bits for combined availability):
 * - 0x1: OCG (Asian)
 * - 0x2: TCG (Western)
 * - 0x3: OCGT (both OCG and TCG)
 * - 0x4: Anime
 * - 0x8: Demo
 * - 0x10: Rush Duel (Speed Duel)
 * - 0x20: ???
 * - 0x40: ???
 * - etc.
 *
 * Common values:
 * - 1 = OCG only
 * - 2 = TCG only
 * - 3 = OCGT (legal in both)
 */

export const AVAILABILITY_VERSION = "cdb-normalization/1" as const;

/**
 * Availability flag bitflags.
 */
export const Availability = {
  OCG: 0x1,           // Asian/OCG region
  TCG: 0x2,           // Western/TCG region
  OCGT: 0x3,          // OCG + TCG combined (also 0x1 | 0x2)
  ANIME: 0x4,         // Anime only
  DEMO: 0x8,          // Demo/Preview
  RUSH_DUEL: 0x10,    // Rush Duel (Speed Duel)
  GOAT: 0x20,         // GOAT format era (historical)
  // Additional bits may be defined in future
} as const;

export type Availability = (typeof Availability)[keyof typeof Availability];

/**
 * Decode result for availability field.
 */
export interface AvailabilityDecodeResult {
  /** Array of decoded availability codes */
  codes: string[];
  /** OR of all decoded availability bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  rawValue: number;
  registry: string;
}

/**
 * Decode availability flags.
 */
export function decodeAvailability(otValue: number): AvailabilityDecodeResult {
  const decodedBits: number[] = [];

  // Check for combined OCGT first (0x3)
  if (otValue === (Availability.OCGT)) {
    decodedBits.push(Availability.OCGT);
  } else {
    // Check individual bits
    if (otValue & Availability.OCG) decodedBits.push(Availability.OCG);
    if (otValue & Availability.TCG) decodedBits.push(Availability.TCG);
    if (otValue & Availability.ANIME) decodedBits.push(Availability.ANIME);
    if (otValue & Availability.DEMO) decodedBits.push(Availability.DEMO);
    if (otValue & Availability.RUSH_DUEL) decodedBits.push(Availability.RUSH_DUEL);
    if (otValue & Availability.GOAT) decodedBits.push(Availability.GOAT);
  }

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = otValue & ~decodedOr;

  return {
    codes: decodedBits.map(bitToName),
    decodedBits: decodedOr,
    unknownBits,
    rawValue: otValue,
    registry: AVAILABILITY_VERSION,
  };
}

/**
 * Convert an availability bit to its code string.
 */
export function bitToName(bit: number): string {
  switch (bit) {
    case Availability.OCG: return "OCG";
    case Availability.TCG: return "TCG";
    case Availability.OCGT: return "OCGT";
    case Availability.ANIME: return "ANIME";
    case Availability.DEMO: return "DEMO";
    case Availability.RUSH_DUEL: return "RUSH_DUEL";
    case Availability.GOAT: return "GOAT";
    default: return `UNKNOWN_${bit.toString(16)}`;
  }
}

/**
 * Get the primary availability code.
 * Returns null if no recognized availability.
 */
export function getPrimaryAvailability(otValue: number): string | null {
  if (otValue === Availability.OCGT) return "OCGT";
  if (otValue & Availability.OCG) return "OCG";
  if (otValue & Availability.TCG) return "TCG";
  if (otValue & Availability.ANIME) return "ANIME";
  if (otValue & Availability.DEMO) return "DEMO";
  if (otValue & Availability.RUSH_DUEL) return "RUSH_DUEL";
  return null;
}
