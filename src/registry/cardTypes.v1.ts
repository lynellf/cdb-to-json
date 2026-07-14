/**
 * Card type registry v1 - defines card kind and monster trait bitflags.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * Card kinds (MONSTER, SPELL, TRAP) are determined by checking specific bits:
 * - LINK monsters: type & 0x20000000
 * - SPELL cards: type & (0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800 | 0x10000000) but not monster bits
 * - TRAP cards: type & 0x10000000 but not monster bits
 * - MONSTER cards: everything else with monster trait bits
 *
 * Primary card kind bits:
 * - 0x20000000: LINK (always monster)
 * - 0x4000000: SPELL (bit 26, but also check for monster override)
 * - 0x2000000: TRAP? (need to verify)
 * - Otherwise monster
 *
 * Monster trait bits (can combine):
 * - 0x1: NORMAL (monster only)
 * - 0x2: EFFECT
 * - 0x4: FUSION
 * - 0x8: TOKEN
 * - 0x10: TRAP MONSTER (special case)
 * - 0x20: ? (reserved for spell?)
 * - 0x40: RITUAL (monster or spell)
 * - 0x80: QUICK_PLAY (spell)
 * - 0x100: EQUIP (spell)
 * - 0x200: CONTINUOUS (spell or trap)
 * - 0x400: FIELD (spell)
 * - 0x800: RITUAL (spell)
 * - 0x1000: GEMINI
 * - 0x2000: SYNCHRO
 * - 0x4000: TOKEN (alternate?)
 * - 0x8000: FLIP
 * - 0x10000: TOON
 * - 0x20000: SPIRIT
 * - 0x40000: UNION
 * - 0x80000: DUAL
 * - 0x100000: TUNER
 * - 0x200000: SYNCHRO_TUNER
 * - 0x400000: XYZ
 * - 0x800000: XYZ_TUNER
 * - 0x1000000: PENDULUM
 * - 0x2000000: ? (special)
 * - 0x4000000: ? (special)
 * - 0x8000000: ? (special)
 * - 0x10000000: ? (spell/trap indicator?)
 * - 0x20000000: LINK
 */

export const CARD_TYPE_VERSION = "cdb-normalization/1" as const;

/**
 * Card kinds - top-level categorization.
 */
export type CardKind = "MONSTER" | "SPELL" | "TRAP" | "UNKNOWN";

/**
 * Monster-specific trait flags (may be combined).
 * These are valid only when cardKind is MONSTER.
 */
export const MonsterTrait = {
  NORMAL: 0x1,
  EFFECT: 0x2,
  FUSION: 0x4,
  TOKEN: 0x8,
  TRAP_MONSTER: 0x10,
  RITUAL: 0x40,
  GEMINI: 0x1000,
  SYNCHRO: 0x2000,
  FLIP: 0x8000,
  TOON: 0x10000,
  SPIRIT: 0x20000,
  UNION: 0x40000,
  DUAL: 0x80000,
  TUNER: 0x100000,
  SYNCHRO_TUNER: 0x200000,
  XYZ: 0x400000,
  XYZ_TUNER: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x20000000,
} as const;

export type MonsterTrait = (typeof MonsterTrait)[keyof typeof MonsterTrait];

/**
 * Spell subtype flags.
 */
export const SpellType = {
  NORMAL: 0x40,      // Also used for ritual spell
  QUICK_PLAY: 0x80,
  EQUIP: 0x100,
  CONTINUOUS: 0x200,
  FIELD: 0x400,
  RITUAL: 0x800,
} as const;

export type SpellType = (typeof SpellType)[keyof typeof SpellType];

/**
 * Trap subtype flags.
 */
export const TrapType = {
  NORMAL: 0x200,      // CONTINUOUS is used for both
  CONTINUOUS: 0x200,
  COUNTER: 0x2000000, // Need to verify this bit position
} as const;

export type TrapType = (typeof TrapType)[keyof typeof TrapType];

/**
 * Get the card kind from a raw type integer.
 */
export function getCardKind(typeValue: number): CardKind {
  // LINK monsters are always monster kind
  if (typeValue & MonsterTrait.LINK) {
    return "MONSTER";
  }

  // Check for pendulum (monster with pendulum)
  if (typeValue & MonsterTrait.PENDULUM) {
    return "MONSTER";
  }

  // Check for XYZ (monster)
  if (typeValue & MonsterTrait.XYZ) {
    return "MONSTER";
  }

  // Check for Synchro (monster)
  if (typeValue & MonsterTrait.SYNCHRO) {
    return "MONSTER";
  }

  // Check for Fusion (monster) - but also ritual can be spell
  if (typeValue & MonsterTrait.FUSION) {
    // Could be monster fusion or ritual spell
    // If it has ritual + effect + fusion but no other monster traits, might be ritual spell
    // For now, treat fusion as monster unless it's purely a ritual card
    if (typeValue & (MonsterTrait.RITUAL | MonsterTrait.NORMAL | MonsterTrait.EFFECT)) {
      return "MONSTER";
    }
    return "MONSTER";
  }

  // Check for spell bits (not in monster context)
  // Spell cards typically don't have monster trait bits like EFFECT (0x2) alone
  if (typeValue & (SpellType.QUICK_PLAY | SpellType.EQUIP | SpellType.FIELD)) {
    return "SPELL";
  }

  // Ritual spell or monster
  if (typeValue & MonsterTrait.RITUAL) {
    // If it has NORMAL or EFFECT, it's likely a ritual monster
    // Pure ritual without monster traits is a ritual spell
    if (typeValue & (MonsterTrait.NORMAL | MonsterTrait.EFFECT | MonsterTrait.FUSION)) {
      return "MONSTER";
    }
    return "SPELL";
  }

  // Normal monster (type = 1)
  if (typeValue === MonsterTrait.NORMAL) {
    return "MONSTER";
  }

  // Token monster (type = 8) — special case, no other monster bits needed
  if (typeValue === MonsterTrait.TOKEN) {
    return "MONSTER";
  }

  // Effect monster (type = 2) or other monster traits
  if (typeValue & (MonsterTrait.EFFECT | MonsterTrait.TUNER | MonsterTrait.GEMINI |
                   MonsterTrait.FLIP | MonsterTrait.TOON | MonsterTrait.SPIRIT |
                   MonsterTrait.UNION | MonsterTrait.DUAL)) {
    return "MONSTER";
  }

  // If we get here, try to distinguish spell vs trap
  // Continuous (0x200) can be either, but typically:
  // - If no monster traits and has spell-like bits → SPELL or TRAP
  // For now, default to SPELL if continuous only
  if (typeValue === MonsterTrait.RITUAL) {
    return "SPELL";
  }

  // Default unknown
  return "UNKNOWN";
}

/**
 * Get monster traits from a type value.
 * Returns only traits that are applicable for monsters.
 */
export function getMonsterTraits(typeValue: number): number {
  const traits: number[] = [];

  // If it's not a monster kind, return empty
  if (getCardKind(typeValue) !== "MONSTER") {
    return 0;
  }

  // Add each applicable trait
  if (typeValue & MonsterTrait.NORMAL) traits.push(MonsterTrait.NORMAL);
  if (typeValue & MonsterTrait.EFFECT) traits.push(MonsterTrait.EFFECT);
  if (typeValue & MonsterTrait.FUSION) traits.push(MonsterTrait.FUSION);
  if (typeValue & MonsterTrait.TOKEN) traits.push(MonsterTrait.TOKEN);
  if (typeValue & MonsterTrait.TRAP_MONSTER) traits.push(MonsterTrait.TRAP_MONSTER);
  if (typeValue & MonsterTrait.RITUAL) traits.push(MonsterTrait.RITUAL);
  if (typeValue & MonsterTrait.GEMINI) traits.push(MonsterTrait.GEMINI);
  if (typeValue & MonsterTrait.SYNCHRO) traits.push(MonsterTrait.SYNCHRO);
  if (typeValue & MonsterTrait.FLIP) traits.push(MonsterTrait.FLIP);
  if (typeValue & MonsterTrait.TOON) traits.push(MonsterTrait.TOON);
  if (typeValue & MonsterTrait.SPIRIT) traits.push(MonsterTrait.SPIRIT);
  if (typeValue & MonsterTrait.UNION) traits.push(MonsterTrait.UNION);
  if (typeValue & MonsterTrait.DUAL) traits.push(MonsterTrait.DUAL);
  if (typeValue & MonsterTrait.TUNER) traits.push(MonsterTrait.TUNER);
  if (typeValue & MonsterTrait.SYNCHRO_TUNER) traits.push(MonsterTrait.SYNCHRO_TUNER);
  if (typeValue & MonsterTrait.XYZ) traits.push(MonsterTrait.XYZ);
  if (typeValue & MonsterTrait.XYZ_TUNER) traits.push(MonsterTrait.XYZ_TUNER);
  if (typeValue & MonsterTrait.PENDULUM) traits.push(MonsterTrait.PENDULUM);
  if (typeValue & MonsterTrait.LINK) traits.push(MonsterTrait.LINK);

  // OR all traits together
  return traits.reduce((acc, t) => acc | t, 0);
}

/**
 * Get the spell subtype if applicable.
 */
export function getSpellType(typeValue: number): number | null {
  if (getCardKind(typeValue) !== "SPELL") {
    return null;
  }

  let subtype = 0;
  if (typeValue & SpellType.QUICK_PLAY) subtype |= SpellType.QUICK_PLAY;
  if (typeValue & SpellType.EQUIP) subtype |= SpellType.EQUIP;
  if (typeValue & SpellType.CONTINUOUS) subtype |= SpellType.CONTINUOUS;
  if (typeValue & SpellType.FIELD) subtype |= SpellType.FIELD;
  if (typeValue & MonsterTrait.RITUAL) subtype |= SpellType.RITUAL;

  // NORMAL spell has no special bit
  if (subtype === 0 && typeValue === MonsterTrait.RITUAL) {
    return SpellType.NORMAL;
  }

  return subtype || null;
}

/**
 * Get the trap subtype if applicable.
 */
export function getTrapType(typeValue: number): number | null {
  if (getCardKind(typeValue) !== "TRAP") {
    return null;
  }

  let subtype = 0;
  if (typeValue & TrapType.CONTINUOUS) subtype |= TrapType.CONTINUOUS;
  if (typeValue & TrapType.COUNTER) subtype |= TrapType.COUNTER;

  // Normal trap has no special bit
  if (subtype === 0) {
    return TrapType.NORMAL;
  }

  return subtype;
}

/**
 * Decode result with unknown bits tracking.
 */
export interface TypeDecodeResult {
  cardKind: CardKind;
  /** OR of all decoded trait bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  traits: string[];
  rawValue: number;
  registry: string;
}

/**
 * Decode a card type field into structured information.
 */
export function decodeType(typeValue: number): TypeDecodeResult {
  const cardKind = getCardKind(typeValue);
  const decodedBits: number[] = [];

  // Decode monster traits
  if (cardKind === "MONSTER") {
    if (typeValue & MonsterTrait.NORMAL) decodedBits.push(MonsterTrait.NORMAL);
    if (typeValue & MonsterTrait.EFFECT) decodedBits.push(MonsterTrait.EFFECT);
    if (typeValue & MonsterTrait.FUSION) decodedBits.push(MonsterTrait.FUSION);
    if (typeValue & MonsterTrait.TOKEN) decodedBits.push(MonsterTrait.TOKEN);
    if (typeValue & MonsterTrait.TRAP_MONSTER) decodedBits.push(MonsterTrait.TRAP_MONSTER);
    if (typeValue & MonsterTrait.RITUAL) decodedBits.push(MonsterTrait.RITUAL);
    if (typeValue & MonsterTrait.GEMINI) decodedBits.push(MonsterTrait.GEMINI);
    if (typeValue & MonsterTrait.SYNCHRO) decodedBits.push(MonsterTrait.SYNCHRO);
    if (typeValue & MonsterTrait.FLIP) decodedBits.push(MonsterTrait.FLIP);
    if (typeValue & MonsterTrait.TOON) decodedBits.push(MonsterTrait.TOON);
    if (typeValue & MonsterTrait.SPIRIT) decodedBits.push(MonsterTrait.SPIRIT);
    if (typeValue & MonsterTrait.UNION) decodedBits.push(MonsterTrait.UNION);
    if (typeValue & MonsterTrait.DUAL) decodedBits.push(MonsterTrait.DUAL);
    if (typeValue & MonsterTrait.TUNER) decodedBits.push(MonsterTrait.TUNER);
    if (typeValue & MonsterTrait.SYNCHRO_TUNER) decodedBits.push(MonsterTrait.SYNCHRO_TUNER);
    if (typeValue & MonsterTrait.XYZ) decodedBits.push(MonsterTrait.XYZ);
    if (typeValue & MonsterTrait.XYZ_TUNER) decodedBits.push(MonsterTrait.XYZ_TUNER);
    if (typeValue & MonsterTrait.PENDULUM) decodedBits.push(MonsterTrait.PENDULUM);
    if (typeValue & MonsterTrait.LINK) decodedBits.push(MonsterTrait.LINK);
  } else if (cardKind === "SPELL") {
    if (typeValue & SpellType.NORMAL) decodedBits.push(SpellType.NORMAL);
    if (typeValue & SpellType.QUICK_PLAY) decodedBits.push(SpellType.QUICK_PLAY);
    if (typeValue & SpellType.EQUIP) decodedBits.push(SpellType.EQUIP);
    if (typeValue & SpellType.CONTINUOUS) decodedBits.push(SpellType.CONTINUOUS);
    if (typeValue & SpellType.FIELD) decodedBits.push(SpellType.FIELD);
    if (typeValue & SpellType.RITUAL) decodedBits.push(SpellType.RITUAL);
  } else if (cardKind === "TRAP") {
    if (typeValue & TrapType.NORMAL) decodedBits.push(TrapType.NORMAL);
    if (typeValue & TrapType.CONTINUOUS) decodedBits.push(TrapType.CONTINUOUS);
    if (typeValue & TrapType.COUNTER) decodedBits.push(TrapType.COUNTER);
  }

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = typeValue & ~decodedOr;

  return {
    cardKind,
    decodedBits: decodedOr,
    unknownBits,
    traits: decodedBits.map(bitToName),
    rawValue: typeValue,
    registry: CARD_TYPE_VERSION,
  };
}

/**
 * Convert a type bit to its name string.
 */
export function bitToName(bit: number): string {
  switch (bit) {
    // Card kinds (for reference, not usually in traits)
    // Monster traits
    case MonsterTrait.NORMAL: return "NORMAL";
    case MonsterTrait.EFFECT: return "EFFECT";
    case MonsterTrait.FUSION: return "FUSION";
    case MonsterTrait.TOKEN: return "TOKEN";
    case MonsterTrait.TRAP_MONSTER: return "TRAP_MONSTER";
    case MonsterTrait.RITUAL: return "RITUAL";
    case MonsterTrait.GEMINI: return "GEMINI";
    case MonsterTrait.SYNCHRO: return "SYNCHRO";
    case MonsterTrait.FLIP: return "FLIP";
    case MonsterTrait.TOON: return "TOON";
    case MonsterTrait.SPIRIT: return "SPIRIT";
    case MonsterTrait.UNION: return "UNION";
    case MonsterTrait.DUAL: return "DUAL";
    case MonsterTrait.TUNER: return "TUNER";
    case MonsterTrait.SYNCHRO_TUNER: return "SYNCHRO_TUNER";
    case MonsterTrait.XYZ: return "XYZ";
    case MonsterTrait.XYZ_TUNER: return "XYZ_TUNER";
    case MonsterTrait.PENDULUM: return "PENDULUM";
    case MonsterTrait.LINK: return "LINK";
    // Spell types
    case SpellType.NORMAL: return "NORMAL";
    case SpellType.QUICK_PLAY: return "QUICK_PLAY";
    case SpellType.EQUIP: return "EQUIP";
    case SpellType.CONTINUOUS: return "CONTINUOUS";
    case SpellType.FIELD: return "FIELD";
    case SpellType.RITUAL: return "RITUAL";
    // Trap types
    case TrapType.NORMAL: return "NORMAL";
    case TrapType.COUNTER: return "COUNTER";
    default: return `UNKNOWN_${bit.toString(16)}`;
  }
}
