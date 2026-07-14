/**
 * Source document mapper.
 *
 * Transforms normalized cards into the ygo.card-source/1 schema format.
 * This is the provenance-rich source document for the YGO-DSL translation pipeline.
 *
 * @module application/toSourceDocument
 */

import { normalizeText, segmentCardText, getSourceSpans, buildTextSections, type TextSlice } from "../text/index.js";
import type { NormalizedCard } from "../normalization/normalizeCard.js";
import type { RawCardRows } from "../cdb/rawTypes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source profile output schema (ygo.card-source/1).
 */
export interface CardSourceDocument {
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
    normalized: string | null;
    normalizationVersion: "text-normalization/1";
    spansBasis: "utf-16-code-units",
    offsetEncoding: "utf-16-code-units";
    sections: {
      material: TextSlice | null;
      pendulumEffect: TextSlice | null;
      monsterEffect: TextSlice | null;
      spellTrapEffect: TextSlice | null;
      flavor: TextSlice | null;
      unclassified: readonly TextSlice[];
      segmentation: "EXACT_MARKERS" | "FRAME_RULE" | "PARTIAL" | "UNSPLIT";
    };
    sourceSpans: readonly TextSlice[];
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
    severity: "INFO" | "WARNING" | "ERROR";
    message: string;
  }>;
}

/**
 * Result of converting a card to source document format.
 */
export interface SourceDocumentResult {
  ok: true;
  value: CardSourceDocument;
  diagnostics: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "ERROR";
    message: string;
  }>;
}

/**
 * Context for source document conversion.
 */
export interface ToSourceDocumentContext {
  locale: string;
  sourceNamespace: string;
  databaseFileName: string;
  databaseSha256: string;
  sourceRevisionId: string;
  conversionOptionsHash: string;
  registryHashes?: {
    setcode?: Map<number, string>;
    availability?: Map<number, string>;
  };
  cardDiagnostics?: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "ERROR";
    message: string;
  }>;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Convert a normalized card to a source profile document.
 *
 * @param card Normalized card record
 * @param rawRows Raw CDB row data
 * @param context Conversion context
 * @returns Source document result
 */
export function toSourceDocument(
  card: NormalizedCard,
  rawRows: RawCardRows | null,
  context: ToSourceDocumentContext,
): SourceDocumentResult {
  const diagnostics: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "ERROR";
    message: string;
  }> = [];

  // Collect card-level diagnostics
  if (context.cardDiagnostics) {
    diagnostics.push(...context.cardDiagnostics);
  }

  // Normalize text
  const normalization = normalizeText(card.description ?? null);

  // Segment text conservatively
  const segmentation = segmentCardText(
    card.description ?? null,
    normalization.normalized,
    card.type.cardKind,
    card.type.traits,
  );

  // Build identity
  const externalIds = [{ namespace: context.sourceNamespace, value: card.id }];

  // Build printed section
  const printed = buildPrintedSection(card);

  // Build simulator source
  const simulatorSource = buildSimulatorSource(card, rawRows, context);

  // Build coverage
  const coverage = buildCoverage(card, diagnostics);

  // Build provenance
  const provenance = {
    converter: "cdb-to-json/2.0.0" as const,
    normalizationRegistry: "cdb-normalization/1" as const,
    conversionOptionsHash: context.conversionOptionsHash,
  };

  const document: CardSourceDocument = {
    schema: "ygo.card-source/1",
    sourceRevisionId: context.sourceRevisionId,
    identity: {
      externalIds,
      aliasOf: card.alias,
    },
    locale: context.locale,
    printed,
    text: {
      raw: normalization.raw,
      normalized: normalization.normalized,
      normalizationVersion: normalization.normalizationVersion,
      spansBasis: "utf-16-code-units",
      offsetEncoding: "utf-16-code-units",
      sections: buildTextSections(segmentation),
      sourceSpans: getSourceSpans(segmentation),
    },
    simulatorSource,
    references: {
      scripts: [],
      rulings: [],
    },
    coverage,
    provenance,
    diagnostics,
  };

  return {
    ok: true,
    value: document,
    diagnostics,
  };
}

/**
 * Build the printed section with normalized card facts.
 */
function buildPrintedSection(card: NormalizedCard): CardSourceDocument["printed"] {
  let monster: CardSourceDocument["printed"]["monster"] = null;

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
 * Build the simulator source section with raw rows and decoded values.
 */
function buildSimulatorSource(
  card: NormalizedCard,
  rawRows: RawCardRows | null,
  context: ToSourceDocumentContext,
): CardSourceDocument["simulatorSource"] {
  const { registryHashes } = context;

  // Build decoded setcodes
  const setcodes = card.setcodes.setcodes.map((sc) => ({
    code: sc.code,
    name: registryHashes?.setcode?.get(sc.code),
  }));

  // Build decoded availability
  const availability = card.availability.codes.map((code) => ({
    code: String(code),
  }));

  // Build decoded category flags
  const categoryFlags = card.category.codes.map((code) => ({
    code: String(code),
  }));

  // Build auxiliary strings
  const auxiliaryStrings = card.auxiliaryStrings.map((as) => ({
    index: as.index,
    value: as.value,
  }));

  return {
    ecosystem: "EDOPRO",
    database: {
      fileName: context.databaseFileName,
      sha256: context.databaseSha256,
    },
    rawRows: {
      datas: rawRows?.datas ? convertToRecord(rawRows.datas) : null,
      texts: rawRows?.texts ? convertToRecord(rawRows.texts) : null,
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
 * Build coverage section.
 */
function buildCoverage(
  card: NormalizedCard,
  _diagnostics: Array<{ code: string; severity: string; message: string }>,
): CardSourceDocument["coverage"] {
  const assumptions: string[] = [];
  const unsupported: string[] = [];

  // Document orphan state assumptions based on source ordinals
  const hasDataOrdinal = card.source.dataOrdinal !== null;
  const hasTextOrdinal = card.source.textOrdinal !== null;

  if (hasDataOrdinal && !hasTextOrdinal) {
    assumptions.push("Card has datas row but no texts row; name and description are derived from raw data.");
  } else if (!hasDataOrdinal && hasTextOrdinal) {
    assumptions.push("Card has texts row but no datas row; type information is unavailable from data.");
  }

  // Document unknown bits
  if (card.type.unknownBits > 0) {
    unsupported.push(`Unknown type bits: 0x${card.type.unknownBits.toString(16)}`);
  }
  if (card.monsterType?.unknownBits && card.monsterType.unknownBits > 0) {
    unsupported.push(`Unknown monster type bits: 0x${card.monsterType.unknownBits.toString(16)}`);
  }
  if (card.attribute?.unknownBits && card.attribute.unknownBits > 0) {
    unsupported.push(`Unknown attribute bits: 0x${card.attribute.unknownBits.toString(16)}`);
  }

  return {
    status: "SOURCE_ONLY",
    assumptions,
    unsupported,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a typed row to a plain record for JSON serialization.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToRecord(row: any): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof key === "string") {
      // Only assign primitive values (string or null)
      // Skip nested objects like { str1: { value: "..." } }
      if (value === null || typeof value === "string") {
        result[key] = value;
      } else {
        result[key] = null;
      }
    }
  }
  return result;
}
