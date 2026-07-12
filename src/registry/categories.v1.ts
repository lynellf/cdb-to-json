/**
 * Category flags registry v1 - defines card category/search taxonomy.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * The `category` field stores search-relevant categories used by
 * EDOPro/YGOPro for filtering and organization. These are NOT
 * semantic effect tags (like "search", "removal", "negation").
 *
 * This field should be treated as simulator metadata only.
 *
 * Note: The exact bit layout for categories is extensive and
 * may change between YGOPro versions. This registry covers
 * the common categories.
 */

export const CATEGORY_VERSION = "cdb-normalization/1" as const;

/**
 * Card category bitflags.
 * These are search categories used by the simulator.
 */
export const Category = {
  // Monster types (partial list)
  NORMAL: 0x1,
  EFFECT: 0x2,
  FUSION: 0x4,
  RITUAL: 0x8,

  // Spell types
  SPELL: 0x10,
  TRAP: 0x20,

  // Common effect categories
  DRAW: 0x40,
  COUNTER: 0x80,
  DESTROY: 0x100,
  BANNING: 0x200,
  LIMITED: 0x400,
  SEMI_LIMITED: 0x800,

  // Additional categories
  HAND: 0x1000,
  QUICK_PLAY: 0x2000,
  EQUIP: 0x4000,
  CONTINUOUS: 0x8000,
  FIELD: 0x10000,
  RUSH: 0x20000,

  // Toon/Turbo categories
  TOON: 0x40000,
  TOKEN: 0x80000,

  // Type-based
  REPEAT: 0x100000,
  DISCARD: 0x200000,
  NONEFFECT: 0x400000,

  // Note: This is a partial list. The actual YGOPro categories
  // include many more bits that may not be documented here.
} as const;

export type Category = (typeof Category)[keyof typeof Category];

/**
 * Decode result for category field.
 */
export interface CategoryDecodeResult {
  /** Array of decoded category codes */
  codes: string[];
  /** OR of all decoded category bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  rawValue: number;
  registry: string;
}

/**
 * Decode category flags.
 */
export function decodeCategory(categoryValue: number): CategoryDecodeResult {
  const decodedBits: number[] = [];

  // Note: This is a partial list of known categories
  // Many more bits exist in actual YGOPro databases
  if (categoryValue & Category.NORMAL) decodedBits.push(Category.NORMAL);
  if (categoryValue & Category.EFFECT) decodedBits.push(Category.EFFECT);
  if (categoryValue & Category.FUSION) decodedBits.push(Category.FUSION);
  if (categoryValue & Category.RITUAL) decodedBits.push(Category.RITUAL);
  if (categoryValue & Category.SPELL) decodedBits.push(Category.SPELL);
  if (categoryValue & Category.TRAP) decodedBits.push(Category.TRAP);
  if (categoryValue & Category.DRAW) decodedBits.push(Category.DRAW);
  if (categoryValue & Category.COUNTER) decodedBits.push(Category.COUNTER);
  if (categoryValue & Category.DESTROY) decodedBits.push(Category.DESTROY);
  if (categoryValue & Category.BANNING) decodedBits.push(Category.BANNING);
  if (categoryValue & Category.LIMITED) decodedBits.push(Category.LIMITED);
  if (categoryValue & Category.SEMI_LIMITED) decodedBits.push(Category.SEMI_LIMITED);
  if (categoryValue & Category.HAND) decodedBits.push(Category.HAND);
  if (categoryValue & Category.QUICK_PLAY) decodedBits.push(Category.QUICK_PLAY);
  if (categoryValue & Category.EQUIP) decodedBits.push(Category.EQUIP);
  if (categoryValue & Category.CONTINUOUS) decodedBits.push(Category.CONTINUOUS);
  if (categoryValue & Category.FIELD) decodedBits.push(Category.FIELD);
  if (categoryValue & Category.RUSH) decodedBits.push(Category.RUSH);
  if (categoryValue & Category.TOON) decodedBits.push(Category.TOON);
  if (categoryValue & Category.TOKEN) decodedBits.push(Category.TOKEN);
  if (categoryValue & Category.REPEAT) decodedBits.push(Category.REPEAT);
  if (categoryValue & Category.DISCARD) decodedBits.push(Category.DISCARD);
  if (categoryValue & Category.NONEFFECT) decodedBits.push(Category.NONEFFECT);

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = categoryValue & ~decodedOr;

  return {
    codes: decodedBits.map(bitToName),
    decodedBits: decodedOr,
    unknownBits,
    rawValue: categoryValue,
    registry: CATEGORY_VERSION,
  };
}

/**
 * Convert a category bit to its code string.
 */
export function bitToName(bit: number): string {
  switch (bit) {
    case Category.NORMAL: return "NORMAL";
    case Category.EFFECT: return "EFFECT";
    case Category.FUSION: return "FUSION";
    case Category.RITUAL: return "RITUAL";
    case Category.SPELL: return "SPELL";
    case Category.TRAP: return "TRAP";
    case Category.DRAW: return "DRAW";
    case Category.COUNTER: return "COUNTER";
    case Category.DESTROY: return "DESTROY";
    case Category.BANNING: return "BANNING";
    case Category.LIMITED: return "LIMITED";
    case Category.SEMI_LIMITED: return "SEMI_LIMITED";
    case Category.HAND: return "HAND";
    case Category.QUICK_PLAY: return "QUICK_PLAY";
    case Category.EQUIP: return "EQUIP";
    case Category.CONTINUOUS: return "CONTINUOUS";
    case Category.FIELD: return "FIELD";
    case Category.RUSH: return "RUSH";
    case Category.TOON: return "TOON";
    case Category.TOKEN: return "TOKEN";
    case Category.REPEAT: return "REPEAT";
    case Category.DISCARD: return "DISCARD";
    case Category.NONEFFECT: return "NONEFFECT";
    default: return `UNKNOWN_${bit.toString(16)}`;
  }
}
