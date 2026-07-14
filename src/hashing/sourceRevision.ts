/**
 * Source revision hashing for the CDB-to-JSON converter.
 *
 * Implements `canonical-json/cdb-to-json/source-revision/v1`:
 * - Sorted object keys (Unicode code point order)
 * - Compact UTF-8 encoding
 * - Explicit array order preserved (not sorted)
 * - Finite values only (no NaN, no Infinity)
 * - Decimal-string integers (canonical numeric representation)
 *
 * This module provides two related hashes:
 *
 * 1. `conversionOptionsHash`: SHA-256 of the shared semantic options object.
 *    Inputs included: profile, locale, sourceNamespace, text-normalization version,
 *    all registry versions, all registry hashes, all limit values.
 *    Inputs EXCLUDED: output path, format, pretty, diagnostics rendering, timing.
 *
 * 2. `sourceRevisionId`: SHA-256 of the canonical source-facts/lineage object.
 *    Inputs included: schema/profile, converter major, verified physical snapshot-bundle
 *    SHA-256, all contributing raw facts and canonical data/text ordinals, row identity,
 *    normalized locale/"und", source namespace, registry versions/content hashes,
 *    text-normalization version, and the full shared semantic options object.
 *    Inputs EXCLUDED: output path, format, pretty-printing, diagnostics rendering, timing.
 */

import { canonicalSha256 } from "./sha256.js";
import type { LimitsV1 } from "../application/types.js";

/**
 * The canonical source-facts/lineage object structure for sourceRevisionId.
 * All keys are sorted lexicographically in the canonical JSON.
 */
export interface SourceRevisionFacts {
  /**
   * Schema identifier (e.g. "ygo.card-source/1").
   */
  schema: string;

  /**
   * Converter major version (e.g. "cdb-to-json/2").
   */
  converterVersion: string;

  /**
   * Physical snapshot-bundle SHA-256.
   * Computed as SHA-256 of canonical UTF-8 JSON for the tuple:
   * [
   *   { "name": "main",    "present": true,  "bytesBase64": "<base64 of main db bytes>" },
   *   { "name": "-wal",    "present": <bool>, "bytesBase64": "<base64 of wal bytes or null>" },
   *   { "name": "-shm",    "present": <bool>, "bytesBase64": "<base64 of shm bytes or null>" }
   * ]
   * Absent members are explicit as { "present": false, "bytesBase64": null }.
   */
  physicalSnapshotHash: string;

  /**
   * Canonical source facts (sorted by cardId asc, then inputOrdinal asc).
   * Each fact is a decimal-string representation of the raw values.
   */
  sourceFacts: SourceFact[];

  /**
   * Normalized locale or "und" for undefined.
   */
  locale: string;

  /**
   * Source namespace string.
   */
  sourceNamespace: string;

  /**
   * Text normalization version identifier.
   */
  textNormalizationVersion: string;

  /**
   * Registry version identifiers for all normalization families.
   */
  registryVersions: RegistryVersions;

  /**
   * Registry content hashes for all normalization families.
   * Each hash is a lowercase SHA-256 hex string.
   */
  registryHashes: RegistryHashes;

  /**
   * The shared semantic options (same as used for conversionOptionsHash).
   */
  sharedSemanticOptions: SharedSemanticOptions;
}

/**
 * A single source fact: the canonical representation of one card row.
 * Canonical means: decimal-string integers, sorted object keys.
 */
export interface SourceFact {
  cardId: string;
  inputOrdinal: number;
  dataOrdinal: number;
  textOrdinal: number;
  datas: Record<string, string | null>;
  texts: Record<string, string | null> | null;
}

/**
 * Registry version identifiers.
 */
export interface RegistryVersions {
  cardType: string;
  attribute: string;
  monsterType: string;
  linkMarker: string;
  availability: string;
  category: string;
  progression: string;
  stats: string;
  setcode: string;
}

/**
 * Registry content hashes (SHA-256 hex strings).
 */
export interface RegistryHashes {
  cardType: string;
  attribute: string;
  monsterType: string;
  linkMarker: string;
  availability: string;
  category: string;
  progression: string;
  stats: string;
  setcode: string;
}

/**
 * The shared semantic options object used for both hashes.
 * This is the authoritative definition of what inputs affect provenance.
 */
export interface SharedSemanticOptions {
  profile: string;
  locale: string;
  sourceNamespace: string;
  textNormalizationVersion: string;
  registryVersions: RegistryVersions;
  registryHashes: RegistryHashes;
  limits: LimitsV1;
}

/**
 * Compute the conversionOptionsHash.
 *
 * This is the SHA-256 of the canonical JSON of the shared semantic options.
 * Only semantic options are included; presentation inputs are excluded.
 *
 * @param options The shared semantic options
 * @returns SHA-256 hex string of the canonical JSON
 */
export function computeConversionOptionsHash(options: SharedSemanticOptions): string {
  return canonicalSha256(options);
}

/**
 * Compute the sourceRevisionId.
 *
 * This is the SHA-256 of the canonical JSON of the source-facts/lineage object.
 * It is deterministic: the same source facts and options always produce the same ID.
 * Output path, format, pretty, diagnostics, and timing are excluded.
 *
 * @param facts The canonical source facts and lineage object
 * @returns SHA-256 hex string of the canonical JSON
 */
export function computeSourceRevisionId(facts: SourceRevisionFacts): string {
  return canonicalSha256(facts);
}

/**
 * Build a SharedSemanticOptions object from individual components.
 *
 * This is a convenience helper used when computing provenance hashes.
 */
export function buildSharedSemanticOptions(params: {
  profile: string;
  locale: string;
  sourceNamespace: string;
  textNormalizationVersion?: string;
  registryVersions: RegistryVersions;
  registryHashes: RegistryHashes;
  limits: LimitsV1;
}): SharedSemanticOptions {
  return {
    profile: params.profile,
    locale: params.locale,
    sourceNamespace: params.sourceNamespace,
    textNormalizationVersion: params.textNormalizationVersion ?? "text-normalization/1",
    registryVersions: params.registryVersions,
    registryHashes: params.registryHashes,
    limits: params.limits,
  };
}

/**
 * Build a SourceFact from raw row data.
 *
 * Canonical representation rules:
 * - All integer IDs and ordinals are decimal strings (not numbers)
 * - Object keys are sorted lexicographically
 * - null is preserved as null
 *
 * @param cardId Card ID as decimal string
 * @param inputOrdinal The discovery order of the source database (0-based)
 * @param dataOrdinal The ordinal of this datas row within its table
 * @param textOrdinal The ordinal of this texts row within its table
 * @param datas Raw datas row (column name → value)
 * @param texts Raw texts row (column name → value) or null
 */
export function buildSourceFact(
  cardId: string,
  inputOrdinal: number,
  dataOrdinal: number,
  textOrdinal: number,
  datas: Record<string, string | null>,
  texts: Record<string, string | null> | null,
): SourceFact {
  return {
    cardId,
    inputOrdinal,
    dataOrdinal,
    textOrdinal,
    // Canonical: sort object keys
    datas: sortRecord(datas),
    texts: texts === null ? null : sortRecord(texts as Record<string, string | null>),
  };
}

/**
 * Sort an object's keys lexicographically (Unicode code point order).
 */
function sortRecord(obj: Record<string, string | null>): Record<string, string | null> {
  const sorted: Record<string, string | null> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

/**
 * Build a physical snapshot bundle hash.
 *
 * The hash is computed over a canonical JSON representation of the bundle tuple:
 * [
 *   { "name": "main",    "present": true,  "bytesBase64": "<base64 of main db bytes>" },
 *   { "name": "-wal",    "present": <bool>, "bytesBase64": "<wal base64 or null>" },
 *   { "name": "-shm",    "present": <bool>, "bytesBase64": "<shm base64 or null>" }
 * ]
 *
 * This tuple representation is repository-canonical: the same logical database
 * always produces the same tuple regardless of how the files happen to be
 * arranged on disk, as long as their contents are identical.
 *
 * @param mainBytes Buffer of the main database file bytes (required)
 * @param walBytes Buffer of the WAL file bytes, or null if absent
 * @param shmBytes Buffer of the SHM file bytes, or null if absent
 * @returns SHA-256 hex string of the canonical tuple JSON
 */
export function computePhysicalSnapshotHash(
  mainBytes: Buffer,
  walBytes: Buffer | null,
  shmBytes: Buffer | null,
): string {
  const tuple: SnapshotFile[] = [
    {
      name: "main",
      present: true,
      bytesBase64: mainBytes.toString("base64"),
    },
    {
      name: "-wal",
      present: walBytes !== null,
      bytesBase64: walBytes?.toString("base64") ?? null,
    },
    {
      name: "-shm",
      present: shmBytes !== null,
      bytesBase64: shmBytes?.toString("base64") ?? null,
    },
  ];

  // The tuple must be canonical: keys sorted, arrays in order
  return canonicalSha256(tuple);
}

interface SnapshotFile {
  name: string;
  present: boolean;
  bytesBase64: string | null;
}

/**
 * Verify two source facts represent the same logical data despite physical reordering.
 *
 * Returns true if the facts have identical canonical projections:
 * - Same cardId, inputOrdinal, dataOrdinal, textOrdinal
 * - Same datas values (keys sorted identically)
 * - Same texts values (keys sorted identically)
 *
 * This comparison ignores file path and physical hash differences.
 */
export function canonicalDataProjectionEqual(a: SourceFact, b: SourceFact): boolean {
  if (a.cardId !== b.cardId) return false;
  if (a.inputOrdinal !== b.inputOrdinal) return false;
  if (a.dataOrdinal !== b.dataOrdinal) return false;
  if (a.textOrdinal !== b.textOrdinal) return false;
  if (!recordValuesEqual(a.datas, b.datas)) return false;
  if (!recordValuesEqual(a.texts, b.texts)) return false;
  return true;
}

function recordValuesEqual(
  a: Record<string, string | null> | null,
  b: Record<string, string | null> | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (a[aKeys[i]] !== b[bKeys[i]]) return false;
  }
  return true;
}
