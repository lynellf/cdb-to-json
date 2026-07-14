/**
 * cdb-to-json: CLI-first Yu-Gi-Oh! Card Ingestion Tool
 *
 * @module
 */

// Re-export application services
export { convert } from "./application/convertCatalog.js";
export type { ConvertOptions, OutputProfile, OutputFormat } from "./application/types.js";
export type { ConversionResult, SourceReport } from "./application/convertCatalog.js";

// Re-export CDB reading components
export {
  iterateRawCards,
} from "./cdb/iterateRows.js";

export { openDatabaseSafe, closeDatabaseSafe } from "./cdb/openDatabase.js";
export type { RawCardRows, RawDatasRow, RawTextsRow, CdbSchema, DatabaseMetadata } from "./cdb/rawTypes.js";

// Re-export discovery components
export {
  discoverInputs,
  type DiscoveredInput,
  type DiscoverInputsOptions,
} from "./discovery/discoverCdbInputs.js";

// Re-export diagnostic components
export {
  DiagnosticCode,
  DiagnosticSeverity,
  createDiagnostic,
  type Diagnostic,
} from "./diagnostics/codes.js";

export {
  DiagnosticCollector,
  createCollector,
  type DiagnosticSummary,
} from "./diagnostics/collector.js";

// Re-export normalization components
export { normalizeCard, isCompleteCard, getIncompleteDiagnostics } from "./normalization/normalizeCard.js";
export type { NormalizedCard } from "./normalization/normalizeCard.js";

// Re-export registry components
export {
  CARD_TYPE_VERSION,
  ATTRIBUTE_VERSION,
  MONSTER_TYPE_VERSION,
  LINK_MARKER_VERSION,
  AVAILABILITY_VERSION,
  CATEGORY_VERSION,
  SETCODE_VERSION,
  PROGRESSION_VERSION,
  STATS_VERSION,
  decodeType,
  decodeAttribute,
  decodeMonsterType,
  decodeLinkMarkers,
  decodeAvailability,
  decodeCategory,
  unpackSetcode,
  decodeProgression,
  decodeStat,
  decodeDefense,
  getCardKind,
  getMonsterTraits,
  getPrimaryAttribute,
  getPrimaryMonsterType,
  getPrimaryAvailability,
  getProgressionType,
} from "./registry/index.js";
export type {
  TypeDecodeResult,
  AttributeDecodeResult,
  MonsterTypeDecodeResult,
  LinkMarkerDecodeResult,
  AvailabilityDecodeResult,
  CategoryDecodeResult,
  SetcodeDecodeResult,
  UnpackedSetcode,
  ProgressionDecodeResult,
  StatDecodeResult,
  MonsterTrait as MonsterTraitType,
  SpellType as SpellTypeType,
  TrapType as TrapTypeType,
} from "./registry/index.js";

// Re-export profile mappers
export {
  mapRawCard,
  mapDatabaseToRaw,
  RawEnvelopeBuilder,
} from "./profiles/rawProfile.js";
export type { RawDatabaseEnvelope, DatabaseSourceMetadata } from "./profiles/rawProfile.js";

export { mapCardToProfile } from "./profiles/cardProfile.js";
export type { CardProfileOutput, CardProfileOptions } from "./profiles/cardProfile.js";

export { mapCardToSource, createDefaultSourceRevisionId, createDefaultConversionOptionsHash, createDefaultDatabaseSha256, createTestContext } from "./profiles/sourceProfile.js";
export type { CardSourceDocument, SourceDocumentResult, ToSourceDocumentContext } from "./profiles/sourceProfile.js";

// Re-export text processing
export {
  normalizeText,
  segmentCardText,
  PENDULUM_MARKER,
  MONSTER_EFFECT_MARKER,
  TEXT_KIND,
  getSourceSpans,
  buildTextSections,
} from "./text/index.js";
export type { TextSlice, TextKind, SegmentationResult, SegmentationStatus } from "./text/index.js";

// Re-export hashing
export { sha256Buffer, sha256String, canonicalJson, canonicalSha256 } from "./hashing/sha256.js";

// Re-export exit codes
export { ExitCode, computeExitCode, type ExitCodeState } from "./cli/exitCodes.js";

// Re-export limits
export { getDefaultLimits, validateLimitRelations } from "./application/types.js";
export type { LimitsV1 } from "./application/types.js";

// Legacy compatibility export. The default remains available during 2.x;
// new consumers should prefer the named modern APIs above.
export { default } from "./legacy.js";
export { default as legacyConvert } from "./legacy.js";

// Version info
export const VERSION = "2.0.0";
export const TOOL_NAME = "cdb-to-json";

/** @deprecated Use the new modular API */
export const __esModule = true;