/**
 * Card normalization module.
 *
 * Combines decoders to transform raw CDB rows into normalized card records.
 */

import type { RawCardRows, RawTextsRow } from "../cdb/rawTypes.js";
import type { NormalizationContext } from "../application/types.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

import {
  decodeType,
  type TypeDecodeResult,
} from "../registry/cardTypes.v1.js";

import {
  decodeAttribute,
} from "../registry/attributes.v1.js";

import {
  decodeMonsterType,
} from "../registry/monsterTypes.v1.js";

import {
  decodeProgression,
} from "../registry/progression.v1.js";

import {
  decodeStat,
  STATS_VERSION,
  decodeDefense,
} from "../registry/stats.v1.js";

import {
  decodeLinkMarkers,
} from "../registry/linkMarkers.v1.js";

import {
  unpackSetcode,
} from "../registry/setcodes.v1.js";

import {
  decodeAvailability,
} from "../registry/availability.v1.js";

import {
  decodeCategory,
} from "../registry/categories.v1.js";

/**
 * Normalized card record.
 * This is the internal representation used by profile mappers.
 */
export interface NormalizedCard {
  /** Card ID (from datas.id / texts.id) */
  id: string;
  /** Card name (from texts.name) */
  name: string | null;
  /** Raw description (from texts.desc) */
  description: string | null;
  /** Auxiliary strings (texts.str1-str16) */
  auxiliaryStrings: Array<{ index: number; value: string | null }>;
  /** Decoded type information */
  type: TypeDecodeResult;
  /** Decoded attribute (monsters only) */
  attribute: ReturnType<typeof decodeAttribute> | null;
  /** Decoded monster type/race (monsters only) */
  monsterType: ReturnType<typeof decodeMonsterType> | null;
  /** Decoded level/rank/link/pendulum */
  progression: ReturnType<typeof decodeProgression>;
  /** Decoded attack */
  attack: ReturnType<typeof decodeStat>;
  /** Decoded defense or link markers */
  defense: ReturnType<typeof decodeStat>;
  /** Decoded link markers (links only) */
  linkMarkers: ReturnType<typeof decodeLinkMarkers> | null;
  /** Unpacked setcodes */
  setcodes: ReturnType<typeof unpackSetcode>;
  /** Decoded availability */
  availability: ReturnType<typeof decodeAvailability>;
  /** Decoded category flags */
  category: ReturnType<typeof decodeCategory>;
  /** Alias (from datas.alias) */
  alias: string | null;
  /** Source data for diagnostics */
  source: {
    databasePath: string;
    dataOrdinal: number | null;
    textOrdinal: number | null;
  };
}

/**
 * Normalize a raw card row into a normalized card.
 */
export function normalizeCard(
  rows: RawCardRows,
  context: NormalizationContext,
  diagnostics: DiagnosticCollector,
): NormalizedCard {
  const datas = rows.datas;
  const texts = rows.texts;

  const id = datas?.id ?? texts?.id ?? "0";

  // Parse numeric values from decimal strings
  const typeValue = datas !== null && datas.type !== null ? parseInt(datas.type, 10) : 0;
  const raceValue = datas !== null && datas.race !== null ? parseInt(datas.race, 10) : 0;
  const attributeValue = datas !== null && datas.attribute !== null ? parseInt(datas.attribute, 10) : 0;
  const levelValue = datas !== null && datas.level !== null ? parseInt(datas.level, 10) : 0;
  const atkValue = datas !== null && datas.atk !== null ? parseInt(datas.atk, 10) : 0;
  const defValue = datas !== null && datas.def !== null ? parseInt(datas.def, 10) : 0;
  const otValue = datas !== null && datas.ot !== null ? parseInt(datas.ot, 10) : 0;
  const categoryValue = datas !== null && datas.category !== null ? parseInt(datas.category, 10) : 0;
  const setcodeValue = datas !== null && datas.setcode !== null ? parseInt(datas.setcode, 10) : 0;
  const aliasValue = datas !== null && datas.alias !== null ? parseInt(datas.alias, 10) : 0;

  // Decode type
  const type = decodeType(typeValue);

  // Track unknown bits
  if (type.unknownBits !== 0) {
    diagnostics.warning(DiagnosticCode.UNKNOWN_TYPE_BITS, `Unknown type bits: 0x${type.unknownBits.toString(16)}`, {
      source: { database: context.sourceNamespace, cardId: id },
      rawValue: typeValue,
      details: { unknownBits: `0x${type.unknownBits.toString(16)}` },
    });
  }

  // Decode attribute (monsters only)
  let attribute: ReturnType<typeof decodeAttribute> | null = null;
  if (type.cardKind === "MONSTER" && attributeValue !== 0) {
    attribute = decodeAttribute(attributeValue);
    if (attribute.unknownBits !== 0) {
      diagnostics.warning(DiagnosticCode.UNKNOWN_ATTRIBUTE_BITS, `Unknown attribute bits: 0x${attribute.unknownBits.toString(16)}`, {
        source: { database: context.sourceNamespace, cardId: id },
        rawValue: attributeValue,
      });
    }
  }

  // Decode monster type (monsters only)
  let monsterType: ReturnType<typeof decodeMonsterType> | null = null;
  if (type.cardKind === "MONSTER" && raceValue !== 0) {
    monsterType = decodeMonsterType(raceValue);
    if (monsterType.unknownBits !== 0) {
      diagnostics.warning(DiagnosticCode.UNKNOWN_MONSTER_TYPE_BITS, `Unknown monster type bits: 0x${monsterType.unknownBits.toString(16)}`, {
        source: { database: context.sourceNamespace, cardId: id },
        rawValue: raceValue,
      });
    }
  }

  // Decode progression (level/rank/link/pendulum)
  const progression = decodeProgression(levelValue, typeValue);

  // Per INV-007: emit CONFLICTING_PROGRESSION_FLAGS as a warning (promoted to error in strict mode)
  if (progression.conflictingTypes.length > 0) {
    diagnostics.warning(
      DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS,
      `Conflicting progression bits in type field: ${progression.conflictingTypes.join(" + ")}`,
      {
        source: { database: context.sourceNamespace, cardId: id },
        // Retain exact raw decimal strings per spec.md:165
        rawValue: datas?.level ?? "0",
        details: {
          // Retain exact raw type string per spec.md:117
          rawType: datas?.type ?? "0",
          conflictingTypes: progression.conflictingTypes,
        },
      }
    );
  }

  if (progression.unknownBits !== 0) {
    diagnostics.warning(DiagnosticCode.INVALID_PACKED_LEVEL, `Invalid packed level: unknown bits`, {
      source: { database: context.sourceNamespace, cardId: id },
      rawValue: levelValue,
    });
  }

  // Decode attack
  const attack = decodeStat(atkValue);

  // Decode defense or link markers
  let defense: ReturnType<typeof decodeStat>;
  let linkMarkers: ReturnType<typeof decodeLinkMarkers> | null = null;
  const isLink = (typeValue & 0x20000000) !== 0;

  if (isLink) {
    defense = {
      value: null,
      display: null,
      rawValue: defValue,
      isUnknown: false,
      registry: STATS_VERSION,
    };
    linkMarkers = decodeLinkMarkers(defValue);
    if (linkMarkers.unknownBits !== 0) {
      diagnostics.warning(DiagnosticCode.UNKNOWN_LINK_MARKER_BITS, `Unknown link marker bits: 0x${linkMarkers.unknownBits.toString(16)}`, {
        source: { database: context.sourceNamespace, cardId: id },
        rawValue: defValue,
      });
    }
  } else {
    defense = decodeDefense(defValue, typeValue);
  }

  // Decode setcodes
  const setcodes = unpackSetcode(setcodeValue);

  // Decode availability
  const availability = decodeAvailability(otValue);
  if (availability.unknownBits !== 0) {
    diagnostics.warning(DiagnosticCode.UNKNOWN_AVAILABILITY_BITS, `Unknown availability bits: 0x${availability.unknownBits.toString(16)}`, {
      source: { database: context.sourceNamespace, cardId: id },
      rawValue: otValue,
    });
  }

  // Decode category
  const category = decodeCategory(categoryValue);
  if (category.unknownBits !== 0) {
    diagnostics.warning(DiagnosticCode.UNKNOWN_CATEGORY_BITS, `Unknown category bits: 0x${category.unknownBits.toString(16)}`, {
      source: { database: context.sourceNamespace, cardId: id },
      rawValue: categoryValue,
    });
  }

  // Collect auxiliary strings
  const auxiliaryStrings: Array<{ index: number; value: string | null }> = [];
  if (texts) {
    for (let i = 1; i <= 16; i++) {
      const key = `str${i}` as keyof RawTextsRow;
      auxiliaryStrings.push({
        index: i,
        value: texts[key] ?? null,
      });
    }
  }

  return {
    id,
    name: texts?.name ?? null,
    description: texts?.desc ?? null,
    auxiliaryStrings,
    type,
    attribute,
    monsterType,
    progression,
    attack,
    defense,
    linkMarkers,
    setcodes,
    availability,
    category,
    alias: aliasValue !== 0 ? String(aliasValue) : null,
    source: {
      databasePath: context.sourceNamespace,
      dataOrdinal: rows.dataOrdinal,
      textOrdinal: rows.textOrdinal,
    },
  };
}

/**
 * Check if card is incomplete (missing datas or texts).
 */
export function isCompleteCard(rows: RawCardRows): boolean {
  return rows.datas !== null && rows.texts !== null;
}

/**
 * Get diagnostics for incomplete cards.
 */
export function getIncompleteDiagnostics(
  rows: RawCardRows,
  diagnostics: DiagnosticCollector,
): void {
  if (rows.datas === null) {
    const id = rows.texts?.id ?? "unknown";
    diagnostics.warning(DiagnosticCode.MISSING_DATA_ROW, `No datas row for card ${id}`, {
      source: { database: "unknown", cardId: id, table: "texts" },
    });
  }
  if (rows.texts === null) {
    const id = rows.datas?.id ?? "unknown";
    diagnostics.warning(DiagnosticCode.MISSING_TEXT_ROW, `No texts row for card ${id}`, {
      source: { database: "unknown", cardId: id, table: "datas" },
    });
  }
}
