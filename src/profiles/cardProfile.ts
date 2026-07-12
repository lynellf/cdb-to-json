/**
 * Card profile mapper.
 *
 * Transforms normalized cards into the cdb.card/2 schema format.
 * This is the consumer-friendly card record format.
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";

/**
 * Card profile output schema (cdb.card/2).
 */
export interface CardProfileOutput {
  schema: "cdb.card/2";
  id: string;
  name: string | null;
  locale: string;
  cardKind: string;
  traits: string[];
  typeLine: {
    monsterType: string | null;
    monsterTypes: string[];
    abilities: string[];
    display: string | null;
  } | null;
  monster: MonsterSection | null;
  spell: SpellSection | null;
  trap: TrapSection | null;
  text: {
    raw: string | null;
    material: string | null;
    pendulumEffect: string | null;
    monsterEffect: string | null;
    spellTrapEffect: string | null;
    flavor: string | null;
    segmentation: string;
  };
  identity: {
    externalIds: Array<{ namespace: string; value: string }>;
    aliasOf: string | null;
    alternateArtworkOf: string | null;
  };
  archetypes: {
    codes: number[];
    resolved: string[];
    unresolved: number[];
  };
  simulator: {
    availability: {
      codes: string[];
      unknownBits: string;
    };
    categoryFlags: {
      codes: string[];
      unknownBits: string;
    };
    auxiliaryStrings: Array<{ index: number; value: string | null }>;
  };
  source: {
    kind: "EDOPRO_CDB";
    databaseSha256: string;
    databaseFileName: string;
    rowId: string;
    converter: "cdb-to-json/2.0.0";
    normalizationRegistry: string;
  };
  diagnostics: Array<{
    code: string;
    severity: string;
    message: string;
  }>;
}

/**
 * Monster section for monster cards.
 */
export interface MonsterSection {
  attribute: string | null;
  level: number | null;
  rank: number | null;
  linkRating: number | null;
  attack: number | null;
  defense: number | null;
  pendulum: {
    leftScale: number;
    rightScale: number;
  } | null;
  linkArrows: string[];
}

/**
 * Spell section for spell cards.
 */
export interface SpellSection {
  spellType: string;
}

/**
 * Trap section for trap cards.
 */
export interface TrapSection {
  trapType: string;
}

/**
 * Options for card profile mapping.
 */
export interface CardProfileOptions {
  locale: string;
  sourceNamespace: string;
  databaseSha256: string;
  databaseFileName: string;
  setcodeRegistry?: Map<number, string>;
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
}

/**
 * Map a normalized card to card profile format.
 */
export function mapCardToProfile(
  card: NormalizedCard,
  options: CardProfileOptions,
): CardProfileOutput {
  const { locale, sourceNamespace, databaseSha256, databaseFileName, setcodeRegistry, diagnostics = [] } = options;

  // Build identity
  const externalIds = [{ namespace: sourceNamespace, value: card.id }];

  // Build type line
  const typeLine = buildTypeLine(card);

  // Build archetypes
  const archetypes = buildArchetypes(card, setcodeRegistry);

  // Build simulator sections
  const simulator = buildSimulator(card);

  // Build card-kind-specific section
  let monster: MonsterSection | null = null;
  let spell: SpellSection | null = null;
  let trap: TrapSection | null = null;

  if (card.type.cardKind === "MONSTER") {
    monster = buildMonsterSection(card);
  } else if (card.type.cardKind === "SPELL") {
    spell = { spellType: getSpellTypeName(card) };
  } else if (card.type.cardKind === "TRAP") {
    trap = { trapType: getTrapTypeName(card) };
  }

  return {
    schema: "cdb.card/2",
    id: card.id,
    name: card.name,
    locale,
    cardKind: card.type.cardKind,
    traits: card.type.traits,
    typeLine,
    monster,
    spell,
    trap,
    text: {
      raw: card.description,
      material: null, // Would be filled by text segmentation
      pendulumEffect: null,
      monsterEffect: null,
      spellTrapEffect: null,
      flavor: null,
      segmentation: "UNSPLIT", // TODO: implement text segmentation
    },
    identity: {
      externalIds,
      aliasOf: card.alias,
      alternateArtworkOf: null,
    },
    archetypes,
    simulator,
    source: {
      kind: "EDOPRO_CDB",
      databaseSha256,
      databaseFileName,
      rowId: card.id,
      converter: "cdb-to-json/2.0.0",
      normalizationRegistry: "cdb-normalization/1",
    },
    diagnostics,
  };
}

/**
 * Build the type line for display.
 */
function buildTypeLine(card: NormalizedCard): CardProfileOutput["typeLine"] {
  if (card.type.cardKind !== "MONSTER") {
    // Spells and traps don't have monster types
    return null;
  }

  const monsterTypes = card.monsterType?.monsterTypes ?? [];
  const abilities = card.type.traits.filter((t) =>
    ["EFFECT", "FUSION", "RITUAL", "SYNCHRO", "XYZ", "LINK", "PENDULUM", "GEMINI", "FLIP", "TOON", "SPIRIT", "UNION", "DUAL", "TUNER"].includes(t)
  );

  const display = buildTypeDisplay(card, monsterTypes, abilities);

  return {
    monsterType: card.monsterType?.monsterTypes[0] ?? null,
    monsterTypes,
    abilities,
    display,
  };
}

/**
 * Build the display string for the type line.
 */
function buildTypeDisplay(
  card: NormalizedCard,
  _monsterTypes: string[],
  abilities: string[],
): string | null {
  const parts: string[] = [];

  if (card.monsterType?.monsterTypes[0]) {
    parts.push(card.monsterType.monsterTypes[0]);
  }

  parts.push(...abilities);

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" / ");
}

/**
 * Build the archetypes section.
 */
function buildArchetypes(
  card: NormalizedCard,
  setcodeRegistry?: Map<number, string>,
): CardProfileOutput["archetypes"] {
  const codes: number[] = [];
  const resolved: string[] = [];
  const unresolved: number[] = [];

  for (const setcode of card.setcodes.setcodes) {
    codes.push(setcode.code);

    if (setcodeRegistry?.has(setcode.code)) {
      resolved.push(setcodeRegistry.get(setcode.code)!);
    } else {
      unresolved.push(setcode.code);
    }
  }

  return { codes, resolved, unresolved };
}

/**
 * Build the simulator section.
 */
function buildSimulator(card: NormalizedCard): CardProfileOutput["simulator"] {
  return {
    availability: {
      codes: card.availability.codes,
      unknownBits: `0x${card.availability.unknownBits.toString(16)}`,
    },
    categoryFlags: {
      codes: card.category.codes,
      unknownBits: `0x${card.category.unknownBits.toString(16)}`,
    },
    auxiliaryStrings: card.auxiliaryStrings,
  };
}

/**
 * Build the monster section.
 */
function buildMonsterSection(card: NormalizedCard): MonsterSection {
  const attack = card.attack.value ?? null;
  let defense: number | null = null;
  let linkArrows: string[] = [];

  if (card.linkMarkers) {
    linkArrows = card.linkMarkers.markers;
  } else if (card.defense.value !== null) {
    defense = card.defense.value;
  }

  return {
    attribute: card.attribute?.attributes[0] ?? null,
    level: card.progression.level,
    rank: card.progression.rank,
    linkRating: card.progression.linkRating,
    attack,
    defense,
    pendulum: card.progression.pendulum,
    linkArrows,
  };
}

/**
 * Get spell type name.
 */
function getSpellTypeName(card: NormalizedCard): string {
  const traits = card.type.traits;

  if (traits.includes("QUICK_PLAY")) return "QUICK_PLAY";
  if (traits.includes("EQUIP")) return "EQUIP";
  if (traits.includes("CONTINUOUS")) return "CONTINUOUS";
  if (traits.includes("FIELD")) return "FIELD";
  if (traits.includes("RITUAL")) return "RITUAL";

  return "NORMAL";
}

/**
 * Get trap type name.
 */
function getTrapTypeName(card: NormalizedCard): string {
  const traits = card.type.traits;

  if (traits.includes("COUNTER")) return "COUNTER";
  if (traits.includes("CONTINUOUS")) return "CONTINUOUS";

  return "NORMAL";
}
