/**
 * Source profile mapper.
 *
 * Transforms normalized cards into the ygo.card-source/1 schema format.
 * This is the provenance-rich source document for the YGO-DSL translation pipeline.
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";
import type { RawCardRows, RawDatasRow, RawTextsRow } from "../cdb/rawTypes.js";

/**
 * Convert raw datas row to a plain record.
 */
function convertRawDatasToRecord(row: RawDatasRow): Record<string, string | null> {
  return {
    id: row.id,
    ot: row.ot,
    alias: row.alias,
    setcode: row.setcode,
    type: row.type,
    atk: row.atk,
    def: row.def,
    level: row.level,
    race: row.race,
    attribute: row.attribute,
    category: row.category,
  };
}

/**
 * Convert raw texts row to a plain record.
 */
function convertRawTextsToRecord(row: RawTextsRow): Record<string, string | null> {
  return {
    id: row.id,
    name: row.name,
    desc: row.desc,
    str1: row.str1,
    str2: row.str2,
    str3: row.str3,
    str4: row.str4,
    str5: row.str5,
    str6: row.str6,
    str7: row.str7,
    str8: row.str8,
    str9: row.str9,
    str10: row.str10,
    str11: row.str11,
    str12: row.str12,
    str13: row.str13,
    str14: row.str14,
    str15: row.str15,
    str16: row.str16,
  };
}

/**
 * Source profile output schema (ygo.card-source/1).
 */
export interface SourceProfileOutput {
  schema: "ygo.card-source/1";
  sourceRevisionId: string;
  identity: {
    externalIds: Array<{ namespace: string; value: string }>;
    aliasOf: string | null;
  };
  locale: string;
  printed: {
    name: string | null;
    cardKind: string;
    traits: string[];
    monster: {
      monsterType: string | null;
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
    } | null;
  };
  text: {
    raw: string | null;
    sections: {
      material: string | null;
      pendulumEffect: string | null;
      monsterEffect: string | null;
    };
    sourceSpans: Array<{
      text: string;
      start: number;
      end: number;
      basis: string;
    }>;
  };
  simulatorSource: {
    ecosystem: "EDOPRO";
    database: {
      fileName: string;
      sha256: string;
    };
    rawRows: {
      datas: Record<string, string | null> | null;
      texts: Record<string, string | null> | null;
    };
    decoded: {
      setcodes: Array<{ code: number; name?: string }>;
      availability: Array<{ code: string }>;
      categoryFlags: Array<{ code: string }>;
      auxiliaryStrings: Array<{ index: number; value: string | null }>;
    };
  };
  references: {
    scripts: never[];
    rulings: never[];
  };
  coverage: {
    status: "SOURCE_ONLY";
    assumptions: string[];
    unsupported: string[];
  };
  provenance: {
    converter: "cdb-to-json/2.0.0";
    normalizationRegistry: "cdb-normalization/1";
    conversionOptionsHash: string;
  };
  diagnostics: Array<{
    code: string;
    severity: string;
    message: string;
  }>;
}

/**
 * Options for source profile mapping.
 */
export interface SourceProfileOptions {
  locale: string;
  sourceNamespace: string;
  databaseSha256: string;
  databaseFileName: string;
  sourceRevisionId: string;
  conversionOptionsHash: string;
  setcodeRegistry?: Map<number, string>;
  rawRows?: RawCardRows;
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
}

/**
 * Map a normalized card to source profile format.
 */
export function mapCardToSource(
  card: NormalizedCard,
  options: SourceProfileOptions,
): SourceProfileOutput {
  const {
    locale,
    sourceNamespace,
    databaseSha256,
    databaseFileName,
    sourceRevisionId,
    conversionOptionsHash,
    setcodeRegistry,
    rawRows,
    diagnostics = [],
  } = options;

  // Build identity
  const externalIds = [{ namespace: sourceNamespace, value: card.id }];

  // Build printed section
  const printed = buildPrintedSection(card);

  // Build text sections
  const text = buildTextSection(card);

  // Build simulator source
  const simulatorSource = buildSimulatorSource(card, {
    databaseFileName,
    databaseSha256,
    setcodeRegistry,
    rawRows,
  });

  // Build provenance
  const provenance = {
    converter: "cdb-to-json/2.0.0" as const,
    normalizationRegistry: "cdb-normalization/1" as const,
    conversionOptionsHash,
  };

  return {
    schema: "ygo.card-source/1",
    sourceRevisionId,
    identity: {
      externalIds,
      aliasOf: card.alias,
    },
    locale,
    printed,
    text,
    simulatorSource,
    references: {
      scripts: [],
      rulings: [],
    },
    coverage: {
      status: "SOURCE_ONLY",
      assumptions: [],
      unsupported: [],
    },
    provenance,
    diagnostics,
  };
}

/**
 * Build the printed section with normalized card facts.
 */
function buildPrintedSection(card: NormalizedCard): SourceProfileOutput["printed"] {
  let monster: SourceProfileOutput["printed"]["monster"] = null;

  if (card.type.cardKind === "MONSTER") {
    monster = {
      monsterType: card.monsterType?.monsterTypes[0] ?? null,
      attribute: card.attribute?.attributes[0] ?? null,
      level: card.progression.level,
      rank: card.progression.rank,
      linkRating: card.progression.linkRating,
      attack: card.attack.value ?? null,
      defense: card.defense.value ?? null,
      pendulum: card.progression.pendulum,
    };
  }

  return {
    name: card.name,
    cardKind: card.type.cardKind,
    traits: card.type.traits,
    monster,
  };
}

/**
 * Build the text section with raw text and sections.
 */
function buildTextSection(card: NormalizedCard): SourceProfileOutput["text"] {
  // TODO: Implement conservative text segmentation
  // For now, just return the raw text with empty sections
  return {
    raw: card.description,
    sections: {
      material: null,
      pendulumEffect: null,
      monsterEffect: null,
    },
    sourceSpans: [],
  };
}

/**
 * Build the simulator source section with raw rows and decoded values.
 */
function buildSimulatorSource(
  card: NormalizedCard,
  options: {
    databaseFileName: string;
    databaseSha256: string;
    setcodeRegistry?: Map<number, string>;
    rawRows?: RawCardRows;
  },
): SourceProfileOutput["simulatorSource"] {
  const { databaseFileName, databaseSha256, setcodeRegistry, rawRows } = options;

  // Build decoded setcodes
  const setcodes = card.setcodes.setcodes.map((sc) => ({
    code: sc.code,
    name: setcodeRegistry?.get(sc.code),
  }));

  // Build decoded availability
  const availability = card.availability.codes.map((code) => ({ code }));

  // Build decoded category flags
  const categoryFlags = card.category.codes.map((code) => ({ code }));

  // Build auxiliary strings
  const auxiliaryStrings = card.auxiliaryStrings.map((as) => ({
    index: as.index,
    value: as.value,
  }));

  return {
    ecosystem: "EDOPRO",
    database: {
      fileName: databaseFileName,
      sha256: databaseSha256,
    },
    rawRows: {
      datas: rawRows?.datas ? convertRawDatasToRecord(rawRows.datas) : null,
      texts: rawRows?.texts ? convertRawTextsToRecord(rawRows.texts) : null,
    },
    decoded: {
      setcodes,
      availability,
      categoryFlags,
      auxiliaryStrings,
    },
  };
}

/**
 * Create a default source revision ID for testing.
 */
export function createDefaultSourceRevisionId(): string {
  return "sha256:0000000000000000000000000000000000000000000000000000000000000000";
}

/**
 * Create a default conversion options hash for testing.
 */
export function createDefaultConversionOptionsHash(): string {
  return "sha256:0000000000000000000000000000000000000000000000000000000000000000";
}
