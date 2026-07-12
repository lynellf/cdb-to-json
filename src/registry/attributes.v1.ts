/**
 * Monster attribute registry v1 - defines attribute bitflags.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * Attributes are stored in the `attribute` field of datas table.
 * Each attribute is a single bit.
 */

export const ATTRIBUTE_VERSION = "cdb-normalization/1" as const;

/**
 * Monster attribute bitflags.
 */
export const Attribute = {
  EARTH: 0x1,
  WATER: 0x2,
  FIRE: 0x4,
  WIND: 0x8,
  LIGHT: 0x10,
  DARK: 0x20,
  DIVINE: 0x40,
  // Note: Divine is rarely used in official databases
} as const;

export type Attribute = (typeof Attribute)[keyof typeof Attribute];

/**
 * Decode result for attribute field.
 */
export interface AttributeDecodeResult {
  /** Array of decoded attribute names */
  attributes: string[];
  /** OR of all decoded attribute bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  rawValue: number;
  registry: string;
}

/**
 * Decode a monster attribute field.
 */
export function decodeAttribute(attributeValue: number): AttributeDecodeResult {
  const decodedBits: number[] = [];

  if (attributeValue & Attribute.EARTH) decodedBits.push(Attribute.EARTH);
  if (attributeValue & Attribute.WATER) decodedBits.push(Attribute.WATER);
  if (attributeValue & Attribute.FIRE) decodedBits.push(Attribute.FIRE);
  if (attributeValue & Attribute.WIND) decodedBits.push(Attribute.WIND);
  if (attributeValue & Attribute.LIGHT) decodedBits.push(Attribute.LIGHT);
  if (attributeValue & Attribute.DARK) decodedBits.push(Attribute.DARK);
  if (attributeValue & Attribute.DIVINE) decodedBits.push(Attribute.DIVINE);

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = attributeValue & ~decodedOr;

  return {
    attributes: decodedBits.map(bitToName),
    decodedBits: decodedOr,
    unknownBits,
    rawValue: attributeValue,
    registry: ATTRIBUTE_VERSION,
  };
}

/**
 * Convert an attribute bit to its name string.
 */
export function bitToName(bit: number): string {
  switch (bit) {
    case Attribute.EARTH: return "EARTH";
    case Attribute.WATER: return "WATER";
    case Attribute.FIRE: return "FIRE";
    case Attribute.WIND: return "WIND";
    case Attribute.LIGHT: return "LIGHT";
    case Attribute.DARK: return "DARK";
    case Attribute.DIVINE: return "DIVINE";
    default: return `UNKNOWN_${bit.toString(16)}`;
  }
}

/**
 * Get the primary attribute (first one found).
 * Returns null if no recognized attribute.
 */
export function getPrimaryAttribute(attributeValue: number): string | null {
  if (attributeValue & Attribute.EARTH) return "EARTH";
  if (attributeValue & Attribute.WATER) return "WATER";
  if (attributeValue & Attribute.FIRE) return "FIRE";
  if (attributeValue & Attribute.WIND) return "WIND";
  if (attributeValue & Attribute.LIGHT) return "LIGHT";
  if (attributeValue & Attribute.DARK) return "DARK";
  if (attributeValue & Attribute.DIVINE) return "DIVINE";
  return null;
}
