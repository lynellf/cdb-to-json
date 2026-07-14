/**
 * Writer-neutral output boundary.
 *
 * Defines the contract that all output destinations must satisfy.
 * Domain/application code receives implementations of this interface,
 * never raw Writable streams or filesystem paths.
 */

/**
 * Writer lifecycle states.
 */
export type WriterState =
  | "OPEN"
  | "CLOSED"
  | "ABORTED";

/**
 * Named callback options for OutputWriter adapters.
 *
 * - reserve(bytes):  Called before each write with the encoded chunk byte length.
 *                    Return false to reject the write before any sink effect.
 * - reconcile(bytes): Called exactly once after each successful sink effect,
 *                     with the same byte length. Use for aggregate accounting.
 *                     If it throws, the writer aborts and bytesWritten does not
 *                     advance for that write.
 */
export interface OutputWriterOptions {
  reserve?: (bytes: number) => boolean;
  reconcile?: (bytes: number) => void;
}

/**
 * Writer-neutral output interface.
 *
 * Accepts encoded UTF-8 chunks and owns lifecycle.
 * write/flush/close/abort are all async to support
 * file and directory destinations with native commit barriers.
 *
 * - write():  Accept an encoded chunk for the output.
 * - flush():  Ensure buffered data is persisted to the storage layer.
 * - close():  Finalize the output. Sets committed=true on success.
 * - abort():  Terminate without committing. Resources may be cleaned.
 */
export interface OutputWriter {
  /**
   * Write an encoded UTF-8 chunk to this output.
   * Must check budget and may throw RESOURCE_LIMIT_EXCEEDED.
   */
  write(chunk: Uint8Array): Promise<void>;

  /**
   * Flush buffered data to the underlying storage.
   */
  flush(): Promise<void>;

  /**
   * Close the writer and mark output as committed.
   * After this call, committed must be true.
   */
  close(): Promise<void>;

  /**
   * Abort the writer without committing.
   * Resources (temp files, locks) should be released.
   * committed must remain false.
   */
  abort(reason?: unknown): Promise<void>;

  /**
   * Whether this writer has successfully committed its output.
   * True only after close() completes without error.
   * A non-atomic writer (stdout) may report committed=true after close.
   */
  readonly committed: boolean;

  /**
   * Current lifecycle state.
   */
  readonly state: WriterState;

  /**
   * Total bytes written (encoded UTF-8).
   */
  readonly bytesWritten: number;
}

/**
 * In-memory test sink for OutputWriter.
 * Collects all written chunks for assertion.
 */
export class TestOutputSink implements OutputWriter {
  private _state: WriterState = "OPEN";
  private _committed = false;
  private _chunks: Uint8Array[] = [];
  private _bytesWritten = 0;
  private readonly _options: OutputWriterOptions;

  constructor(options?: OutputWriterOptions) {
    this._options = options ?? {};
  }

  private _reserve(bytes: number): boolean {
    if (!this._options.reserve) return true;
    return this._options.reserve(bytes);
  }

  private _reconcile(bytes: number): void {
    if (this._options.reconcile) {
      this._options.reconcile(bytes);
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this._state !== "OPEN") {
      throw new Error("Cannot write to a non-OPEN writer");
    }
    const bytes = chunk.byteLength;

    // Step 1: reserve check
    if (!this._reserve(bytes)) {
      // Reservation rejected: no sink, no reconcile, no counter change
      throw new Error("RESOURCE_LIMIT_EXCEEDED");
    }

    // Step 2: sink effect
    this._chunks.push(chunk);

    // Step 3: reconcile after successful sink
    try {
      this._reconcile(bytes);
    } catch (err) {
      // Reconciliation threw: abort, do not advance counter
      this._state = "ABORTED";
      this._committed = false;
      throw err;
    }

    // Step 4: advance counter only after reconciliation returns
    this._bytesWritten += bytes;
  }

  async flush(): Promise<void> {
    if (this._state === "ABORTED") {
      throw new Error("Cannot flush an aborted writer");
    }
    // In-memory sink: no pending data
  }

  async close(): Promise<void> {
    if (this._state === "CLOSED") return;
    if (this._state === "ABORTED") {
      throw new Error("Cannot close an aborted writer");
    }
    // Must await successful flush before committing
    await this.flush();
    this._state = "CLOSED";
    this._committed = true;
  }

  async abort(_reason?: unknown): Promise<void> {
    if (this._state === "ABORTED" || this._state === "CLOSED") return;
    this._state = "ABORTED";
    this._committed = false;
  }

  get committed(): boolean {
    return this._committed;
  }

  get state(): WriterState {
    return this._state;
  }

  get bytesWritten(): number {
    return this._bytesWritten;
  }

  /** Get all chunks concatenated as a string. */
  get text(): string {
    return Buffer.concat(this._chunks).toString("utf-8");
  }

  /** Get all chunks concatenated as a Buffer. */
  get buffer(): Buffer {
    return Buffer.concat(this._chunks);
  }

  /** Get all individual chunks. */
  get chunks(): Uint8Array[] {
    return [...this._chunks];
  }

  /** Number of write calls. */
  get chunkCount(): number {
    return this._chunks.length;
  }
}

/**
 * Adapter to wrap a simple (data: string) => void callback
 * as an OutputWriter.
 */
export class CallbackOutputWriter implements OutputWriter {
  private _state: WriterState = "OPEN";
  private _committed = false;
  private _bytesWritten = 0;
  private readonly _writeFn: (data: string) => void;
  private readonly _options: OutputWriterOptions;

  constructor(
    writeFn: (data: string) => void,
    options?: OutputWriterOptions
  ) {
    this._writeFn = writeFn;
    this._options = options ?? {};
  }

  private _reserve(bytes: number): boolean {
    if (!this._options.reserve) return true;
    return this._options.reserve(bytes);
  }

  private _reconcile(bytes: number): void {
    if (this._options.reconcile) {
      this._options.reconcile(bytes);
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this._state !== "OPEN") {
      throw new Error("Cannot write to a non-OPEN writer");
    }
    const bytes = chunk.byteLength;

    // Step 1: reserve check
    if (!this._reserve(bytes)) {
      throw new Error("RESOURCE_LIMIT_EXCEEDED");
    }

    // Step 2: sink effect (may throw)
    try {
      this._writeFn(Buffer.from(chunk).toString("utf-8"));
    } catch (err) {
      // Sink failed: abort without advancing counter
      this._state = "ABORTED";
      this._committed = false;
      throw err;
    }

    // Step 3: reconcile after successful sink
    try {
      this._reconcile(bytes);
    } catch (err) {
      this._state = "ABORTED";
      this._committed = false;
      throw err;
    }

    // Step 4: advance counter only after reconciliation returns
    this._bytesWritten += bytes;
  }

  async flush(): Promise<void> {
    if (this._state === "ABORTED") {
      throw new Error("Cannot flush an aborted writer");
    }
    // No-op for callback-based writers: sink is already satisfied
  }

  async close(): Promise<void> {
    if (this._state === "CLOSED") return;
    if (this._state === "ABORTED") {
      throw new Error("Cannot close an aborted writer");
    }
    // Must await successful flush before committing
    await this.flush();
    this._state = "CLOSED";
    this._committed = true;
  }

  async abort(_reason?: unknown): Promise<void> {
    if (this._state === "ABORTED" || this._state === "CLOSED") return;
    this._state = "ABORTED";
    this._committed = false;
  }

  get committed(): boolean {
    return this._committed;
  }

  get state(): WriterState {
    return this._state;
  }

  get bytesWritten(): number {
    return this._bytesWritten;
  }
}

/**
 * StdoutOutputWriter — wraps a Writable stream as an OutputWriter.
 * Stdout is intentionally non-atomic: a late error may leave earlier bytes.
 * Does not charge encoded chunks to private staging budget by default.
 */
export class StdoutOutputWriter implements OutputWriter {
  private _state: WriterState = "OPEN";
  private _committed = false;
  private _bytesWritten = 0;
  private readonly _stream: import("node:stream").Writable;
  private readonly _options: OutputWriterOptions;

  /**
   * Pending write operations. Each entry is a promise resolver pair that
   * resolves/rejects only when that specific write's callback fires.
   * This allows flush() to await exactly the writes that were in flight
   * when flush() was called.
   */
  private readonly _pendingWrites: Array<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  /** Sticky first observed error; set once by any write callback and never cleared. */
  private _observedError: Error | null = null;

  constructor(
    stream: import("node:stream").Writable,
    options?: OutputWriterOptions
  ) {
    this._stream = stream;
    this._options = options ?? {};
  }

  private _reserve(bytes: number): boolean {
    if (!this._options.reserve) return true;
    return this._options.reserve(bytes);
  }

  private _reconcile(bytes: number): void {
    if (this._options.reconcile) {
      this._options.reconcile(bytes);
    }
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (this._state !== "OPEN") {
      throw new Error("Cannot write to a non-OPEN writer");
    }
    const bytes = chunk.byteLength;

    // Step 1: reserve check (per-output, not aggregate staging)
    if (!this._reserve(bytes)) {
      throw new Error("RESOURCE_LIMIT_EXCEEDED");
    }

    // Step 2: sink effect (may throw synchronously or emit error asynchronously).
    //
    // IMPORTANT — Writable stream semantics: when the callback is called with an
    // error argument (e.g. callback(new Error(...))) from inside _write, Node.js
    // calls the callback TWICE:
    //   1. First with err=<the error>: our code processes it, records _observedError.
    //   2. Then with err=undefined as a cleanup call: our code must NOT overwrite
    //      _observedError or re-invoke the write completion.
    // We detect the cleanup call by checking whether _observedError was already set
    // AND whether this pending write has already been settled.

    // Create a per-write completion promise. This promise resolves ONLY when
    // the specific write callback fires (success or error), allowing flush() to
    // correctly await actual write completion.
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
        // First call with error: record the observed error.
        // We resolve the promise (rather than reject) to avoid unhandled rejection
        // warnings. The error is tracked in _observedError and surfaced by flush().
        if (!this._observedError) {
          this._observedError = err;
        }
        pending.resolve();
      } else if (this._observedError) {
        // Cleanup call with undefined when there was already an error.
        // Do NOT resolve the promise again.
        return;
      } else {
        // Normal successful completion — resolve this write's promise.
        pending.resolve();
      }
    };

    let syncThrow: unknown;
    try {
      this._stream.write(Buffer.from(chunk), "utf8", writeCallback);
    } catch (err) {
      syncThrow = err;
    }

    if (syncThrow !== undefined) {
      // Synchronous throw: remove this pending write and abort.
      const idx = this._pendingWrites.indexOf(pending);
      if (idx !== -1) this._pendingWrites.splice(idx, 1);
      this._state = "ABORTED";
      this._committed = false;
      throw syncThrow;
    }

    // Step 3: reconcile after successful sink
    // This is called synchronously so that _bytesWritten advances before
    // write() returns and errors propagate correctly to the caller.
    try {
      this._reconcile(bytes);
    } catch (err) {
      this._state = "ABORTED";
      this._committed = false;
      throw err;
    }

    // Step 4: advance counter only after reconciliation returns
    this._bytesWritten += bytes;
    // NOTE: The pending write promise resolves when the callback fires,
    // allowing flush() to await actual write completion.
  }

  async flush(): Promise<void> {
    if (this._state === "ABORTED") {
      throw new Error("Cannot flush an aborted writer");
    }
    if (this._state === "CLOSED") {
      // CLOSED flush: idempotent no-op
      return;
    }
    // If no writes are pending, return immediately.
    if (this._pendingWrites.length === 0) {
      // But still check for observed errors from previous writes.
      if (this._observedError) {
        this._state = "ABORTED";
        this._committed = false;
        throw this._observedError;
      }
      return;
    }

    // Collect the pending writes at flush entry time.
    const writesToAwait = [...this._pendingWrites];

    // Await all pending write completions. Each promise resolves when its
    // specific callback fires. Any error will reject its promise and set
    // _observedError.
    await Promise.all(writesToAwait.map((w) => w.promise));

    // After all writes have completed, check for observed errors.
    if (this._observedError) {
      this._state = "ABORTED";
      this._committed = false;
      throw this._observedError;
    }
  }

  async close(): Promise<void> {
    if (this._state === "CLOSED") return;
    if (this._state === "ABORTED") {
      throw new Error("Cannot close an aborted writer");
    }
    // Must await successful flush before committing.
    // flush() will reject if there's an observed error, causing close()
    // to reject and leaving the writer ABORTED/uncommitted.
    await this.flush();
    this._state = "CLOSED";
    this._committed = true;
  }

  async abort(_reason?: unknown): Promise<void> {
    if (this._state === "ABORTED" || this._state === "CLOSED") return;
    this._state = "ABORTED";
    this._committed = false;
  }

  get committed(): boolean {
    return this._committed;
  }

  get state(): WriterState {
    return this._state;
  }

  get bytesWritten(): number {
    return this._bytesWritten;
  }
}
