/**
 * Validate command handler.
 * Validates input database structure without writing converted output.
 */

import { Writable } from "node:stream";
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
    // For Phase 2, validate uses the existing discovery and preflight
    // without creating converted output
    const { discoverInputs } = await import("../discovery/discoverCdbInputs.js");

    const discovered = await discoverInputs(inputs, {
      recursive: options.recursive,
      exclude: options.exclude,
      followSymlinks: options.followSymlinks,
    });

    if (discovered.length === 0) {
      streams.stderr.write("Error: No CDB files found\n");
      return { exitCode: 3 };
    }

    // Report validation results to stdout
    const validationReport = {
      schema: "cdb.validation/1",
      databases: discovered.map((d) => ({
        path: d.path,
        fileName: d.name,
        sizeBytes: d.sizeBytes,
      })),
      valid: true,
    };

    streams.stdout.write(JSON.stringify(validationReport, null, 2) + "\n");

    return { exitCode: 0 };
  } catch (error) {
    streams.stderr.write(
      `Error running validate: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return { exitCode: 1 };
  }
}
