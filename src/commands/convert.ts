/**
 * Convert command handler.
 * Orchestrates the conversion pipeline from the CLI side.
 */

import type { Writable } from "node:stream";
import type { NormalizedConvertOptions } from "../application/types.js";
import { convert as convertService } from "../application/convertCatalog.js";
import { createStdoutDestination } from "../destinations/stdoutDestination.js";
import { computeExitCode } from "../cli/exitCodes.js";
import { validateOutputPlan } from "../application/outputPlan.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import {
  createAtomicFileDestination,
  FileDestinationError,
  type AtomicFileDestination,
} from "../destinations/fileDestination.js";
import {
  createAtomicDirectoryDestination,
  type AtomicDirectoryDestination,
} from "../destinations/directoryDestination.js";
import type { Writer } from "../application/convertCatalog.js";
import { iterateRawCards, type RawDatabaseMetadata } from "../cdb/iterateRows.js";
import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { normalizeCard } from "../normalization/normalizeCard.js";
import { mapCardToProfile } from "../profiles/cardProfile.js";
import { mapCardToSource } from "../profiles/sourceProfile.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { canonicalSha256 } from "../hashing/sha256.js";

export interface ConvertCommandResult {
  exitCode: number;
  sourceCount: number;
  cardCount: number;
}

/**
 * Execute the convert command.
 */
export async function executeConvert(
  options: NormalizedConvertOptions,
  streams: { stdout: Writable; stderr: Writable }
): Promise<ConvertCommandResult> {
  // Reject unsupported profiles and invalid output combinations before input
  // discovery. This keeps option errors from being reported as missing input.
  const plan = validateOutputPlan(options);
  if (!plan.valid) {
    streams.stderr.write(`Error: ${plan.error}\n`);
    return { exitCode: 2, sourceCount: 0, cardCount: 0 };
  }
  if (plan.plan?.isProfileNotAvailable) {
    streams.stderr.write(
      `[ERROR] ${DiagnosticCode.PROFILE_NOT_AVAILABLE}: Profile '${options.profile}' is not available in this release. Use 'raw' profile.\n`
    );
    return { exitCode: 2, sourceCount: 0, cardCount: 0 };
  }

  let dataWriter: Writer | AtomicFileDestination | AtomicDirectoryDestination;
  try {
    if (options.destination.kind === "file" && options.destination.path) {
      dataWriter = createAtomicFileDestination(options.destination.path, {
        force: options.force,
      });
    } else if (options.destination.kind === "directory" && options.destination.path) {
      dataWriter = createAtomicDirectoryDestination(options.destination.path, {
        format: options.format,
        force: options.force,
      });
    } else {
      dataWriter = createStdoutDestination(streams.stdout);
    }
  } catch (error) {
    const code = error instanceof FileDestinationError
      ? error.code
      : DiagnosticCode.OUTPUT_WRITE_FAILED;
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`[ERROR] ${code}: ${message}\n`);
    return { exitCode: 6, sourceCount: 0, cardCount: 0 };
  }
  const diagnosticsWriter = createStdoutDestination(streams.stderr);

  if (options.profile !== "raw") {
    return executeStructuredProfile(options, dataWriter, streams);
  }

  let result;
  try {
    result = await convertService(options, {
      data: dataWriter,
      diagnostics: diagnosticsWriter,
    });
  } catch (error) {
    dataWriter.abort?.();
    streams.stderr.write(
      `[ERROR] ${DiagnosticCode.OUTPUT_WRITE_FAILED}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return { exitCode: 6, sourceCount: 0, cardCount: 0 };
  }

  if (dataWriter.commit || dataWriter.abort) {
    try {
      if (result.errorCount === 0 && result.state === "COMMITTED") {
        dataWriter.commit?.();
      } else {
        dataWriter.abort?.();
      }
    } catch (error) {
      dataWriter.abort?.();
      streams.stderr.write(
        `[ERROR] ${DiagnosticCode.OUTPUT_WRITE_FAILED}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return { exitCode: 6, sourceCount: result.sources.length, cardCount: result.cardCount };
    }
  }

  // Per-database diagnostics are rendered once by the application service via
  // the injected diagnostics writer. Top-level no-input errors have no source
  // report, so retain the command-level fallback for that case.
  // Skip when output/cancellation error (already handled above) or when
  // destination errors are the cause (directory exists, unsafe filesystem).
  const isOutputError =
    result.exitCodeState?.outputError || result.exitCodeState?.cancelled;
  if (
    !isOutputError &&
    result.sources.length === 0 &&
    (result.errorCount > 0 || result.warningCount > 0)
  ) {
    const { DiagnosticCollector } = await import("../diagnostics/collector.js");
    const collector = new DiagnosticCollector();
    collector.error("NO_CDB_INPUT", "No CDB files found in input paths");
    if (options.diagnosticsMode !== "none") {
      for (const d of collector.getAll()) {
        const prefix =
          d.severity === "ERROR"
            ? "[ERROR]"
            : d.severity === "WARNING"
              ? "[WARNING]"
              : "[INFO]";
        streams.stderr.write(`${prefix} ${d.code}: ${d.message}\n`);
      }
    }
  }

  // Print summary to stderr
  if (
    options.diagnosticsMode !== "json" &&
    options.diagnosticsMode !== "jsonl"
  ) {
    const summaryText = [
      `Processed ${result.sources.length} database(s)`,
      `Total cards: ${result.cardCount}`,
      `Warnings: ${result.warningCount}`,
      `Errors: ${result.errorCount}`,
      result.state === "ABORTED" ? "Conversion aborted" : "Conversion complete",
    ].join("\n");

    streams.stderr.write(summaryText + "\n");
  }

  const exitCode = computeExitCode(result.exitCodeState);

  return {
    exitCode,
    sourceCount: result.sources.length,
    cardCount: result.cardCount,
  };
}

async function executeStructuredProfile(
  options: NormalizedConvertOptions,
  writer: Writer,
  streams: { stdout: Writable; stderr: Writable },
): Promise<ConvertCommandResult> {
  const inputs = await discoverInputs(options.inputs, {
    recursive: options.recursive,
    exclude: options.exclude,
    followSymlinks: options.followSymlinks,
  });
  if (inputs.length !== 1) {
    streams.stderr.write("[ERROR] NO_CDB_INPUT: Card and source conversion currently require exactly one input database.\n");
    writer.abort?.();
    return { exitCode: 3, sourceCount: 0, cardCount: 0 };
  }

  const input = inputs[0];
  const diagnostics = new DiagnosticCollector();
  let metadata: RawDatabaseMetadata | null = null;
  let cardCount = 0;
  let first = true;
  const conversionOptionsHash = `sha256:${canonicalSha256({
    profile: options.profile,
    locale: options.locale ?? "en",
    sourceNamespace: options.sourceNamespace,
    includeRaw: options.includeRaw,
  })}`;

  const writeRecord = (record: unknown): void => {
    const encoded = JSON.stringify(record, null, options.pretty ? 2 : undefined);
    if (options.format === "jsonl") {
      writer.write(`${encoded}\n`);
      return;
    }
    writer.write(first ? `[${options.pretty ? "\n" : ""}` : `,${options.pretty ? "\n" : ""}`);
    writer.write(encoded);
    first = false;
  };

  try {
    for await (const rows of iterateRawCards(input.path, {
      signal: options.signal,
      limits: options.limits,
      diagnostics,
      followSymlinks: options.followSymlinks,
      onMetadata: (candidate) => { metadata = candidate; },
    })) {
      const sourceMetadata = metadata as RawDatabaseMetadata | null;
      if (!sourceMetadata) throw new Error("Reader yielded a row before verified source metadata");
      const normalized = normalizeCard(rows, {
        locale: options.locale ?? "en",
        sourceNamespace: options.sourceNamespace,
        registryHashes: {},
        limits: options.limits,
      }, diagnostics);
      const record = options.profile === "card"
        ? mapCardToProfile(normalized, {
            locale: options.locale ?? "en",
            sourceNamespace: options.sourceNamespace,
            databaseSha256: sourceMetadata.bundleHash,
            databaseFileName: input.name,
          })
        : mapCardToSource(normalized, rows, {
            locale: options.locale ?? "en",
            sourceNamespace: options.sourceNamespace,
            databaseFileName: input.name,
            databaseSha256: sourceMetadata.bundleHash,
            sourceRevisionId: sourceMetadata.bundleHash,
            conversionOptionsHash,
          }).value;
      writeRecord(record);
      cardCount += 1;
    }
    if (!metadata) throw new Error("Reader completed without verified source metadata");
    if (options.format === "json") writer.write(first ? "[]\n" : `${options.pretty ? "\n" : ""}]\n`);
    writer.commit?.();
    streams.stderr.write(`Processed 1 database(s)\nTotal cards: ${cardCount}\nWarnings: ${diagnostics.getWarnings().length}\nErrors: ${diagnostics.getErrors().length}\nConversion complete\n`);
    return { exitCode: diagnostics.getErrors().length > 0 ? 4 : 0, sourceCount: 1, cardCount };
  } catch (error) {
    writer.abort?.();
    streams.stderr.write(`[ERROR] ${DiagnosticCode.CDB_OPEN_FAILED}: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: 4, sourceCount: 1, cardCount: 0 };
  }
}
