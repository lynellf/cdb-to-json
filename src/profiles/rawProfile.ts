/**
 * Raw profile mapper — database envelope builder.
 *
 * Transforms raw CDB rows into the cdb.raw/1 schema format.
 * One envelope per database, not per card.
 */

import type {
  RawCardRows,
  RawDatasRow,
  RawTextsRow,
} from "../cdb/rawTypes.js";
import type { ExtraTableMetadata } from "../cdb/iterateRows.js";

/**
 * Extra table metadata entry.
 */
export interface RawExtraTable {
  name: string;
  columns: string[];
  rowCount: number;
}

/**
 * Raw profile output envelope (one per database).
 */
export interface RawDatabaseEnvelope {
  schema: "cdb.raw/1";
  integerEncoding: "signed-int64-decimal";
  source: {
    fileName: string;
    sha256: string;
    sizeBytes: number;
    converter: "cdb-to-json/2.0.0";
  };
  tables: {
    datas: RawDatasRow[];
    texts: RawTextsRow[];
  };
  extraTables: RawExtraTable[];
}

/**
 * Metadata about a database needed for the raw envelope.
 */
export interface DatabaseSourceMetadata {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  extraTables?: readonly ExtraTableMetadata[];
}

/**
 * Accumulator for building one raw database envelope.
 * Accumulates rows but does NOT retain all cards after the envelope is built.
 */
export class RawEnvelopeBuilder {
  private readonly datasRows: RawDatasRow[] = [];
  private readonly textsRows: RawTextsRow[] = [];
  private sourceMeta: DatabaseSourceMetadata;

  constructor(sourceMeta: DatabaseSourceMetadata) {
    this.sourceMeta = sourceMeta;
  }

  /**
   * Update source metadata after initial construction.
   * Called after the metadata callback fires during row iteration.
   */
  updateMetadata(meta: { sha256: string; sizeBytes: number; extraTables: readonly ExtraTableMetadata[] }): void {
    this.sourceMeta = {
      ...this.sourceMeta,
      sha256: meta.sha256,
      sizeBytes: meta.sizeBytes,
      extraTables: meta.extraTables,
    };
  }

  /**
   * Add one card's raw rows to the current envelope.
   */
  addCard(card: RawCardRows): void {
    if (card.datas) {
      this.datasRows.push(card.datas);
    }
    if (card.texts) {
      this.textsRows.push(card.texts);
    }
  }

  /**
   * Build the complete raw envelope for this database.
   * Resets internal accumulators.
   */
  build(): RawDatabaseEnvelope {
    // Always emit extraTables as an array (fixed raw envelope contract).
    // Empty array is emitted when there are no extra tables.
    const extraTables: RawExtraTable[] = (this.sourceMeta.extraTables ?? []).map((t) => ({
      name: t.name,
      columns: [...t.columns],
      rowCount: t.rowCount,
    }));

    const envelope: RawDatabaseEnvelope = {
      schema: "cdb.raw/1",
      integerEncoding: "signed-int64-decimal",
      source: {
        fileName: this.sourceMeta.fileName,
        sha256: this.sourceMeta.sha256,
        sizeBytes: this.sourceMeta.sizeBytes,
        converter: "cdb-to-json/2.0.0",
      },
      tables: {
        datas: [...this.datasRows],
        texts: [...this.textsRows],
      },
      extraTables,
    };

    // Clear accumulators after building
    this.datasRows.length = 0;
    this.textsRows.length = 0;

    return envelope;
  }

  /**
   * Get current card count (datas rows accumulated).
   */
  get cardCount(): number {
    return this.datasRows.length;
  }
}

/**
 * Legacy per-card mapping helper.
 * Preserved for compatibility tests only. Not used by the CLI path.
 *
 * @deprecated Use RawEnvelopeBuilder for CLI conversion.
 */
export function mapRawCard(
  rows: RawCardRows,
  options: DatabaseSourceMetadata,
): RawDatabaseEnvelope {
  const builder = new RawEnvelopeBuilder(options);
  builder.addCard(rows);
  return builder.build();
}

/**
 * Legacy database mapping helper.
 * Preserved for compatibility tests only.
 *
 * @deprecated Use RawEnvelopeBuilder with iteration for CLI conversion.
 */
export function mapDatabaseToRaw(
  cards: RawCardRows[],
  options: DatabaseSourceMetadata,
): RawDatabaseEnvelope {
  const builder = new RawEnvelopeBuilder(options);
  for (const card of cards) {
    builder.addCard(card);
  }
  return builder.build();
}
