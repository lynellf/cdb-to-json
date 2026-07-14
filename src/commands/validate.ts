/**
 * Validate command handler.
 * Validates input database structure without writing converted output.
 */

import { Writable } from "node:stream";
import { validateInputs } from "../application/validateInputs.js";
import { computeExitCode, ExitCode } from "../cli/exitCodes.js";
import type { DiagnosticsMode } from "../application/types.js";

export interface ValidateCommandResult {
  exitCode: number;
}

/**
 * Execute the validate command.
 */
export async function executeValidate(
  inputs: readonly string[],
  options: {
    strict?: boolean;
    recursive?: boolean;
    exclude?: readonly string[];
    followSymlinks?: boolean;
    diagnosticsMode?: DiagnosticsMode;
  },
  streams: { stdout: Writable; stderr: Writable }
): Promise<ValidateCommandResult> {
  try {
    const result = await validateInputs(inputs, {
      strict: options.strict,
      recursive: options.recursive,
      exclude: options.exclude,
      followSymlinks: options.followSymlinks,
    });

    const exitCode = computeExitCode(result.exitCodeState);

    // Route machine-readable report to stdout
    const json = JSON.stringify(result, null, 2);
    streams.stdout.write(json + "\n");

    // If no usable input, write to stderr in text mode
    if (exitCode === ExitCode.NO_INPUT) {
      if (options.diagnosticsMode !== "json") {
        streams.stderr.write("Error: No CDB files found in input paths\n");
      }
      return { exitCode };
    }

    // If there were errors, also write them to stderr in text mode
    if (exitCode !== 0 && options.diagnosticsMode !== "json") {
      const errorCount = result.databases.reduce(
        (sum, db) => sum + db.errors.length,
        0
      );
      const warningCount = result.databases.reduce(
        (sum, db) => sum + db.warnings.length,
        0
      );
      streams.stderr.write(
        `Validation completed with ${errorCount} error(s), ${warningCount} warning(s)\n`
      );
    }

    return { exitCode };
  } catch (error) {
    streams.stderr.write(
      `Error running validate: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return { exitCode: 1 };
  }
}
