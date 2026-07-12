/**
 * Conversion application service.
 * Orchestrates the conversion pipeline: input discovery → snapshot/open
 * → read rows → build envelope → serialize → output.
 *
 * Process databases sequentially. Returns one aggregate result.
 */

import { iterateRawCards, type ExtraTableMetadata } from "../cdb/iterateRows.js";
import { probeNativeCapability } from "../destinations/secureDestination.js";
import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { DiagnosticCollector, type DiagnosticSummary } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import type { NormalizedConvertOptions } from "./types.js";
import { validateLimitRelations } from "./types.js";
import { validateOutputPlan, validateOutputCardinality } from "./outputPlan.js";
import { RawEnvelopeBuilder } from "../profiles/rawProfile.js";
import { serializeJson } from "../serialization/canonicalJson.js";
import { JsonLinesWriter } from "../serialization/jsonLinesWriter.js";
import type { ExitCodeState } from "../cli/exitCodes.js";


/**
 * Simple writer interface for output streams.
 */
export interface Writer {
  write(data: string): void;
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

/**
 * Main conversion function.
 * Accepts normalized options and output writers.
 */
export async function convert(
  options: NormalizedConvertOptions,
  writers: {
    data: Writer;
    diagnostics: Writer;
  } = {
    data: { write: (s: string) => process.stdout.write(s) },
    diagnostics: { write: (s: string) => process.stderr.write(s) },
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
      const capability = probeNativeCapability();
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
    }

    // Validate limit relations
    const limitError = validateLimitRelations(options.limits);
    if (limitError) {
      topCollector.error(DiagnosticCode.INVALID_LIMIT_RELATION, limitError);
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

    for (const input of discovered) {
      const dbCollector = new DiagnosticCollector();
      let dbSha256 = "";
      let dbCardCount = 0;
      let dbSourceSize = 0;
      let dbExtraTables: ExtraTableMetadata[] = [];

      // Build the raw envelope for this database
      const envelopeBuilder = new RawEnvelopeBuilder({
        fileName: input.name,
        sha256: dbSha256,
        sizeBytes: dbSourceSize,
        extraTables: dbExtraTables,
      });

      try {
        // Read rows via the async iterator, collecting metadata via callback
        // Read rows via the async iterator, collecting metadata via callback.
        // The callback fires once after preflight checks, before row iteration.
        for await (const cardRow of iterateRawCards(input.path, {
          signal: options.signal,
          limits: options.limits,
          diagnostics: dbCollector,
          onMetadata: (meta) => {
            dbSha256 = meta.bundleHash;
            dbSourceSize = meta.sourceSizeBytes;
            dbExtraTables = [...meta.extraTables];
          },
        })) {
          envelopeBuilder.addCard(cardRow);
          dbCardCount++;
        }

        // Update envelope metadata after iteration (callback fires before first yield)
        envelopeBuilder.updateMetadata({
          sha256: dbSha256,
          sizeBytes: dbSourceSize,
          extraTables: dbExtraTables,
        });
      } catch (error) {
        if (options.signal?.aborted) {
          dbCollector.error(DiagnosticCode.CANCELLED, "Conversion cancelled", {
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
        if (!options.continueOnError) break;
        continue;
      }

      // Build the raw envelope
      const envelope = envelopeBuilder.build();
      totalCardCount += dbCardCount;
      completedInputCount++;

      // Serialize and write
      try {
        if (options.format === "jsonl") {
          // JSONL: one envelope per line
          const jsonlWriter = new JsonLinesWriter({
            write: (s: string) => writers.data.write(s),
            end: () => {},
            on: () => ({}) as any,
          } as any);
          jsonlWriter.write(envelope);
          jsonlWriter.close();
        } else {
          // JSON: write as a single object
          const jsonOutput = serializeJson(envelope, {
            pretty: options.pretty,
          });
          writers.data.write(jsonOutput + "\n");
        }
      } catch (error) {
        dbCollector.error(
          DiagnosticCode.OUTPUT_WRITE_FAILED,
          `Failed to write output: ${error instanceof Error ? error.message : String(error)}`
        );
        failedInputCount++;
        topCollector.merge(dbCollector);
        if (!options.continueOnError) break;
        continue;
      }

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