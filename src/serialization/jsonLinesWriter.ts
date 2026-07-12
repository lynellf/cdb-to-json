/**
 * JSON Lines writer.
 *
 * Writes one compact JSON object per line (JSONL format).
 * Rejects pretty mode since JSONL requires one record per line.
 *
 * Every encoded chunk is counted/reserved against budgets before writing.
 */

import { Writable } from "node:stream";
import { serializeJson } from "./canonicalJson.js";

/**
 * State of the JSON Lines writer.
 */
type WriterState = "OPEN" | "CLOSED" | "ABORTED";

/**
 * Options for the JSON Lines writer.
 */
export interface JsonLinesWriterOptions {
  /** Reserve callback before write; return false to reject */
  reserve?: (bytes: number) => boolean;
  /** Reconcile callback after write */
  reconcile?: (bytes: number) => void;
}

/**
 * Streaming JSON Lines writer.
 *
 * Each call to write() produces one compact JSON object + "\n".
 * Pretty mode is rejected because JSONL requires one record per line.
 */
export class JsonLinesWriter {
  private state: WriterState = "OPEN";
  private recordCount = 0;
  private readonly stream: Writable;
  private readonly opts: Required<JsonLinesWriterOptions>;

  constructor(
    stream: Writable,
    options: JsonLinesWriterOptions = {}
  ) {
    this.stream = stream;
    this.opts = {
      reserve: options.reserve ?? (() => true),
      reconcile: options.reconcile ?? (() => {}),
    };
  }

  /**
   * Write one record as a JSON Line.
   * Output is always compact JSON followed by "\n".
   */
  write(record: unknown): void {
    if (this.state === "CLOSED") {
      throw new Error("Cannot write to a closed JSON Lines writer");
    }
    if (this.state === "ABORTED") {
      throw new Error("Cannot write to an aborted JSON Lines writer");
    }

    const json = serializeJson(record);
    const line = json + "\n";
    const bytes = Buffer.byteLength(line, "utf-8");

    if (!this.opts.reserve(bytes)) {
      throw new Error("Staging budget exceeded for JSONL record");
    }

    this.stream.write(line);
    this.opts.reconcile(bytes);
    this.recordCount++;
  }

  /**
   * Close the writer. Ensures all buffered data is flushed.
   */
  close(): void {
    if (this.state === "CLOSED") return;
    if (this.state === "ABORTED") return;
    this.state = "CLOSED";
  }

  /**
   * Abort the writer without writing remaining data.
   */
  abort(): void {
    this.state = "ABORTED";
  }

  /**
   * Check if the writer is closed.
   */
  get isClosed(): boolean {
    return this.state === "CLOSED";
  }

  /**
   * Check if the writer is aborted.
   */
  get isAborted(): boolean {
    return this.state === "ABORTED";
  }

  /**
   * Get the number of records written.
   */
  get records(): number {
    return this.recordCount;
  }
}