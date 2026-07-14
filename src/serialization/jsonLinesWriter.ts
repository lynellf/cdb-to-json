/**
 * JSON Lines writer.
 *
 * Writes one compact JSON object per line (JSONL format).
 * Rejects pretty mode since JSONL requires one record per line.
 *
 * Every encoded chunk is counted/reserved against budgets before writing.
 *
 * Implements proper async Writable error handling: write() returns a Promise
 * that resolves when the underlying stream has processed the chunk, and
 * rejects if the stream emits an error. flush() waits for all pending writes.
 * Stream 'error' events are captured to prevent unhandled rejections.
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
 * write() returns a Promise that resolves when the write completes and
 * rejects if the stream reports an error. Use flush() to await all
 * pending writes before close().
 */
export class JsonLinesWriter {
  private state: WriterState = "OPEN";
  private recordCount = 0;
  private bytesWritten = 0;
  private readonly stream: Writable;
  private readonly opts: Required<JsonLinesWriterOptions>;

  /**
   * Pending write operations. Each entry resolves/rejects when that
   * specific write's callback fires.
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
    options: JsonLinesWriterOptions = {}
  ) {
    this.stream = stream;
    this.opts = {
      reserve: options.reserve ?? (() => true),
      reconcile: options.reconcile ?? (() => {}),
    };
    // Attach error listener to prevent unhandled error events.
    // Errors from the stream will be captured and surfaced via _observedError.
    this._attachErrorListener();
  }

  /**
   * Attach a one-time (actually persistent) listener for stream 'error' events.
   * This prevents Node.js unhandled error event exceptions while still
   * capturing the error for flush() to observe.
   */
  private _attachErrorListener(): void {
    if (this._errorListenerAttached) return;
    this._errorListenerAttached = true;

    const handler = (err: Error) => {
      // Capture the error if not already captured.
      if (!this._observedError) {
        this._observedError = err;
      }
    };

    // Use once to avoid duplicate handlers if called multiple times,
    // but we guard with _errorListenerAttached anyway.
    this.stream.on("error", handler);
  }

  /**
   * Write one record as a JSON Line.
   * Output is always compact JSON followed by "\n".
   *
   * Returns a Promise that resolves when the write callback fires,
   * and rejects if the stream reports an error.
   */
  async write(record: unknown): Promise<void> {
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
        // First error: record it and resolve (not reject) to avoid unhandled rejection.
        // The error is surfaced via _observedError and checked in flush().
        if (!this._observedError) {
          this._observedError = err;
        }
        pending.resolve();
      } else if (this._observedError) {
        // Cleanup call when already in error state: do not resolve again.
        return;
      } else {
        // Normal successful completion.
        pending.resolve();
      }
    };

    let syncThrow: unknown;
    try {
      this.stream.write(line, "utf8", writeCallback);
    } catch (err) {
      syncThrow = err;
    }

    if (syncThrow !== undefined) {
      // Synchronous throw: remove pending write and abort.
      const idx = this._pendingWrites.indexOf(pending);
      if (idx !== -1) this._pendingWrites.splice(idx, 1);
      this.state = "ABORTED";
      throw syncThrow;
    }

    // Reconcile after successful sink (called synchronously).
    try {
      this.opts.reconcile(bytes);
    } catch (err) {
      this.state = "ABORTED";
      throw err;
    }

    this.bytesWritten += bytes;
    this.recordCount++;

    // Return the write completion promise so callers can await it.
    return writePromise;
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
      // No pending writes: still check for errors from previous flush calls.
      if (this._observedError) {
        this.state = "ABORTED";
        throw this._observedError;
      }
      return;
    }

    // Collect and await all pending writes.
    const writesToAwait = [...this._pendingWrites];
    await Promise.all(writesToAwait.map((w) => w.promise));

    // After all writes complete, check for observed errors.
    if (this._observedError) {
      this.state = "ABORTED";
      throw this._observedError;
    }
  }

  /**
   * Close the writer. Ensures all buffered data is flushed.
   *
   * Returns a Promise that resolves when all writes have been flushed
   * and the stream is ended. Rejects if any write reported an error.
   */
  async close(): Promise<void> {
    if (this.state === "CLOSED") return;
    if (this.state === "ABORTED") return;

    await this.flush();
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

  /**
   * Get the total bytes written (encoded UTF-8).
   */
  get writtenBytes(): number {
    return this.bytesWritten;
  }
}