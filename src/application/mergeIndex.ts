/**
 * Merge conflict index for card deduplication.
 *
 * Tracks the current best record for each card ID across multiple
 * database inputs, applying the on-conflict strategy (error/first/last).
 *
 * Per P4 spec:
 * - error: merged error collision is global and terminal (exit 5)
 * - first: keep the earliest-contributing record
 * - last: keep the latest-contributing record
 *
 * Merge ordering uses reader canonical IDs, source ordinals, and
 * input order without re-sorting or numeric coercion.
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import type { OnConflict } from "./types.js";
import { MergeLineage, type SourceRef, type MergeLineageIndex } from "./mergeLineage.js";

/**
 * Conflict resolution strategy.
 */
export type MergeConflictStrategy = "error" | "first" | "last";

/**
 * Conflict resolution result for a card ID.
 */
export type ConflictResolution =
  | { action: "keep"; record: NormalizedCard; inputOrdinal: number; spooled: boolean }
  | { action: "conflict_error"; cardId: string; sources: readonly SourceRef[] }
  | { action: "no_change" };

/**
 * Entry in the merge index for a single card ID.
 */
interface IndexEntry {
  /** The best record for this ID so far */
  record: NormalizedCard;
  /** Input ordinal of the best record */
  inputOrdinal: number;
  /** Whether this record was spooled to disk */
  spooled: boolean;
  /** Lineage tracking for this ID */
  lineage: MergeLineage;
  /** Whether this entry was spooled and is now backed by a file */
  spooledToDisk: boolean;
}

/**
 * Result of adding a card to the merge index.
 */
export interface MergeIndexResult {
  /** The action taken for this card */
  resolution: ConflictResolution;
  /** Whether this card was added to the index */
  added: boolean;
  /** Whether this caused a terminal conflict (error strategy) */
  terminal: boolean;
}

/**
 * Merge conflict index.
 *
 * Manages deduplication of cards across multiple database inputs.
 * Keeps only the current best record per ID according to the strategy.
 */
export class MergeIndex {
  private readonly strategy: MergeConflictStrategy;
  private readonly index = new Map<string, IndexEntry>();
  private readonly lineageIndex: MergeLineageIndex;
  private terminalConflict = false;
  private conflictCardId: string | null = null;
  private conflictSources: readonly SourceRef[] = [];

  constructor(
    strategy: OnConflict,
    lineageIndex: MergeLineageIndex,
  ) {
    // OnConflict and MergeConflictStrategy have the same literal union.
    // Cast to preserve literal type for exhaustive switch exhaustiveness.
    this.strategy = strategy as MergeConflictStrategy;
    this.lineageIndex = lineageIndex;
  }

  /**
   * Get the canonical ordering key for a record.
   * Uses (cardId, inputOrdinal) for stable ordering.
   */
  private orderingKey(record: NormalizedCard, inputOrdinal: number): [string, number] {
    return [record.id, inputOrdinal];
  }

  /**
   * Compare two ordering keys.
   * Returns negative if a < b.
   */
  private compareKeys(
    a: [string, number],
    b: [string, number],
  ): number {
    if (a[0] !== b[0]) {
      return a[0] < b[0] ? -1 : 1;
    }
    return a[1] - b[1];
  }

  /**
   * Add a normalized card to the merge index.
   *
   * @param card The normalized card to add
   * @param inputOrdinal The discovery order of the source database
   * @param isComplete Whether this card had both datas and texts rows
   * @returns Result indicating action taken
   */
  add(
    card: NormalizedCard,
    inputOrdinal: number,
    isComplete: boolean,
    spooled = false,
  ): MergeIndexResult {
    if (this.terminalConflict) {
      return { resolution: { action: "no_change" }, added: false, terminal: true };
    }

    const cardId = card.id;
    const existing = this.index.get(cardId);
    const newKey = this.orderingKey(card, inputOrdinal);

    if (!existing) {
      // First occurrence of this card ID
      const lineage = this.lineageIndex.getOrCreate(cardId);
      lineage.addSource(MergeLineage.fromNormalizedCard(card, inputOrdinal, isComplete));

      this.index.set(cardId, {
        record: card,
        inputOrdinal,
        spooled,
        lineage,
        spooledToDisk: spooled,
      });

      return { resolution: { action: "keep", record: card, inputOrdinal, spooled }, added: true, terminal: false };
    }

    // Conflict: same card ID from a different source
    const existingKey = this.orderingKey(existing.record, existing.inputOrdinal);
    const cmp = this.compareKeys(newKey, existingKey);

    // Add source to lineage regardless of resolution
    existing.lineage.addSource(MergeLineage.fromNormalizedCard(card, inputOrdinal, isComplete));

    switch (this.strategy) {
      case "error": {
        // Terminal collision: record all contributing sources
        const sources = existing.lineage.getSources();
        this.terminalConflict = true;
        this.conflictCardId = cardId;
        this.conflictSources = sources;

        return {
          resolution: {
            action: "conflict_error",
            cardId,
            sources,
          },
          added: false,
          terminal: true,
        };
      }

      case "first": {
        // Keep the earliest-contributing record (lowest ordering key wins)
        if (cmp < 0) {
          // New record comes before existing; update
          this.index.set(cardId, {
            record: card,
            inputOrdinal,
            spooled,
            lineage: existing.lineage,
            spooledToDisk: spooled,
          });
          return { resolution: { action: "keep", record: card, inputOrdinal, spooled }, added: true, terminal: false };
        }
        // Existing stays
        return { resolution: { action: "keep", record: existing.record, inputOrdinal: existing.inputOrdinal, spooled: existing.spooled }, added: false, terminal: false };
      }

      case "last": {
        // Keep the latest-contributing record (highest ordering key wins)
        if (cmp > 0) {
          // New record comes after existing; update
          this.index.set(cardId, {
            record: card,
            inputOrdinal,
            spooled,
            lineage: existing.lineage,
            spooledToDisk: spooled,
          });
          return { resolution: { action: "keep", record: card, inputOrdinal, spooled }, added: true, terminal: false };
        }
        // Existing stays
        return { resolution: { action: "keep", record: existing.record, inputOrdinal: existing.inputOrdinal, spooled: existing.spooled }, added: false, terminal: false };
      }
    }
  }

  /**
   * Check if a terminal conflict has occurred.
   */
  get hasTerminalConflict(): boolean {
    return this.terminalConflict;
  }

  /**
   * Get the terminal conflict card ID.
   */
  get terminalConflictCardId(): string | null {
    return this.conflictCardId;
  }

  /**
   * Get the terminal conflict sources.
   */
  get terminalConflictSources(): readonly SourceRef[] {
    return this.conflictSources;
  }

  /**
   * Get all tracked card IDs.
   */
  get cardIds(): Iterable<string> {
    return this.index.keys();
  }

  /**
   * Get the number of tracked card IDs.
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * Get the best record for a card ID.
   */
  get(cardId: string): NormalizedCard | undefined {
    return this.index.get(cardId)?.record;
  }

  /**
   * Get the input ordinal for the best record of a card ID.
   */
  getInputOrdinal(cardId: string): number | undefined {
    return this.index.get(cardId)?.inputOrdinal;
  }

  /**
   * Get the lineage for a card ID.
   */
  getLineage(cardId: string): MergeLineage | undefined {
    return this.index.get(cardId)?.lineage;
  }

  /**
   * Check if a card ID is tracked.
   */
  has(cardId: string): boolean {
    return this.index.has(cardId);
  }

  /**
   * Get all records in sorted order (by cardId, then inputOrdinal).
   */
  getAllSorted(): Array<{ record: NormalizedCard; inputOrdinal: number; spooled: boolean }> {
    return [...this.index.entries()]
      .sort((a, b) => {
        if (a[0] !== b[0]) {
          return a[0] < b[0] ? -1 : 1;
        }
        return a[1].inputOrdinal - b[1].inputOrdinal;
      })
      .map(([, entry]) => ({
        record: entry.record,
        inputOrdinal: entry.inputOrdinal,
        spooled: entry.spooledToDisk,
      }));
  }

  /**
   * Build CARD_ID_COLLISION diagnostics for all IDs with multiple sources.
   */
  buildCollisionDiagnostics(): Array<{
    code: typeof DiagnosticCode["CARD_ID_COLLISION"];
    severity: "ERROR";
    message: string;
    source: { database?: string; cardId: string };
  }> {
    const diagnostics: Array<{
      code: typeof DiagnosticCode["CARD_ID_COLLISION"];
      severity: "ERROR";
      message: string;
      source: { database?: string; cardId: string };
    }> = [];

    for (const [cardId, entry] of this.index) {
      const sources = entry.lineage.getSources();
      if (sources.length <= 1) continue;

      const databases = [...new Set(sources.map((s) => s.database))];
      diagnostics.push({
        code: DiagnosticCode.CARD_ID_COLLISION,
        severity: "ERROR",
        message: `Card ID ${cardId} appears in ${sources.length} sources (${databases.join(", ")}) with conflict resolution "${this.strategy}"`,
        source: {
          cardId,
          database: databases[0],
        },
      });
    }

    return diagnostics;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.index.clear();
    this.terminalConflict = false;
    this.conflictCardId = null;
    this.conflictSources = [];
  }
}
