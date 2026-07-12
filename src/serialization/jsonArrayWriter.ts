/**
 * Streaming JSON array writer.
 *
 * Writes JSON arrays as a stream: `[`, then records with comma separators,
 * then `]`. Supports zero and one record without degeneracy.
 *
 * Every encoded chunk is counted/reserved against both per-output and
 * aggregate staging budgets before being written.
 */

import { Writable } from "node:stream";
import { serializeJson } from "./canonicalJson.js";

/**
 * State of the JSON array writer.
 */
type WriterState = "INITIAL" | "OPEN" | "CLOSED" | "ABORTED";

/**
 * Options for the JSON array writer.
 */
export interface JsonArrayWriterOptions {
  /** Pretty-print with two-space indentation */
  pretty?: boolean;
  /** Reserve callback before write; return false to reject */
  reserve?: (bytes: number) => boolean;
  /** Reconcile callback after write */
  reconcile?: (bytes: number) => void;
}

/**
 * Streaming JSON array writer.
 *
 * Usage:
 *   const writer = new JsonArrayWriter(stdout);
 *   writer.write(record1);
 *   writer.write(record2);
 *   writer.close();
 */
export class JsonArrayWriter {
  private state: WriterState = "INITIAL";
  private recordCount = 0;
  private readonly stream: Writable;
  private readonly opts: Required<JsonArrayWriterOptions>;

  constructor(
    stream: Writable,
    options: JsonArrayWriterOptions = {}
  ) {
    this.stream = stream;
    this.opts = {
      pretty: options.pretty ?? false,
      reserve: options.reserve ?? (() => true),
      reconcile: options.reconcile ?? (() => {}),
    };
  }

  /**
   * Write one record to the array.
   * Automatically inserts the opening bracket on first write
   * and comma separators between records.
   */
  write(record: unknown): void {
    if (this.state === "CLOSED") {
      throw new Error("Cannot write to a closed JSON array writer");
    }
    if (this.state === "ABORTED") {
      throw new Error("Cannot write to an aborted JSON array writer");
    }

    // Open the array on first write
    if (this.state === "INITIAL") {
      const prefix = this.opts.pretty ? "[\n" : "[";
      if (!this.opts.reserve(Buffer.byteLength(prefix, "utf-8"))) {
        throw new Error("Staging budget exceeded for array prefix");
      }
      this.stream.write(prefix);
      this.opts.reconcile(Buffer.byteLength(prefix, "utf-8"));
      this.state = "OPEN";
    }

    // Add comma separator for subsequent records
    if (this.recordCount > 0) {
      const separator = this.opts.pretty ? ",\n" : ",";
      if (!this.opts.reserve(Buffer.byteLength(separator, "utf-8"))) {
        throw new Error("Staging budget exceeded for array separator");
      }
      this.stream.write(separator);
      this.opts.reconcile(Buffer.byteLength(separator, "utf-8"));
    }

    // Serialize and write the record
    const json = this.opts.pretty
      ? serializeJson(record, { pretty: true })
      : serializeJson(record);

    const bytes = Buffer.byteLength(json, "utf-8");
    if (!this.opts.reserve(bytes)) {
      throw new Error("Staging budget exceeded for array record");
    }

    // In pretty mode, indent each record
    if (this.opts.pretty) {
      const indented = json
        .split("\n")
        .map((line, i) => (i === 0 ? "  " + line : line))
        .join("\n");
      this.stream.write(indented);
      this.opts.reconcile(Buffer.byteLength(indented, "utf-8"));
    } else {
      this.stream.write(json);
      this.opts.reconcile(bytes);
    }

    this.recordCount++;
  }

  /**
   * Close the array by writing the closing bracket.
   * Must be called after all records are written.
   */
  close(): void {
    if (this.state === "CLOSED") return;
    if (this.state === "ABORTED") return;

    if (this.state === "INITIAL") {
      // Write empty array
      const empty = "[]";
      if (!this.opts.reserve(Buffer.byteLength(empty, "utf-8"))) {
        throw new Error("Staging budget exceeded for empty array");
      }
      this.stream.write(empty);
      this.opts.reconcile(Buffer.byteLength(empty, "utf-8"));
    } else {
      const suffix = this.opts.pretty ? "\n]" : "]";
      if (!this.opts.reserve(Buffer.byteLength(suffix, "utf-8"))) {
        throw new Error("Staging budget exceeded for array suffix");
      }
      this.stream.write(suffix);
      this.opts.reconcile(Buffer.byteLength(suffix, "utf-8"));
    }

    this.stream.write("\n");
    this.state = "CLOSED";
  }

  /**
   * Abort the writer without closing the array.
   * Does not write the closing bracket.
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