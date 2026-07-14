/**
 * Card merge orchestrator.
 *
 * Implements the disk-backed two-pass merge for card normalization:
 * - Pass 1: Normalize all cards from all databases, apply conflict resolution
 *           using the bounded in-memory index, and spill to disk when
 *           maxSpoolBytes is exceeded.
 * - Pass 2: Merge-sort all spilled runs and yield unique cards in order.
 *
 * Per P4-AC4:
 * - Uses disk-backed two-pass spool/index
 * - Enforces aggregate private-storage budget (maxSpoolBytes)
 * - Selects error/first/last deterministically
 * - Retains all contributing source lineage
 * - Cleans private state after collision, writer failure, or cancellation
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";
import type { OnConflict } from "./types.js";
import type { LimitsV1 } from "./types.js";
import type { NormalizationContext } from "./types.js";
import { MergeSpool, type MergeYield } from "./mergeSpool.js";
import { MergeIndex, type MergeConflictStrategy } from "./mergeIndex.js";
import { MergeLineageIndex } from "./mergeLineage.js";
import { iterateRawCards } from "../cdb/iterateRows.js";
import { normalizeCard, isCompleteCard } from "../normalization/normalizeCard.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * A deduplicated card ready for emission.
 */
export interface MergedCard {
  /** The winning normalized card */
  card: NormalizedCard;
  /** Input ordinal of the winning source */
  inputOrdinal: number;
  /** Whether the card was spooled to disk during buffering */
  spooled: boolean;
  /** All contributing sources for this card ID */
  contributingSources: number;
  /** Whether this card had a merge conflict */
  hadConflict: boolean;
  /** Winner input ordinal for diagnostics */
  winnerOrdinal: number;
}

/**
 * Merge result after processing all databases.
 */
export interface MergeResult {
  /** All merged cards in sorted order */
  cards: readonly MergedCard[];
  /** Whether a terminal collision occurred (onConflict=error) */
  terminalCollision: boolean;
  /** Card ID of the terminal collision */
  collisionCardId: string | null;
  /** Contributing sources for the terminal collision */
  collisionSources: readonly { database: string; cardId: string; inputOrdinal: number }[];
  /** Whether any cards were spooled to disk */
  usedDiskSpool: boolean;
  /** Total number of unique card IDs */
  uniqueCount: number;
}

/**
 * Configuration for the merge process.
 */
export interface MergeConfig {
  /** Conflict resolution strategy */
  onConflict: OnConflict;
  /** Memory limits */
  limits: LimitsV1;
  /** Normalization context (registry hashes, etc.) */
  normalizationContext: NormalizationContext;
  /** Cancellation signal */
  signal?: AbortSignal;
  /** Diagnostics collector */
  diagnostics: DiagnosticCollector;
}

/**
 * Database input descriptor.
 */
export interface MergeDatabaseInput {
  /** Path to the CDB file */
  path: string;
  /** Discovery order index */
  inputOrdinal: number;
  /** Database filename */
  name: string;
}

/**
 * Process multiple database inputs and return merged deduplicated cards.
 *
 * This implements the two-pass disk-backed merge:
 * 1. Normalize all cards, accumulate in bounded index, record to spool
 * 2. Merge-sort and yield unique cards in (cardId, inputOrdinal) order
 *
 * @param inputs Ordered list of database inputs (discovery order)
 * @param config Merge configuration
 * @yields MergedCard records in sorted order
 */
export async function* mergeCardRecords(
  inputs: readonly MergeDatabaseInput[],
  config: MergeConfig,
): AsyncGenerator<MergedCard> {
  const { onConflict, limits, normalizationContext, signal, diagnostics } = config;

  // Initialize merge infrastructure
  const lineageIndex = new MergeLineageIndex();
  const mergeIndex = new MergeIndex(onConflict as MergeConflictStrategy, lineageIndex);
  const spool = new MergeSpool(limits.maxSpoolBytes);

  let usedDiskSpool = false;

  // ─── PASS 1: Normalize and accumulate ───────────────────────────────────────
  for (const input of inputs) {
    if (signal?.aborted) {
      spool.cleanup();
      return;
    }

    const dbDiagnostics = new DiagnosticCollector();
    const context: NormalizationContext = {
      ...normalizationContext,
      sourceNamespace: input.name,
    };

    try {
      for await (const rawRows of iterateRawCards(input.path, {
        signal,
        limits,
        diagnostics: dbDiagnostics,
      })) {
        if (signal?.aborted) break;

        const card = normalizeCard(rawRows, context, dbDiagnostics);
        const isComplete = isCompleteCard(rawRows);

        // Add to the merge index for conflict resolution
        const result = mergeIndex.add(card, input.inputOrdinal, isComplete);

        if (result.terminal) {
          // onConflict=error: collision is terminal, stop processing
          diagnostics.merge(dbDiagnostics);
          spool.cleanup();
          return;
        }

        // KEY FIX: Also record to spool so Pass 2 can merge
        // The index decides whether to keep this card; spool records all accepted
        if (result.added) {
          const resolved = result.resolution;
          if (resolved.action === "keep") {
            spool.addCard(resolved.record, resolved.inputOrdinal);
            if (!usedDiskSpool && spool.hasSpooledRecords) {
              usedDiskSpool = true;
            }
          }
        }
      }
    } catch (err) {
      diagnostics.merge(dbDiagnostics);
      spool.cleanup();
      throw err;
    }

    diagnostics.merge(dbDiagnostics);
  }

  // ─── PASS 2: Merge-sort and yield unique cards ────────────────────────────────
  spool.startMerge();

  let record: MergeYield | null;
  while ((record = spool.next()) !== null) {
    if (signal?.aborted) {
      spool.cleanup();
      return;
    }

    const cardId = record.card.id;
    const lineage = lineageIndex.get(cardId);
    const sources = lineage?.getSources() ?? [];

    yield {
      card: record.card,
      inputOrdinal: record.inputOrdinal,
      spooled: record.spooled,
      contributingSources: sources.length,
      hadConflict: sources.length > 1,
      winnerOrdinal: record.inputOrdinal,
    };
  }

  spool.cleanup();
}

/**
 * Process multiple databases and return the complete merge result.
 *
 * Convenience wrapper around mergeCardRecords that collects all cards.
 * For large inputs, prefer using mergeCardRecords directly as a generator.
 */
export async function mergeAllCardRecords(
  inputs: readonly MergeDatabaseInput[],
  config: MergeConfig,
): Promise<MergeResult> {
  const cards: MergedCard[] = [];
  const lineageIndex = new MergeLineageIndex();
  const mergeIndex = new MergeIndex(config.onConflict as MergeConflictStrategy, lineageIndex);
  const spool = new MergeSpool(config.limits.maxSpoolBytes);

  let usedDiskSpool = false;
  let terminalCollision = false;
  let collisionCardId: string | null = null;
  let collisionSources: readonly { database: string; cardId: string; inputOrdinal: number }[] = [];

  // Pass 1: accumulate
  for (const input of inputs) {
    if (config.signal?.aborted) break;

    const dbCollector = new DiagnosticCollector();
    const context: NormalizationContext = {
      ...config.normalizationContext,
      sourceNamespace: input.name,
    };

    try {
      for await (const rawRows of iterateRawCards(input.path, {
        signal: config.signal,
        limits: config.limits,
        diagnostics: dbCollector,
      })) {
        if (config.signal?.aborted) break;

        const card = normalizeCard(rawRows, context, dbCollector);
        const isComplete = isCompleteCard(rawRows);
        const result = mergeIndex.add(card, input.inputOrdinal, isComplete);

        if (result.terminal) {
          terminalCollision = true;
          collisionCardId = mergeIndex.terminalConflictCardId;
          collisionSources = mergeIndex.terminalConflictSources;
          config.diagnostics.merge(dbCollector);
          break;
        }

        // KEY FIX: Also record to spool so Pass 2 can merge
        if (result.added) {
          const resolved = result.resolution;
          if (resolved.action === "keep") {
            spool.addCard(resolved.record, resolved.inputOrdinal);
            if (!usedDiskSpool && spool.hasSpooledRecords) {
              usedDiskSpool = true;
            }
          }
        }
      }
    } catch (err) {
      config.diagnostics.merge(dbCollector);
      spool.cleanup();
      throw err;
    }

    config.diagnostics.merge(dbCollector);
    if (terminalCollision) break;
  }

  // Pass 2: collect sorted
  if (!terminalCollision) {
    spool.startMerge();
    let record: MergeYield | null;
    while ((record = spool.next()) !== null) {
      if (config.signal?.aborted) break;

      const cardId = record.card.id;
      const lineage = lineageIndex.get(cardId);
      const sources = lineage?.getSources() ?? [];

      cards.push({
        card: record.card,
        inputOrdinal: record.inputOrdinal,
        spooled: record.spooled,
        contributingSources: sources.length,
        hadConflict: sources.length > 1,
        winnerOrdinal: record.inputOrdinal,
      });
    }
  }

  spool.cleanup();

  return {
    cards,
    terminalCollision,
    collisionCardId,
    collisionSources,
    usedDiskSpool,
    uniqueCount: cards.length,
  };
}

/**
 * Check if a set of inputs requires merge deduplication.
 * Merge is needed when there are multiple inputs with potentially overlapping IDs.
 */
export function requiresMerge(inputs: readonly MergeDatabaseInput[]): boolean {
  return inputs.length > 1;
}

/**
 * Build the CARD_ID_COLLISION diagnostics for a merge result.
 */
export function buildMergeDiagnostics(
  result: MergeResult,
): Array<{
  code: typeof DiagnosticCode["CARD_ID_COLLISION"];
  severity: "ERROR";
  message: string;
  source: { database?: string; cardId: string };
}> {
  if (result.terminalCollision && result.collisionCardId) {
    return [{
      code: DiagnosticCode.CARD_ID_COLLISION,
      severity: "ERROR",
      message: `Card ID ${result.collisionCardId} appears in multiple sources with onConflict=error: ${result.collisionSources.map((s) => s.database).join(", ")}`,
      source: {
        cardId: result.collisionCardId,
        database: result.collisionSources[0]?.database,
      },
    }];
  }
  return [];
}

/**
 * Estimate the memory footprint of a normalized card.
 */
export function estimateCardMemorySize(card: NormalizedCard): number {
  try {
    return Buffer.byteLength(JSON.stringify(card), "utf8");
  } catch {
    return 4096;
  }
}
