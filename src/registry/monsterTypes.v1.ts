/**
 * Monster type (race) registry v1 - defines monster type bitflags.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * Monster types are stored in the `race` field of datas table.
 * Each type is a single bit. A monster can have multiple types.
 */

export const MONSTER_TYPE_VERSION = "cdb-normalization/1" as const;

/**
 * Monster type (race) bitflags.
 */
export const MonsterType = {
  WARRIOR: 0x1,
  SPELLCASTER: 0x2,
  FAIRY: 0x4,
  FIEND: 0x8,
  ZOMBIE: 0x10,
  MACHINE: 0x20,
  AQUA: 0x40,
  PYRO: 0x80,
  ROCK: 0x100,
  WINDSPHYNX: 0x200,
  BEAST: 0x400,
  BEAST_WARRIOR: 0x800,
  DINOSAUR: 0x1000,
  FISH: 0x2000,
  SEA_SERPENT: 0x4000,
  REPTILE: 0x8000,
  PSYCHIC: 0x10000,
  DIVINE: 0x20000,
  CREATOR_GOD: 0x40000,
  WYRM: 0x80000,
  CYBERSE: 0x100000,
  // Note: There may be additional types in newer expansions
} as const;

export type MonsterType = (typeof MonsterType)[keyof typeof MonsterType];

/**
 * Decode result for monster type field.
 */
export interface MonsterTypeDecodeResult {
  /** Array of decoded type names */
  monsterTypes: string[];
  /** OR of all decoded type bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  rawValue: number;
  registry: string;
}

/**
 * Decode a monster type (race) field.
 */
export function decodeMonsterType(raceValue: number): MonsterTypeDecodeResult {
  const decodedBits: number[] = [];

  if (raceValue & MonsterType.WARRIOR) decodedBits.push(MonsterType.WARRIOR);
  if (raceValue & MonsterType.SPELLCASTER) decodedBits.push(MonsterType.SPELLCASTER);
  if (raceValue & MonsterType.FAIRY) decodedBits.push(MonsterType.FAIRY);
  if (raceValue & MonsterType.FIEND) decodedBits.push(MonsterType.FIEND);
  if (raceValue & MonsterType.ZOMBIE) decodedBits.push(MonsterType.ZOMBIE);
  if (raceValue & MonsterType.MACHINE) decodedBits.push(MonsterType.MACHINE);
  if (raceValue & MonsterType.AQUA) decodedBits.push(MonsterType.AQUA);
  if (raceValue & MonsterType.PYRO) decodedBits.push(MonsterType.PYRO);
  if (raceValue & MonsterType.ROCK) decodedBits.push(MonsterType.ROCK);
  if (raceValue & MonsterType.WINDSPHYNX) decodedBits.push(MonsterType.WINDSPHYNX);
  if (raceValue & MonsterType.BEAST) decodedBits.push(MonsterType.BEAST);
  if (raceValue & MonsterType.BEAST_WARRIOR) decodedBits.push(MonsterType.BEAST_WARRIOR);
  if (raceValue & MonsterType.DINOSAUR) decodedBits.push(MonsterType.DINOSAUR);
  if (raceValue & MonsterType.FISH) decodedBits.push(MonsterType.FISH);
  if (raceValue & MonsterType.SEA_SERPENT) decodedBits.push(MonsterType.SEA_SERPENT);
  if (raceValue & MonsterType.REPTILE) decodedBits.push(MonsterType.REPTILE);
  if (raceValue & MonsterType.PSYCHIC) decodedBits.push(MonsterType.PSYCHIC);
  if (raceValue & MonsterType.DIVINE) decodedBits.push(MonsterType.DIVINE);
  if (raceValue & MonsterType.CREATOR_GOD) decodedBits.push(MonsterType.CREATOR_GOD);
  if (raceValue & MonsterType.WYRM) decodedBits.push(MonsterType.WYRM);
  if (raceValue & MonsterType.CYBERSE) decodedBits.push(MonsterType.CYBERSE);

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = raceValue & ~decodedOr;

  return {
    monsterTypes: decodedBits.map(bitToName),
    decodedBits: decodedOr,
    unknownBits,
    rawValue: raceValue,
    registry: MONSTER_TYPE_VERSION,
  };
}

/**
 * Convert a monster type bit to its name string.
 */
export function bitToName(bit: number): string {
  switch (bit) {
    case MonsterType.WARRIOR: return "WARRIOR";
    case MonsterType.SPELLCASTER: return "SPELLCASTER";
    case MonsterType.FAIRY: return "FAIRY";
    case MonsterType.FIEND: return "FIEND";
    case MonsterType.ZOMBIE: return "ZOMBIE";
    case MonsterType.MACHINE: return "MACHINE";
    case MonsterType.AQUA: return "AQUA";
    case MonsterType.PYRO: return "PYRO";
    case MonsterType.ROCK: return "ROCK";
    case MonsterType.WINDSPHYNX: return "WINDSPHYNX";
    case MonsterType.BEAST: return "BEAST";
    case MonsterType.BEAST_WARRIOR: return "BEAST_WARRIOR";
    case MonsterType.DINOSAUR: return "DINOSAUR";
    case MonsterType.FISH: return "FISH";
    case MonsterType.SEA_SERPENT: return "SEA_SERPENT";
    case MonsterType.REPTILE: return "REPTILE";
    case MonsterType.PSYCHIC: return "PSYCHIC";
    case MonsterType.DIVINE: return "DIVINE";
    case MonsterType.CREATOR_GOD: return "CREATOR_GOD";
    case MonsterType.WYRM: return "WYRM";
    case MonsterType.CYBERSE: return "CYBERSE";
    default: return `UNKNOWN_${bit.toString(16)}`;
  }
}

/**
 * Get the primary monster type (first one found).
 * Returns null if no recognized type.
 */
export function getPrimaryMonsterType(raceValue: number): string | null {
  if (raceValue & MonsterType.WARRIOR) return "WARRIOR";
  if (raceValue & MonsterType.SPELLCASTER) return "SPELLCASTER";
  if (raceValue & MonsterType.FAIRY) return "FAIRY";
  if (raceValue & MonsterType.FIEND) return "FIEND";
  if (raceValue & MonsterType.ZOMBIE) return "ZOMBIE";
  if (raceValue & MonsterType.MACHINE) return "MACHINE";
  if (raceValue & MonsterType.AQUA) return "AQUA";
  if (raceValue & MonsterType.PYRO) return "PYRO";
  if (raceValue & MonsterType.ROCK) return "ROCK";
  if (raceValue & MonsterType.WINDSPHYNX) return "WINDSPHYNX";
  if (raceValue & MonsterType.BEAST) return "BEAST";
  if (raceValue & MonsterType.BEAST_WARRIOR) return "BEAST_WARRIOR";
  if (raceValue & MonsterType.DINOSAUR) return "DINOSAUR";
  if (raceValue & MonsterType.FISH) return "FISH";
  if (raceValue & MonsterType.SEA_SERPENT) return "SEA_SERPENT";
  if (raceValue & MonsterType.REPTILE) return "REPTILE";
  if (raceValue & MonsterType.PSYCHIC) return "PSYCHIC";
  if (raceValue & MonsterType.DIVINE) return "DIVINE";
  if (raceValue & MonsterType.CREATOR_GOD) return "CREATOR_GOD";
  if (raceValue & MonsterType.WYRM) return "WYRM";
  if (raceValue & MonsterType.CYBERSE) return "CYBERSE";
  return null;
}
