/**
 * Incremental writer for one cdb.raw/1 database envelope.
 *
 * The two table arrays are deliberately written in separate phases. The raw
 * reader can therefore make one bounded pass for datas and one bounded pass
 * for texts without retaining a complete database in memory.
 */

import type { RawDatasRow, RawTextsRow } from "../cdb/rawTypes.js";
import { serializeJson } from "../serialization/canonicalJson.js";
import type { RawExtraTable } from "./rawProfile.js";

export interface RawEnvelopeStreamMetadata {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  extraTables: readonly RawExtraTable[];
}

export interface RawEnvelopeStreamWriterOptions {
  format: "json" | "jsonl";
  pretty?: boolean;
  /** Maximum encoded UTF-8 bytes this writer may emit. */
  maxOutputBytes?: number;
  /** Optional reservation hook invoked before each encoded chunk. */
  reserve?: (bytes: number) => boolean;
  /** Optional accounting hook invoked after each successful chunk write. */
  reconcile?: (bytes: number) => void;
  write: (chunk: string) => void;
}

/** Stable error raised before a chunk would exceed the logical output limit. */
export class RawEnvelopeOutputLimitError extends Error {
  readonly code = "RESOURCE_LIMIT_EXCEEDED" as const;

  constructor(message: string) {
    super(message);
    this.name = "RawEnvelopeOutputLimitError";
  }
}

/** Stable error wrapper for a sink failure after a chunk was admitted. */
export class RawEnvelopeSinkError extends Error {
  readonly causeError: unknown;

  constructor(cause: unknown) {
    super(`Raw envelope output failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RawEnvelopeSinkError";
    this.causeError = cause;
  }
}

type RawWriterState = "NEW" | "DATAS" | "TEXTS" | "CLOSED" | "ABORTED";

function indentPrettyJson(json: string, prefix: string): string {
  const lines = json.split("\n");
  return lines
    .map((line, index) => (index === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

/** Incrementally emits a single raw JSON or JSONL envelope. */
export class RawEnvelopeStreamWriter {
  private readonly pretty: boolean;
  private readonly maxOutputBytes: number;
  private readonly reserveChunk: (bytes: number) => boolean;
  private readonly reconcileChunk: (bytes: number) => void;
  private readonly writeChunk: (chunk: string) => void;
  private state: RawWriterState = "NEW";
  private datasCount = 0;
  private textsCount = 0;
  private bytesWritten = 0;
  private extraTables: readonly RawExtraTable[] = [];

  constructor(options: RawEnvelopeStreamWriterOptions) {
    if (options.format === "jsonl" && options.pretty) {
      throw new Error("Raw JSONL does not support pretty output");
    }
    this.pretty = options.pretty ?? false;
    this.maxOutputBytes = options.maxOutputBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 0) {
      throw new Error("Raw envelope maxOutputBytes must be a non-negative safe integer");
    }
    this.reserveChunk = options.reserve ?? (() => true);
    this.reconcileChunk = options.reconcile ?? (() => {});
    this.writeChunk = options.write;
  }

  start(metadata: RawEnvelopeStreamMetadata): void {
    if (this.state !== "NEW") throw new Error("Raw envelope writer has already started");
    this.extraTables = metadata.extraTables.map((table) => ({
      name: table.name,
      columns: [...table.columns],
      rowCount: table.rowCount,
    }));

    const source = serializeJson(
      {
        fileName: metadata.fileName,
        sha256: metadata.sha256,
        sizeBytes: metadata.sizeBytes,
        converter: "cdb-to-json/2.0.0",
      },
      { pretty: this.pretty },
    );

    if (!this.pretty) {
      this.emit(
        `{"schema":"cdb.raw/1","integerEncoding":"signed-int64-decimal","source":${source},"tables":{"datas":[`,
      );
    } else {
      const sourceLines = source.split("\n");
      this.emit(
        `{
  "schema": "cdb.raw/1",
  "integerEncoding": "signed-int64-decimal",
  "source": ${sourceLines[0]}`,
      );
      for (const line of sourceLines.slice(1)) this.emit(`\n  ${line}`);
      this.emit(
        `,
  "tables": {
    "datas": [`,
      );
    }
    this.state = "DATAS";
  }

  writeDatas(row: RawDatasRow): void {
    if (this.state !== "DATAS") throw new Error("Raw datas array is not open");
    this.writeRow(row, this.datasCount);
    this.datasCount += 1;
  }

  finishDatas(): void {
    if (this.state !== "DATAS") throw new Error("Raw datas array is not open");
    this.emit(this.pretty ? `\n    ],\n    "texts": [` : `],"texts":[`);
    this.state = "TEXTS";
  }

  writeTexts(row: RawTextsRow): void {
    if (this.state !== "TEXTS") throw new Error("Raw texts array is not open");
    this.writeRow(row, this.textsCount);
    this.textsCount += 1;
  }

  finish(): void {
    if (this.state !== "TEXTS") throw new Error("Raw texts array must be open before finish");
    const extra = serializeJson(this.extraTables, { pretty: this.pretty });
    if (!this.pretty) {
      this.emit(`]},"extraTables":${extra}}\n`);
    } else {
      this.emit(`\n    ]\n  },\n  "extraTables": ${indentPrettyJson(extra, "  ")}\n}\n`);
    }
    this.state = "CLOSED";
  }

  abort(): void {
    this.state = "ABORTED";
  }

  get records(): { datas: number; texts: number } {
    return { datas: this.datasCount, texts: this.textsCount };
  }

  private writeRow(row: RawDatasRow | RawTextsRow, count: number): void {
    const json = serializeJson(row, { pretty: this.pretty });
    if (!this.pretty) {
      this.emit(`${count === 0 ? "" : ","}${json}`);
      return;
    }
    this.emit(`${count === 0 ? "\n" : ",\n"}${indentPrettyJson(json, "      ")}`);
  }

  get outputBytes(): number {
    return this.bytesWritten;
  }

  private emit(chunk: string): void {
    const bytes = Buffer.byteLength(chunk, "utf8");
    if (bytes > this.maxOutputBytes - this.bytesWritten) {
      this.state = "ABORTED";
      throw new RawEnvelopeOutputLimitError(
        `Raw envelope output exceeds maxOutputBytes (${this.bytesWritten + bytes} > ${this.maxOutputBytes})`,
      );
    }
    if (!this.reserveChunk(bytes)) {
      this.state = "ABORTED";
      throw new RawEnvelopeOutputLimitError(
        `Raw envelope chunk reservation rejected (${bytes} bytes)`,
      );
    }
    try {
      this.writeChunk(chunk);
    } catch (error) {
      this.state = "ABORTED";
      throw new RawEnvelopeSinkError(error);
    }
    this.bytesWritten += bytes;
    try {
      this.reconcileChunk(bytes);
    } catch (error) {
      this.state = "ABORTED";
      throw error;
    }
  }
}
