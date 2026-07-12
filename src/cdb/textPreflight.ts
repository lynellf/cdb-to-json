/**
 * Text byte/length preflight for safe text cell handling.
 *
 * Before the full join, validates storage class and byte length
 * for every supported texts column. Rejects wrong storage classes,
 * over-limit values, and invalid UTF-8.
 */

import Database from "better-sqlite3";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Supported texts columns that must be preflighted.
 */
const TEXT_COLUMNS = [
  "name",
  "desc",
  "str1", "str2", "str3", "str4", "str5", "str6", "str7", "str8",
  "str9", "str10", "str11", "str12", "str13", "str14", "str15", "str16",
] as const;

/**
 * Result of text preflight for a single column.
 */
export interface ColumnTextPreflight {
  column: string;
  /** IDs of rows that have invalid storage class */
  invalidTypeIds: number[];
  /** IDs of rows that exceed the byte limit */
  overLimitIds: { id: number; byteLength: number }[];
}

/**
 * Result of full text preflight.
 */
export interface TextPreflightResult {
  /** Whether all text cells are valid and within limits */
  valid: boolean;
  /** Per-column preflight results */
  columns: ColumnTextPreflight[];
  /** Total over-limit count across all columns */
  totalOverLimit: number;
  /** Total invalid type count */
  totalInvalidType: number;
}

/**
 * Run byte-length-only preflight for all supported texts columns.
 *
 * Uses SQLite length(CAST(col AS BLOB)) to measure stored UTF-8 bytes.
 * Checks typeof() before length to ensure TEXT or NULL.
 * Does NOT select over-limit values.
 *
 * @param db - Open database handle
 * @param maxTextBytes - Maximum allowed bytes per text cell
 * @param diagnostics - Optional diagnostic collector
 */
export function preflightTextColumns(
  db: Database.Database,
  maxTextBytes: number,
  diagnostics?: DiagnosticCollector
): TextPreflightResult {
  const results: ColumnTextPreflight[] = [];
  let totalOverLimit = 0;
  let totalInvalidType = 0;

  for (const column of TEXT_COLUMNS) {
    const invalidTypeIds: number[] = [];
    const overLimitIds: { id: number; byteLength: number }[] = [];

    try {
      // Check storage class first: only 'text' and 'null' are valid
      const typeStmt = db.prepare(`
        SELECT id, typeof("${column}") AS type
        FROM texts
        WHERE typeof("${column}") NOT IN ('text', 'null')
      `);

      for (const row of typeStmt.iterate() as IterableIterator<{ id: number; type: string }>) {
        invalidTypeIds.push(row.id);
        diagnostics?.error(
          DiagnosticCode.INVALID_TEXT_VALUE,
          `Invalid storage class for texts.${column}: ${row.type} (expected TEXT or NULL)`,
          {
            source: { table: "texts", column },
            rawValue: row.type,
          }
        );
        totalInvalidType++;
      }

      // For valid TEXT cells, check byte length without selecting the value
      const lengthStmt = db.prepare(`
        SELECT id, length(CAST("${column}" AS BLOB)) AS byte_length
        FROM texts
        WHERE "${column}" IS NOT NULL
          AND typeof("${column}") = 'text'
          AND length(CAST("${column}" AS BLOB)) > ?
      `);

      for (const row of lengthStmt.iterate(maxTextBytes) as IterableIterator<{ id: number; byte_length: number }>) {
        overLimitIds.push({ id: row.id, byteLength: row.byte_length });
        diagnostics?.error(
          DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
          `Text cell texts.${column} ID ${row.id} exceeds maxTextBytes (${row.byte_length} > ${maxTextBytes})`,
          {
            source: { table: "texts", column, cardId: String(row.id) },
            details: { limitCode: "MAX_TEXT_LENGTH_EXCEEDED", byteLength: row.byte_length, maxBytes: maxTextBytes },
          }
        );
        totalOverLimit++;
      }
    } catch (error) {
      // If the column doesn't exist, skip it
      // (will be caught by schema validation earlier)
      continue;
    }

    results.push({ column, invalidTypeIds, overLimitIds });
  }

  return {
    valid: totalOverLimit === 0 && totalInvalidType === 0,
    columns: results,
    totalOverLimit,
    totalInvalidType,
  };
}

/**
 * Validate UTF-8 encoding of retrieved text bytes.
 *
 * Decodes a BLOB with TextDecoder('utf-8', { fatal: true }).
 * Returns the decoded string if valid, or null if invalid.
 */
export function decodeTextBlob(bytes: Buffer): string | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}