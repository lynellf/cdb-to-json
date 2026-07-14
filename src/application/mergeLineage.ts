/**
 * Source lineage tracking for merged card records.
 *
 * Retains the full set of contributing sources for each card ID,
 * enabling provenance reporting after merge conflict resolution.
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";

/**
 * A contributing source for a merged card.
 */
export interface SourceRef {
  /** Path or identifier of the source database */
  database: string;
  /** Card ID in this source */
  cardId: string;
  /** Input order (discovery order across all inputs) */
  inputOrdinal: number;
  /** Source-relative data ordinal (null for texts-only orphan) */
  dataOrdinal: number | null;
  /** Source-relative text ordinal (null for datas-only orphan) */
  textOrdinal: number | null;
  /** Whether this card was complete (both datas and texts) in this source */
  isComplete: boolean;
}

/**
 * Merge lineage for a card ID.
 *
 * Tracks all contributing sources so that conflict diagnostics
 * can report full provenance and the winning record's source
 * can be identified.
 */
export class MergeLineage {
  /** All contributing sources for this card ID */
  private readonly sources: SourceRef[] = [];

  /**
   * Add a contributing source.
   */
  addSource(ref: SourceRef): void {
    this.sources.push(ref);
  }

  /**
   * Get all contributing sources, sorted by input ordinal.
   */
  getSources(): readonly SourceRef[] {
    return [...this.sources].sort((a, b) => a.inputOrdinal - b.inputOrdinal);
  }

  /**
   * Get the first contributing source (earliest input ordinal).
   */
  getFirstSource(): SourceRef | undefined {
    if (this.sources.length === 0) return undefined;
    return this.getSources()[0];
  }

  /**
   * Get the last contributing source (latest input ordinal).
   */
  getLastSource(): SourceRef | undefined {
    if (this.sources.length === 0) return undefined;
    return this.getSources()[this.sources.length - 1];
  }

  /**
   * Get the contributing source count.
   */
  get sourceCount(): number {
    return this.sources.length;
  }

  /**
   * Check if this card had a conflict (multiple contributing sources).
   */
  hasConflict(): boolean {
    return this.sources.length > 1;
  }

  /**
   * Build the lineage entry for a merged card output document.
   *
   * Includes all contributing sources in order.
   */
  toLineageEntry(): {
    sources: readonly SourceRef[];
    sourceCount: number;
    hasConflict: boolean;
    winnerOrdinal: number | null;
  } {
    return {
      sources: this.getSources(),
      sourceCount: this.sources.length,
      hasConflict: this.hasConflict(),
      winnerOrdinal: null, // Set by the merge strategy
    };
  }

  /**
   * Create a source ref from a normalized card.
   */
  static fromNormalizedCard(
    card: NormalizedCard,
    inputOrdinal: number,
    isComplete: boolean,
  ): SourceRef {
    return {
      database: card.source.databasePath,
      cardId: card.id,
      inputOrdinal,
      dataOrdinal: card.source.dataOrdinal,
      textOrdinal: card.source.textOrdinal,
      isComplete,
    };
  }
}

/**
 * Global lineage tracker indexed by card ID.
 */
export class MergeLineageIndex {
  private readonly index = new Map<string, MergeLineage>();

  /**
   * Get or create the lineage entry for a card ID.
   */
  getOrCreate(cardId: string): MergeLineage {
    let lineage = this.index.get(cardId);
    if (!lineage) {
      lineage = new MergeLineage();
      this.index.set(cardId, lineage);
    }
    return lineage;
  }

  /**
   * Check if a card ID has a lineage entry.
   */
  has(cardId: string): boolean {
    return this.index.has(cardId);
  }

  /**
   * Get the lineage for a card ID.
   */
  get(cardId: string): MergeLineage | undefined {
    return this.index.get(cardId);
  }

  /**
   * Get all tracked card IDs.
   */
  get cardIds(): Iterable<string> {
    return this.index.keys();
  }

  /**
   * Get the total number of tracked card IDs.
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * Clear all lineage entries.
   */
  clear(): void {
    this.index.clear();
  }

  /**
   * Delete the lineage for a card ID.
   */
  delete(cardId: string): void {
    this.index.delete(cardId);
  }
}
