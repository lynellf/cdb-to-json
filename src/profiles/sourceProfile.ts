/**
 * Source profile mapper.
 *
 * Transforms normalized cards into the ygo.card-source/1 schema format.
 * This is the provenance-rich source document for the YGO-DSL translation pipeline.
 *
 * @module profiles/sourceProfile
 */

import { toSourceDocument, type ToSourceDocumentContext, type SourceDocumentResult } from "../application/toSourceDocument.js";
import type { NormalizedCard } from "../normalization/normalizeCard.js";
import type { RawCardRows } from "../cdb/rawTypes.js";

// Re-export for convenience
export type { CardSourceDocument, SourceDocumentResult, ToSourceDocumentContext } from "../application/toSourceDocument.js";

/**
 * Map a normalized card to source profile format.
 *
 * @param card Normalized card record
 * @param rawRows Raw CDB row data
 * @param context Conversion context
 * @returns Source document result
 */
export function mapCardToSource(
  card: NormalizedCard,
  rawRows: RawCardRows | null,
  context: ToSourceDocumentContext,
): SourceDocumentResult {
  return toSourceDocument(card, rawRows, context);
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

/**
 * Create a default database SHA-256 for testing.
 */
export function createDefaultDatabaseSha256(): string {
  return "sha256:0000000000000000000000000000000000000000000000000000000000000000";
}

/**
 * Create a minimal source document context for testing.
 */
export function createTestContext(overrides?: Partial<ToSourceDocumentContext>): ToSourceDocumentContext {
  return {
    locale: "en",
    sourceNamespace: "cdb-to-json",
    databaseFileName: "test.cdb",
    databaseSha256: createDefaultDatabaseSha256(),
    sourceRevisionId: createDefaultSourceRevisionId(),
    conversionOptionsHash: createDefaultConversionOptionsHash(),
    ...overrides,
  };
}
