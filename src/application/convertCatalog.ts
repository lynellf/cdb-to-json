/**
 * Conversion application service.
 * Orchestrates the conversion pipeline: input discovery → snapshot/open
 * → read rows → build envelope → serialize → output.
 *
 * Process databases sequentially. Returns one aggregate result.
 */

import { iterateRawCards } from "../cdb/iterateRows.js";
import { probeNativeCapabilityAsync } from "../destinations/secureDestination.js";
import { FileDestinationError } from "../destinations/fileDestination.js";
import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { DiagnosticCollector, type DiagnosticSummary } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import type { NormalizedConvertOptions } from "./types.js";
import { validateLimitRelations } from "./types.js";
import { validateOutputPlan, validateOutputCardinality } from "./outputPlan.js";
import {
  RawEnvelopeOutputLimitError,
  RawEnvelopeSinkError,
  RawEnvelopeStreamWriter,
  type RawEnvelopeStreamMetadata,
} from "../profiles/rawEnvelopeWriter.js";
import type { ExitCodeState } from "../cli/exitCodes.js";


/**
 * Simple writer interface for output streams.
 */
export interface Writer {
  write(data: string): void;
  /** Optional destination lifecycle hooks for private atomic writers. */
  commit?(): void;
  abort?(): void;
  beginUnit?(unit: { inputOrdinal: number; fileName: string }): void;
  endUnit?(): void;
}

/**
 * Source report for a converted database.
 */
export interface SourceReport {
  /** Database metadata */
  path: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  /** Number of complete card records */
  cardCount: number;
  /** Diagnostic summary */
  diagnostics: DiagnosticSummary;
}

/**
 * Conversion state machine.
 */
type ConversionState =
  | "PLANNING"
  | "READING"
  | "COMMITTING"
  | "COMMITTED"
  | "ABORTED";

/**
 * Result of a conversion operation.
 */
export interface ConversionResult {
  /** Reports for each source database */
  sources: readonly SourceReport[];
  /** Total number of cards */
  cardCount: number;
  /** Total number of warnings */
  warningCount: number;
  /** Total number of errors */
  errorCount: number;
  /** Exit code state for the CLI */
  exitCodeState: ExitCodeState;
  /** State of the conversion */
  state: ConversionState;
}

interface RawStreamResult {
  metadata: RawEnvelopeStreamMetadata;
  cardCount: number;
}

function sameRawMetadata(
  left: RawEnvelopeStreamMetadata,
  right: RawEnvelopeStreamMetadata,
): boolean {
  return (
    left.fileName === right.fileName &&
    left.sha256 === right.sha256 &&
    left.sizeBytes === right.sizeBytes &&
    JSON.stringify(left.extraTables) === JSON.stringify(right.extraTables)
  );
}

/**
 * Stream a raw envelope using one pass for datas and one pass for texts.
 * This keeps the complete database out of application memory while preserving
 * the fixed `tables.datas` / `tables.texts` property order.
 */
async function streamRawDatabase(
  input: { path: string; name: string; inputOrdinal: number },
  options: NormalizedConvertOptions,
  diagnostics: DiagnosticCollector,
  writer: Writer,
): Promise<RawStreamResult> {
  writer.beginUnit?.({ inputOrdinal: input.inputOrdinal, fileName: input.name });
  let metadata: RawEnvelopeStreamMetadata | null = null;
  let streamWriter: RawEnvelopeStreamWriter | null = null;
  let cardCount = 0;
  let metadataMismatch: string | null = null;
  const firstErrorCount = diagnostics.getErrors().length;

  const startWriter = (candidate: RawEnvelopeStreamMetadata): void => {
    if (metadata !== null) {
      if (!sameRawMetadata(metadata, candidate)) {
        metadataMismatch = "Raw source metadata changed between reader passes";
      }
      return;
    }
    metadata = candidate;
    streamWriter = new RawEnvelopeStreamWriter({
      format: options.format,
      pretty: options.pretty,
      maxOutputBytes: options.limits.maxOutputBytes,
      write: (chunk) => writer.write(chunk),
    });
    streamWriter.start(candidate);
  };

  for await (const cardRow of iterateRawCards(input.path, {
    signal: options.signal,
    limits: options.limits,
    diagnostics,
    onMetadata: (meta) => {
      startWriter({
        fileName: input.name,
        sha256: meta.bundleHash,
        sizeBytes: meta.sourceSizeBytes,
        extraTables: meta.extraTables.map((table) => ({
          name: table.name,
          columns: [...table.columns],
          rowCount: table.rowCount,
        })),
      });
    },
  })) {
    const currentWriter = streamWriter as RawEnvelopeStreamWriter | null;
    if (!currentWriter) throw new Error("Raw reader yielded rows without provenance metadata");
    if (cardRow.datas) currentWriter.writeDatas(cardRow.datas);
    cardCount += 1;
  }

  if (!metadata) {
    throw new Error("Raw reader completed without verified provenance metadata");
  }
  const activeWriter = streamWriter as RawEnvelopeStreamWriter | null;
  if (!activeWriter) {
    throw new Error("Raw reader completed without an active envelope writer");
  }
  if (diagnostics.getErrors().length > firstErrorCount) {
    throw new Error("Raw reader failed before the database envelope was complete");
  }
  activeWriter.finishDatas();

  const secondDiagnostics = new DiagnosticCollector();
  let secondCardCount = 0;
  for await (const cardRow of iterateRawCards(input.path, {
    signal: options.signal,
    limits: options.limits,
    diagnostics: secondDiagnostics,
    onMetadata: (meta) => {
      const candidate: RawEnvelopeStreamMetadata = {
        fileName: input.name,
        sha256: meta.bundleHash,
        sizeBytes: meta.sourceSizeBytes,
        extraTables: meta.extraTables.map((table) => ({
          name: table.name,
          columns: [...table.columns],
          rowCount: table.rowCount,
        })),
      };
      if (!sameRawMetadata(metadata!, candidate)) {
        metadataMismatch = "Raw source metadata changed between reader passes";
      }
    },
  })) {
    if (cardRow.texts) activeWriter.writeTexts(cardRow.texts);
    secondCardCount += 1;
  }

  if (metadataMismatch) throw new Error(metadataMismatch);
  if (secondDiagnostics.getErrors().length > 0) {
    diagnostics.merge(secondDiagnostics);
    throw new Error("Raw reader failed during the texts pass");
  }
  if (secondCardCount !== cardCount) {
    throw new Error("Raw source row count changed between reader passes");
  }
  activeWriter.finish();
  writer.endUnit?.();
  return { metadata, cardCount };
}

/**
 * Main conversion function.
 * Accepts normalized options and output writers.
 * Writers are required and must be provided by the caller.
 * The CLI adapter edge supplies process.stdout/stderr at the entrypoint.
 */
export async function convert(
  options: NormalizedConvertOptions,
  writers: {
    data: Writer;
    diagnostics: Writer;
  }
): Promise<ConversionResult> {
  let state: ConversionState = "PLANNING";
  const topCollector = new DiagnosticCollector();
  const sourceReports: SourceReport[] = [];

  let totalCardCount = 0;
  let completedInputCount = 0;
  let failedInputCount = 0;

  try {
    // Phase 1: Pre-open structural validation
    const planResult = validateOutputPlan(options);
    if (!planResult.valid) {
      return {
        sources: [],
        cardCount: 0,
        warningCount: 0,
        errorCount: 1,
        exitCodeState: {
          optionError: true,
          hasUsableInput: false,
          inputError: false,
          strictFailure: false,
          resourceOrIntegerFailure: false,
          mergeCollision: false,
          outputError: false,
          cancelled: false,
          continued: false,
          completedInputCount: 0,
          failedInputCount: 0,
          internalError: false,
        },
        state: "ABORTED",
      };
    }

    // Profile not available (card/source in Phase 2)
    if (planResult.plan?.isProfileNotAvailable) {
      topCollector.error(
        DiagnosticCode.PROFILE_NOT_AVAILABLE,
        `Profile '${options.profile}' is not available in this version. Use 'raw' profile.`
      );
      const summary = topCollector.getSummary();
      return {
        sources: [],
        cardCount: 0,
        warningCount: summary.warningCount,
        errorCount: summary.errorCount,
        exitCodeState: {
          optionError: true,
          hasUsableInput: false,
          inputError: false,
          strictFailure: false,
          resourceOrIntegerFailure: false,
          mergeCollision: false,
          outputError: false,
          cancelled: false,
          continued: false,
          completedInputCount: 0,
          failedInputCount: 0,
          internalError: false,
        },
        state: "ABORTED",
      };
    }

    // Phase 1b: Structural destination preflight
    // File and directory destinations require native secure-destination capability.
    // This check runs before discoverInputs() and before any SQLite access.
    if (options.destination.kind === "file" || options.destination.kind === "directory") {
      const capability = await probeNativeCapabilityAsync();
      if (!capability.supported) {
        topCollector.error(
          DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM,
          capability.error ?? "Secure destination is not supported on this platform",
          { details: { destinationKind: options.destination.kind } }
        );
        const summary = topCollector.getSummary();
        return {
          sources: [],
          cardCount: 0,
          warningCount: summary.warningCount,
          errorCount: summary.errorCount,
          exitCodeState: {
            optionError: false,
            hasUsableInput: false,
            inputError: false,
            strictFailure: false,
            resourceOrIntegerFailure: false,
            mergeCollision: false,
            outputError: true,
            cancelled: false,
            continued: false,
            completedInputCount: 0,
            failedInputCount: 0,
            internalError: false,
          },
          state: "ABORTED",
        };
      }

      // For file destination with --force: check if final file exists.
      // Phase 2 does not implement identity-guarded replace; --force with an
      // existing regular final returns UNSAFE_DESTINATION_FILESYSTEM (exit 6).
      if (options.destination.kind === "file" && options.force && options.destination.path) {
        const { lstat } = await import("node:fs/promises");
        try {
          const stat = await lstat(options.destination.path);
          if (stat.isFile() || stat.isSymbolicLink()) {
            // Existing file with --force: unsupported in Phase 2
            topCollector.error(
              DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM,
              `Output file exists and --force is specified, but identity-guarded replacement is not supported in this version. Use a non-existing path.`,
              { details: { existingPath: options.destination.path } }
            );
            const summary = topCollector.getSummary();
            return {
              sources: [],
              cardCount: 0,
              warningCount: summary.warningCount,
              errorCount: summary.errorCount,
              exitCodeState: {
                optionError: false,
                hasUsableInput: false,
                inputError: false,
                strictFailure: false,
                resourceOrIntegerFailure: false,
                mergeCollision: false,
                outputError: true,
                cancelled: false,
                continued: false,
                completedInputCount: 0,
                failedInputCount: 0,
                internalError: false,
              },
              state: "ABORTED",
            };
          }
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTDIR") {
            // Unexpected error; treat as output error
            topCollector.error(
              DiagnosticCode.OUTPUT_WRITE_FAILED,
              `Failed to check output destination: ${err instanceof Error ? err.message : String(err)}`
            );
            const summary = topCollector.getSummary();
            return {
              sources: [],
              cardCount: 0,
              warningCount: summary.warningCount,
              errorCount: summary.errorCount,
              exitCodeState: {
                optionError: false,
                hasUsableInput: false,
                inputError: false,
                strictFailure: false,
                resourceOrIntegerFailure: false,
                mergeCollision: false,
                outputError: true,
                cancelled: false,
                continued: false,
                completedInputCount: 0,
                failedInputCount: 0,
                internalError: false,
              },
              state: "ABORTED",
            };
          }
          // ENOENT/ENOTDIR: path does not exist, proceed
        }
      }

      // For directory destination: check that the output root does not already exist.
      // A fresh split root is required; existing directories fail before discovery.
      // --force does not override this check (per spec).
      if (options.destination.kind === "directory" && options.destination.path) {
        const { lstat } = await import("node:fs/promises");
        try {
          const stat = await lstat(options.destination.path);
          if (stat.isDirectory()) {
            topCollector.error(
              DiagnosticCode.OUTPUT_DIRECTORY_EXISTS,
              `Output directory already exists. Use a non-existing path for split=database output.`,
              { details: { existingPath: options.destination.path } }
            );
            const summary = topCollector.getSummary();
            renderTopDiagnostics(topCollector, options.diagnosticsMode, writers.diagnostics);
            return {
              sources: [],
              cardCount: 0,
              warningCount: summary.warningCount,
              errorCount: summary.errorCount,
              exitCodeState: {
                optionError: false,
                hasUsableInput: false,
                inputError: false,
                strictFailure: false,
                resourceOrIntegerFailure: false,
                mergeCollision: false,
                outputError: true,
                cancelled: false,
                continued: false,
                completedInputCount: 0,
                failedInputCount: 0,
                internalError: false,
              },
              state: "ABORTED",
            };
          }
          // Non-directory existing path at the output location: fail with UNSAFE
          if (stat.isFile() || stat.isSymbolicLink()) {
            topCollector.error(
              DiagnosticCode.OUTPUT_DIRECTORY_EXISTS,
              `Output path exists but is not a directory. Use a non-existing directory path for split=database output.`,
              { details: { existingPath: options.destination.path } }
            );
            const summary = topCollector.getSummary();
            renderTopDiagnostics(topCollector, options.diagnosticsMode, writers.diagnostics);
            return {
              sources: [],
              cardCount: 0,
              warningCount: summary.warningCount,
              errorCount: summary.errorCount,
              exitCodeState: {
                optionError: false,
                hasUsableInput: false,
                inputError: false,
                strictFailure: false,
                resourceOrIntegerFailure: false,
                mergeCollision: false,
                outputError: true,
                cancelled: false,
                continued: false,
                completedInputCount: 0,
                failedInputCount: 0,
                internalError: false,
              },
              state: "ABORTED",
            };
          }
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTDIR") {
            topCollector.error(
              DiagnosticCode.OUTPUT_WRITE_FAILED,
              `Failed to check output directory: ${err instanceof Error ? err.message : String(err)}`
            );
            const summary = topCollector.getSummary();
            renderTopDiagnostics(topCollector, options.diagnosticsMode, writers.diagnostics);
            return {
              sources: [],
              cardCount: 0,
              warningCount: summary.warningCount,
              errorCount: summary.errorCount,
              exitCodeState: {
                optionError: false,
                hasUsableInput: false,
                inputError: false,
                strictFailure: false,
                resourceOrIntegerFailure: false,
                mergeCollision: false,
                outputError: true,
                cancelled: false,
                continued: false,
                completedInputCount: 0,
                failedInputCount: 0,
                internalError: false,
              },
              state: "ABORTED",
            };
          }
          // ENOENT/ENOTDIR: path does not exist, proceed
        }
      }
    }

    // Validate limit relations (pre-open: INVALID_LIMIT_RELATION before any discovery/open).
    const limitResult = validateLimitRelations(options.limits);
    if (!limitResult.valid) {
      topCollector.error(DiagnosticCode.INVALID_LIMIT_RELATION, limitResult.message);
      const summary = topCollector.getSummary();
      renderTopDiagnostics(topCollector, options.diagnosticsMode, writers.diagnostics);
      return {
        sources: [],
        cardCount: 0,
        warningCount: summary.warningCount,
        errorCount: summary.errorCount,
        exitCodeState: {
          optionError: true,
          hasUsableInput: false,
          inputError: false,
          strictFailure: false,
          resourceOrIntegerFailure: false,
          mergeCollision: false,
          outputError: false,
          cancelled: false,
          continued: false,
          completedInputCount: 0,
          failedInputCount: 0,
          internalError: false,
        },
        state: "ABORTED",
      };
    }

    // Phase 2: Discover inputs
    state = "PLANNING";
    const discovered = await discoverInputs(options.inputs, {
      recursive: options.recursive,
      exclude: options.exclude,
      followSymlinks: options.followSymlinks,
    });

    if (discovered.length === 0) {
      topCollector.error(
        DiagnosticCode.NO_CDB_INPUT,
        "No CDB files found in input paths"
      );
      const summary = topCollector.getSummary();
      return {
        sources: [],
        cardCount: 0,
        warningCount: summary.warningCount,
        errorCount: summary.errorCount,
        exitCodeState: {
          optionError: false,
          hasUsableInput: false,
          inputError: false,
          strictFailure: false,
          resourceOrIntegerFailure: false,
          mergeCollision: false,
          outputError: false,
          cancelled: false,
          continued: false,
          completedInputCount: 0,
          failedInputCount: 0,
          internalError: false,
        },
        state: "ABORTED",
      };
    }

    // Phase 3: Validate cardinality after discovery
    const cardinalityResult = validateOutputCardinality(
      options,
      discovered.length
    );
    if (!cardinalityResult.valid) {
      topCollector.error(DiagnosticCode.INVALID_PATH, cardinalityResult.error!);
      const summary = topCollector.getSummary();
      return {
        sources: [],
        cardCount: 0,
        warningCount: summary.warningCount,
        errorCount: summary.errorCount,
        exitCodeState: {
          optionError: true,
          hasUsableInput: true,
          inputError: false,
          strictFailure: false,
          resourceOrIntegerFailure: false,
          mergeCollision: false,
          outputError: false,
          cancelled: false,
          continued: false,
          completedInputCount: 0,
          failedInputCount: 0,
          internalError: false,
        },
        state: "ABORTED",
      };
    }

    // Phase 4: Process databases sequentially
    state = "READING";

    for (const [inputOrdinal, input] of discovered.entries()) {
      const dbCollector = new DiagnosticCollector();
      let dbSha256 = "";
      let dbCardCount = 0;
      // Track whether we obtained verified provenance metadata.
      // If false (reader error, preflight failure), we must NOT emit a
      // fabricated envelope with empty sha256/sizeBytes.
      let metadataObtained = false;

      try {
        const streamed = await streamRawDatabase(
          { path: input.path, name: input.name, inputOrdinal },
          options,
          dbCollector,
          writers.data,
        );
        dbSha256 = streamed.metadata.sha256;
        dbCardCount = streamed.cardCount;
        metadataObtained = true;
      } catch (error) {
        if (options.signal?.aborted) {
          dbCollector.error(DiagnosticCode.CANCELLED, "Conversion cancelled", {
            details: { database: input.path },
          });
        } else if (error instanceof FileDestinationError) {
          // Propagate destination errors with their original code and message.
          // These are pre-open checks (directory exists, etc.) surfaced from
          // beginUnit(), not database read failures.
          const code = error.code as DiagnosticCode;
          dbCollector.error(
            code,
            error.message,
            { details: { database: input.path } },
          );
        } else if (error instanceof RawEnvelopeOutputLimitError) {
          dbCollector.error(DiagnosticCode.RESOURCE_LIMIT_EXCEEDED, error.message, {
            details: { limitCode: "MAX_OUTPUT_BYTES", maxOutputBytes: options.limits.maxOutputBytes },
          });
        } else if (error instanceof RawEnvelopeSinkError) {
          dbCollector.error(DiagnosticCode.OUTPUT_WRITE_FAILED, error.message, {
            details: { database: input.path },
          });
        } else {
          dbCollector.error(
            DiagnosticCode.CDB_OPEN_FAILED,
            `Failed to read database: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        failedInputCount++;
        topCollector.merge(dbCollector);
        // Do NOT build/emit an envelope after a reader error.
        // A fabricated envelope with empty sha256/sizeBytes would violate the
        // provenance contract and produce schema-invalid output.
        renderDbDiagnostics(dbCollector, options.diagnosticsMode, writers.diagnostics);
        sourceReports.push({
          path: input.path,
          fileName: input.name,
          fileSizeBytes: input.sizeBytes,
          sha256: "",
          cardCount: 0,
          diagnostics: dbCollector.getSummary(),
        });
        if (!options.continueOnError) break;
        continue;
      }

      // Build the raw envelope only when verified provenance was obtained.
      // If metadataObtained is false (should not happen with current iterator
      // but is a defensive guard), skip emission.
      if (!metadataObtained) {
        dbCollector.error(
          DiagnosticCode.CDB_OPEN_FAILED,
          "No provenance metadata obtained; envelope not emitted",
          { details: { database: input.path } }
        );
        failedInputCount++;
        topCollector.merge(dbCollector);
        renderDbDiagnostics(dbCollector, options.diagnosticsMode, writers.diagnostics);
        sourceReports.push({
          path: input.path,
          fileName: input.name,
          fileSizeBytes: input.sizeBytes,
          sha256: "",
          cardCount: 0,
          diagnostics: dbCollector.getSummary(),
        });
        if (!options.continueOnError) break;
        continue;
      }

      totalCardCount += dbCardCount;
      completedInputCount++;

      // Produce diagnostic output
      renderDbDiagnostics(dbCollector, options.diagnosticsMode, writers.diagnostics);

      topCollector.merge(dbCollector);
      sourceReports.push({
        path: input.path,
        fileName: input.name,
        fileSizeBytes: input.sizeBytes,
        sha256: dbSha256,
        cardCount: dbCardCount,
        diagnostics: dbCollector.getSummary(),
      });
    }

    // Phase 5: Commit state
    state = "COMMITTING";

    if (options.strict) {
      topCollector.promote(true);
    }

    state = "COMMITTED";
  } catch (error) {
    state = "ABORTED";
    topCollector.error(
      DiagnosticCode.CDB_OPEN_FAILED,
      `Unexpected conversion error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const summary = topCollector.getSummary();

  // Build exit code state
  const exitCodeState: ExitCodeState = {
    optionError: false,
    hasUsableInput: true,
    inputError: summary.errors.length > 0 && !summary.errors.every(
      (e) => e.code === DiagnosticCode.CANCELLED
    ),
    strictFailure: false,
    resourceOrIntegerFailure: false,
    mergeCollision: false,
    outputError:
      summary.errors.some(
        (e) =>
          e.code === DiagnosticCode.OUTPUT_WRITE_FAILED ||
          e.code === DiagnosticCode.CANCELLED
      ),
    cancelled: options.signal?.aborted ?? false,
    continued: options.continueOnError,
    completedInputCount,
    failedInputCount,
    internalError: state === "ABORTED" && completedInputCount === 0,
  };

  return {
    sources: sourceReports,
    cardCount: totalCardCount,
    warningCount: summary.warningCount,
    errorCount: summary.errorCount,
    exitCodeState,
    state,
  };
}

/**
 * Render top-level diagnostics on the diagnostics writer.
 * Used for pre-open structural failures (directory exists, unsafe filesystem, etc.).
 */
function renderTopDiagnostics(
  collector: DiagnosticCollector,
  mode: string,
  writer: Writer
): void {
  const all = collector.getAll();
  if (mode === "none" || all.length === 0) return;

  for (const d of all) {
    if (mode === "json") {
      writer.write(JSON.stringify(d) + "\n");
    } else if (mode === "jsonl") {
      writer.write(JSON.stringify(d) + "\n");
    } else if (mode === "text") {
      const prefix =
        d.severity === "ERROR"
          ? "[ERROR]"
          : d.severity === "WARNING"
            ? "[WARNING]"
            : "[INFO]";
      writer.write(`${prefix} ${d.code}: ${d.message}\n`);
    }
  }
}

/**
 * Render database-level diagnostics on the diagnostics writer.
 */
function renderDbDiagnostics(
  collector: DiagnosticCollector,
  mode: string,
  writer: Writer
): void {
  const all = collector.getAll();
  if (mode === "none" || all.length === 0) return;

  for (const d of all) {
    if (mode === "json") {
      writer.write(JSON.stringify(d) + "\n");
    } else if (mode === "jsonl") {
      writer.write(JSON.stringify(d) + "\n");
    } else if (mode === "text") {
      const prefix =
        d.severity === "ERROR"
          ? "[ERROR]"
          : d.severity === "WARNING"
            ? "[WARNING]"
            : "[INFO]";
      writer.write(`${prefix} ${d.code}: ${d.message}\n`);
    }
  }
}
