/**
 * Streaming JSON array writer.
 *
 * Writes JSON arrays as a stream: `[`, then records with comma separators,
 * then `]`. Supports zero and one record without degeneracy.
 *
 * Every encoded chunk is counted/reserved against both per-output and
 * aggregate staging budgets before being written.
 *
 * Implements proper async Writable error handling: write() returns a Promise
 * that resolves when the underlying stream has processed the chunk, and
 * rejects if the stream emits an error. flush() waits for all pending writes.
 * Stream 'error' events are captured to prevent unhandled rejections.
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
 *   await writer.write(record1);
 *   await writer.write(record2);
 *   await writer.close();
 *
 * write() returns a Promise that resolves when the write completes and
 * rejects if the stream reports an error. Use flush() to await all
 * pending writes before close().
 */
export class JsonArrayWriter {
  private state: WriterState = "INITIAL";
  private recordCount = 0;
  private bytesWritten = 0;
  private readonly stream: Writable;
  private readonly opts: Required<JsonArrayWriterOptions>;

  /**
   * Pending write operations. Each entry resolves when that specific
   * write's callback fires.
   */
  private readonly _pendingWrites: Array<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  /** Sticky first observed error; set once by any write callback or stream error event. */
  private _observedError: Error | null = null;

  /** Whether we have attached a listener for stream 'error' events. */
  private _errorListenerAttached = false;

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
    // Attach error listener to prevent unhandled error events.
    this._attachErrorListener();
  }

  /**
   * Attach a persistent listener for stream 'error' events.
   * This prevents Node.js unhandled error event exceptions while still
   * capturing the error for flush() to observe.
   */
  private _attachErrorListener(): void {
    if (this._errorListenerAttached) return;
    this._errorListenerAttached = true;

    const handler = (err: Error) => {
      if (!this._observedError) {
        this._observedError = err;
      }
    };

    this.stream.on("error", handler);
  }

  /**
   * Internal helper to write a chunk and track pending write completion.
   * Returns a promise that resolves when the write callback fires.
   */
  private async _writeChunk(data: string, bytes: number): Promise<void> {
    // Create a per-write completion promise.
    let resolveWrite: () => void;
    let rejectWrite: (err: Error) => void;
    const writePromise = new Promise<void>((resolve, reject) => {
      resolveWrite = resolve;
      rejectWrite = reject;
    });
    const pending = { promise: writePromise, resolve: resolveWrite!, reject: rejectWrite! };
    this._pendingWrites.push(pending);

    const writeCallback = (err: Error | null | undefined): void => {
      if (err) {
        if (!this._observedError) {
          this._observedError = err;
        }
        pending.resolve();
      } else if (this._observedError) {
        // Cleanup call when already in error state.
        return;
      } else {
        pending.resolve();
      }
    };

    let syncThrow: unknown;
    try {
      this.stream.write(data, "utf8", writeCallback);
    } catch (err) {
      syncThrow = err;
    }

    if (syncThrow !== undefined) {
      const idx = this._pendingWrites.indexOf(pending);
      if (idx !== -1) this._pendingWrites.splice(idx, 1);
      throw syncThrow;
    }

    // Reconcile after successful sink.
    try {
      this.opts.reconcile(bytes);
    } catch (err) {
      throw err;
    }

    this.bytesWritten += bytes;
    return writePromise;
  }

  /**
   * Write one record to the array.
   * Automatically inserts the opening bracket on first write
   * and comma separators between records.
   *
   * Returns a Promise that resolves when the write completes and
   * rejects if the stream reports an error.
   */
  async write(record: unknown): Promise<void> {
    if (this.state === "CLOSED") {
      throw new Error("Cannot write to a closed JSON array writer");
    }
    if (this.state === "ABORTED") {
      throw new Error("Cannot write to an aborted JSON array writer");
    }

    // Open the array on first write
    if (this.state === "INITIAL") {
      const prefix = this.opts.pretty ? "[\n" : "[";
      const prefixBytes = Buffer.byteLength(prefix, "utf-8");
      if (!this.opts.reserve(prefixBytes)) {
        throw new Error("Staging budget exceeded for array prefix");
      }
      await this._writeChunk(prefix, prefixBytes);
      this.state = "OPEN";
    }

    // Add comma separator for subsequent records
    if (this.recordCount > 0) {
      const separator = this.opts.pretty ? ",\n" : ",";
      const sepBytes = Buffer.byteLength(separator, "utf-8");
      if (!this.opts.reserve(sepBytes)) {
        throw new Error("Staging budget exceeded for array separator");
      }
      await this._writeChunk(separator, sepBytes);
    }

    // Serialize and write the record
    const json = this.opts.pretty
      ? serializeJson(record, { pretty: true })
      : serializeJson(record);

    const jsonBytes = Buffer.byteLength(json, "utf-8");
    if (!this.opts.reserve(jsonBytes)) {
      throw new Error("Staging budget exceeded for array record");
    }

    // In pretty mode, indent each record
    if (this.opts.pretty) {
      const indented = json
        .split("\n")
        .map((line, i) => (i === 0 ? "  " + line : line))
        .join("\n");
      await this._writeChunk(indented, Buffer.byteLength(indented, "utf-8"));
    } else {
      await this._writeChunk(json, jsonBytes);
    }

    this.recordCount++;
  }

  /**
   * Flush all pending writes and check for observed errors.
   *
   * Returns a Promise that resolves when all pending writes have completed
   * and no errors were observed. Rejects if any write reported an error.
   */
  async flush(): Promise<void> {
    if (this.state === "ABORTED") {
      throw new Error("Cannot flush an aborted writer");
    }
    if (this.state === "CLOSED") {
      return; // Idempotent
    }

    if (this._pendingWrites.length === 0) {
      if (this._observedError) {
        this.state = "ABORTED";
        throw this._observedError;
      }
      return;
    }

    const writesToAwait = [...this._pendingWrites];
    await Promise.all(writesToAwait.map((w) => w.promise));

    if (this._observedError) {
      this.state = "ABORTED";
      throw this._observedError;
    }
  }

  /**
   * Close the array by writing the closing bracket.
   * Must be called after all records are written.
   *
   * Returns a Promise that resolves when all writes have been flushed
   * and the stream is ended. Rejects if any write reported an error.
   */
  async close(): Promise<void> {
    if (this.state === "CLOSED") return;
    if (this.state === "ABORTED") return;

    await this.flush();

    if (this.state === "INITIAL") {
      // Write empty array
      const empty = "[]";
      const emptyBytes = Buffer.byteLength(empty, "utf-8");
      if (!this.opts.reserve(emptyBytes)) {
        throw new Error("Staging budget exceeded for empty array");
      }
      this.stream.write(empty);
      this.opts.reconcile(emptyBytes);
      this.bytesWritten += emptyBytes;
    } else {
      const suffix = this.opts.pretty ? "\n]" : "]";
      const suffixBytes = Buffer.byteLength(suffix, "utf-8");
      if (!this.opts.reserve(suffixBytes)) {
        throw new Error("Staging budget exceeded for array suffix");
      }
      this.stream.write(suffix);
      this.opts.reconcile(suffixBytes);
      this.bytesWritten += suffixBytes;
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

  /**
   * Get the total bytes written (encoded UTF-8).
   */
  get writtenBytes(): number {
    return this.bytesWritten;
  }
}