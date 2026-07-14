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
  //
  // Per the adversarial publication amendment (B2-4), we run a side-effect-contained
  // probe on the selected parent filesystem: no-symlink traversal, descriptor-relative
  // exclusive lock/temp creation, and no-replace publication are exercised and then
  // cleaned by owned handles.
  if (
    options.destination.kind === "file" ||
    options.destination.kind === "directory"
  ) {
    const { probeNativeCapabilityAsync } = await import(
      "../destinations/secureDestination.js"
    );
    const capability = await probeNativeCapabilityAsync();
    if (!capability.supported) {
      streams.stderr.write(
        `[ERROR] ${DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM}: ${capability.error ?? "Secure destination is not supported on this platform"}\n`
      );
      return { exitCode: 6, sourceCount: 0, cardCount: 0 };
    }

    // Verify filesystem capability for the specific destination parent
    const parentPath =
      options.destination.kind === "directory"
        ? options.destination.path
        : options.destination.path
          ? options.destination.path.includes("/")
            ? options.destination.path.slice(
                0,
                options.destination.path.lastIndexOf("/")
              ) || "."
            : "."
        : ".";

    const { probeFilesystemCapability } = await import(
      "../destinations/nativeAdapter.js"
    );
    const fsProbe = await probeFilesystemCapability(parentPath);
    if (!fsProbe) {
      streams.stderr.write(
        `[ERROR] ${DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM}: Cannot probe filesystem capabilities at '${parentPath}'\n`
      );
      return { exitCode: 6, sourceCount: 0, cardCount: 0 };
    }

    // Verify required capabilities
    if (!fsProbe.supportsOpenAt2 || !fsProbe.supportsRenameAt2) {
      streams.stderr.write(
        `[ERROR] ${DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM}: Filesystem does not support required primitives (openat2, renameat2)\n`
      );
      return { exitCode: 6, sourceCount: 0, cardCount: 0 };
    }

    if (!fsProbe.supportsNoReplace) {
      streams.stderr.write(
        `[ERROR] ${DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM}: Filesystem does not support no-replace atomic rename\n`
      );
      return { exitCode: 6, sourceCount: 0, cardCount: 0 };
    }
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
