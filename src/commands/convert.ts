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

  // Structural preflight: file/directory destinations require native capability.
  // This check is also performed in convertService, but we perform it here
  // to ensure it fails before discoverInputs() is called in any path.
  if (
    (options.destination.kind === "file" || options.destination.kind === "directory")
  ) {
    const { probeNativeCapability } = await import("../destinations/secureDestination.js");
    const capability = probeNativeCapability();
    if (!capability.supported) {
      streams.stderr.write(
        `[ERROR] UNSAFE_DESTINATION_FILESYSTEM: ${capability.error ?? "Secure destination is not supported on this platform"}\n`
      );
      return { exitCode: 6, sourceCount: 0, cardCount: 0 };
    }
  }

  const dataWriter = createStdoutDestination(streams.stdout);
  const diagnosticsWriter = createStdoutDestination(streams.stderr);

  const result = await convertService(options, {
    data: dataWriter,
    diagnostics: diagnosticsWriter,
  });

  // Render ALL diagnostics to stderr (from all sources + top-level)
  const allDiagnostics: any[] = [];
  for (const source of result.sources) {
    allDiagnostics.push(
      ...source.diagnostics.infos,
      ...source.diagnostics.warnings,
      ...source.diagnostics.errors
    );
  }

  // Also render error/warning from top-level collector if we have errors but no sources
  if (result.sources.length === 0 && (result.errorCount > 0 || result.warningCount > 0)) {
    const { DiagnosticCollector } = await import("../diagnostics/collector.js");
    const collector = new DiagnosticCollector();
    collector.error("NO_CDB_INPUT", "No CDB files found in input paths");
    allDiagnostics.push(...collector.getAll());
  }

  // Write error diagnostics to stderr in text mode
  if (allDiagnostics.length > 0 && options.diagnosticsMode !== "none") {
    for (const d of allDiagnostics) {
      const prefix =
        d.severity === "ERROR"
          ? "[ERROR]"
          : d.severity === "WARNING"
            ? "[WARNING]"
            : "[INFO]";
      streams.stderr.write(`${prefix} ${d.code}: ${d.message}\n`);
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