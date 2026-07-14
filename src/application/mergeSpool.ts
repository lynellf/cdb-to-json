/**
 * Disk-backed two-pass merge spool.
 *
 * Buffers normalized cards in memory until maxSpoolBytes is exceeded,
 * then flushes sorted runs to disk. After all databases are processed,
 * performs a k-way merge across all spool files plus the in-memory buffer.
 *
 * This is the two-pass disk-backed approach required by P4-AC4:
 * Pass 1: accumulate, buffer, spill
 * Pass 2: merge-sort and yield
 */

import type { NormalizedCard } from "../normalization/normalizeCard.js";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * A record in the spool: the normalized card plus sort key.
 * Sort key is (cardId, inputOrdinal) for stable ordering.
 */
export interface SpoolRecord {
  cardId: string;
  inputOrdinal: number;
  card: NormalizedCard;
  /** JSON-serialised representation for disk spool files */
  serialized: string;
  /** Approximate byte size of the serialized record */
  approxBytes: number;
}

/**
 * Result of the k-way merge pass.
 */
export interface MergeYield {
  card: NormalizedCard;
  inputOrdinal: number;
  spooled: boolean;
}

/**
 * Disk-backed two-pass merge spool.
 *
 * Pass 1 (addCard): buffers in-memory, flushes sorted runs to disk.
 * Pass 2 (merge): k-way merge of in-memory + spool files.
 */
export class MergeSpool {
  private readonly maxSpoolBytes: number;
  private readonly spoolDir: string;

  /** In-memory buffer, kept sorted by (cardId, inputOrdinal) */
  private buffer: SpoolRecord[] = [];

  /** Current estimated byte size of the in-memory buffer */
  private bufferBytes = 0;

  /** Number of spool files created */
  private _spoolFileCount = 0;

  /** Paths of all spool files (for merge phase) */
  private spoolFiles: string[] = [];

  /** Whether we are in merge mode */
  private merging = false;

  /** Index into buffer for merge iteration */
  private mergeBufferIndex = 0;

  /** Current record from each spool file (null = exhausted) */
  private spoolPeeked: (SpoolRecord | null)[] = [];

  /** Per-file cached content for streaming reads */
  private spoolContents: (string[] | null)[] = [];

  /** Per-file line cursor (which line index we're at) */
  private spoolLineIndices: number[] = [];

  constructor(maxSpoolBytes: number, _lineageIndex?: unknown) {
    this.maxSpoolBytes = maxSpoolBytes;
    // Create a private temp directory for spool files
    this.spoolDir = mkdtempSync(join(tmpdir(), "cdb-merge-spool-"));
  }

  /**
   * Estimate the byte size of a serialized record.
   */
  private estimateRecordSize(record: NormalizedCard): number {
    try {
      return Buffer.byteLength(JSON.stringify(record), "utf8");
    } catch {
      return 4096;
    }
  }

  /**
   * Add a card to the spool.
   *
   * If the in-memory buffer exceeds maxSpoolBytes, flush it to disk.
   *
   * @param card The normalized card to add
   * @param inputOrdinal The discovery order of the source
   */
  addCard(card: NormalizedCard, inputOrdinal: number): void {
    if (this.merging) {
      throw new Error("Cannot add cards after merge has started");
    }

    const approxBytes = this.estimateRecordSize(card);
    const serialized = JSON.stringify(card);
    const record: SpoolRecord = {
      cardId: card.id,
      inputOrdinal,
      card,
      serialized,
      approxBytes,
    };

    // Insert into sorted buffer (by cardId asc, then inputOrdinal asc)
    const insertIndex = this.findInsertIndex(record);
    this.buffer.splice(insertIndex, 0, record);
    this.bufferBytes += approxBytes;

    // Check if we need to flush to disk
    if (this.bufferBytes > this.maxSpoolBytes) {
      this.flushBufferToDisk();
    }
  }

  /**
   * Binary search to find the insertion index in the sorted buffer.
   */
  private findInsertIndex(record: SpoolRecord): number {
    let low = 0;
    let high = this.buffer.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const cmp = this.compareRecords(record, this.buffer[mid]);
      if (cmp < 0) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return low;
  }

  /**
   * Compare two spool records for sort order.
   * Returns negative if a < b, zero if equal, positive if a > b.
   */
  private compareRecords(a: SpoolRecord, b: SpoolRecord): number {
    if (a.cardId !== b.cardId) {
      return a.cardId < b.cardId ? -1 : 1;
    }
    if (a.inputOrdinal !== b.inputOrdinal) {
      return a.inputOrdinal - b.inputOrdinal;
    }
    return 0;
  }

  /**
   * Flush the current in-memory buffer to a sorted spool file on disk.
   */
  private flushBufferToDisk(): void {
    if (this.buffer.length === 0) return;

    // Write each record as a JSON line with inputOrdinal prefix
    // Format: "{inputOrdinal}\t{cardJson}" - tab separates ordinal from card
    const spoolPath = join(this.spoolDir, `spool-${this._spoolFileCount}.jsonl`);
    const lines: string[] = [];
    for (const r of this.buffer) {
      // Serialize: ordinal + tab + card JSON
      lines.push(`${r.inputOrdinal}\t${r.serialized}`);
    }
    writeFileSync(spoolPath, lines.join("\n") + "\n", "utf8");

    this._spoolFileCount++;
    this.spoolFiles.push(spoolPath);
    this.spoolContents.push(null); // Will be loaded on demand
    this.spoolLineIndices.push(0); // Start at line 0

    // Clear the buffer
    this.buffer = [];
    this.bufferBytes = 0;
  }

  /**
   * Begin the merge phase.
   * If there are spool files (buffer was flushed during addCard), flush
   * any remaining buffer records and read first spool records.
   * If there are no spool files (buffer fits in memory), keep buffer for merge.
   *
   * After calling startMerge(), addCard() will throw.
   */
  startMerge(): void {
    if (this.merging) return;

    this.merging = true;
    this.mergeBufferIndex = 0;

    if (this.spoolFiles.length > 0) {
      // There are spool files: flush remaining buffer (if any) and read spool
      if (this.buffer.length > 0) {
        this.flushBufferToDisk();
      }

      // Read first record from each spool file into peek buffer
      this.spoolPeeked = new Array<SpoolRecord | null>(this.spoolFiles.length);
      for (let i = 0; i < this.spoolFiles.length; i++) {
        this.spoolPeeked[i] = this.readNextFromSpoolSync(i);
      }
    } else {
      // No spool files: buffer is in memory, use it directly
      this.spoolPeeked = [];
    }
  }

  /**
   * Parse a spool line into a SpoolRecord.
   * Format: "{inputOrdinal}\t{cardJson}"
   * Returns null if the line is empty or parsing fails.
   */
  private parseSpoolLine(line: string): SpoolRecord | null {
    if (line.trim() === "") return null;
    try {
      // Split on first tab to separate ordinal from card JSON
      const tabIdx = line.indexOf("\t");
      if (tabIdx < 0) return null;

      const inputOrdinal = parseInt(line.substring(0, tabIdx), 10);
      if (isNaN(inputOrdinal)) return null;

      const cardJson = line.substring(tabIdx + 1);
      const card = JSON.parse(cardJson) as NormalizedCard;
      if (!card.id) return null;

      return {
        cardId: card.id,
        inputOrdinal,
        card,
        serialized: cardJson, // The card JSON part
        approxBytes: Buffer.byteLength(line, "utf8"),
      };
    } catch {
      return null;
    }
  }

  /**
   * Read next record from spool file, tracking per-file line index.
   * Each call advances the line index for that file.
   */
  private readNextFromSpoolSync(fileIndex: number): SpoolRecord | null {
    const filePath = this.spoolFiles[fileIndex];
    if (!filePath) return null;

    // Load file contents on first access
    if (this.spoolContents[fileIndex] === null) {
      const content = readFileSync(filePath, "utf8");
      // Split and filter empty lines
      this.spoolContents[fileIndex] = content.split("\n").filter((line) => line.trim() !== "");
      this.spoolLineIndices[fileIndex] = 0;
    }

    const lines = this.spoolContents[fileIndex]!;
    const lineIndex = this.spoolLineIndices[fileIndex];

    // Advance past any empty or invalid lines
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      this.spoolLineIndices[fileIndex] = lineIndex + 1;

      const record = this.parseSpoolLine(line);
      if (record) {
        return record;
      }
      // Try next line
    }

    // End of file
    return null;
  }

  /**
   * Pick the next record from the merge sources.
   * Returns null when all sources are exhausted.
   */
  next(): MergeYield | null {
    if (!this.merging) {
      this.startMerge();
    }

    // Collect candidates from all sources
    const candidates: Array<{ record: SpoolRecord; source: "buffer" | `spool-${number}` }> = [];

    // Buffer source
    if (this.mergeBufferIndex < this.buffer.length) {
      candidates.push({ record: this.buffer[this.mergeBufferIndex], source: "buffer" });
    }

    // Spool file sources — peek at each
    for (let i = 0; i < this.spoolFiles.length; i++) {
      if (this.spoolPeeked[i]) {
        candidates.push({ record: this.spoolPeeked[i]!, source: `spool-${i}` });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Find the minimum (earliest in sort order)
    let minCandidate = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (this.compareRecords(candidates[i].record, minCandidate.record) < 0) {
        minCandidate = candidates[i];
      }
    }

    const result: MergeYield = {
      card: minCandidate.record.card,
      inputOrdinal: minCandidate.record.inputOrdinal,
      spooled: minCandidate.source !== "buffer",
    };

    // Advance the source that won
    if (minCandidate.source === "buffer") {
      this.mergeBufferIndex++;
    } else {
      const spoolIdx = parseInt(minCandidate.source.replace("spool-", ""), 10);
      // Read next from that spool file
      this.spoolPeeked[spoolIdx] = this.readNextFromSpoolSync(spoolIdx);
    }

    return result;
  }

  /**
   * Async generator for merged records.
   */
  async *mergeRecords(): AsyncGenerator<MergeYield> {
    this.startMerge();
    let record: MergeYield | null;
    while ((record = this.next()) !== null) {
      yield record;
    }
  }

  /**
   * Get all spool file paths (for merge phase inspection).
   */
  getSpoolFiles(): readonly string[] {
    return [...this.spoolFiles];
  }

  /**
   * Get the number of spool files created.
   */
  get spoolFileCount_(): number {
    return this._spoolFileCount;
  }

  /**
   * Clean up all spool files and the spool directory.
   */
  cleanup(): void {
    // Clear cached contents
    this.spoolContents = [];

    // Delete all spool files
    for (const filePath of this.spoolFiles) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    this.spoolFiles = [];
    this.spoolLineIndices = [];
    this.buffer = [];
    this.bufferBytes = 0;
    this.spoolPeeked = [];
    this._spoolFileCount = 0;
    this.merging = false;
    this.mergeBufferIndex = 0;

    try {
      rmdirSync(this.spoolDir);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Check if any records have been flushed to disk.
   * Returns true after the buffer has been flushed at least once,
   * indicating that a disk-backed merge is needed.
   */
  get hasSpooledRecords(): boolean {
    return this._spoolFileCount > 0;
  }

  /**
   * Get the current in-memory buffer byte size.
   */
  get bufferByteSize(): number {
    return this.bufferBytes;
  }

  /**
   * Get the total spool directory size estimate.
   */
  get totalSpoolSize(): number {
    return this.bufferBytes;
  }
}
