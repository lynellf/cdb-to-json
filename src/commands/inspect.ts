/**
 * Inspect command handler.
 * Reads database metadata without emitting cards.
 */

import { Writable } from "node:stream";
import { inspectInputs } from "../application/inspectInputs.js";
import { computeExitCode } from "../cli/exitCodes.js";
import type { DiagnosticsMode } from "../application/types.js";

export interface InspectCommandResult {
  exitCode: number;
}

/**
 * Execute the inspect command.
 */
export async function executeInspect(
  inputs: readonly string[],
  options: {
    recursive?: boolean;
    exclude?: readonly string[];
    followSymlinks?: boolean;
    diagnosticsMode?: DiagnosticsMode;
    strict?: boolean;
  },
  streams: { stdout: Writable; stderr: Writable }
): Promise<InspectCommandResult> {
  try {
    const result = await inspectInputs(inputs, {
      recursive: options.recursive,
      exclude: options.exclude,
      followSymlinks: options.followSymlinks,
    });

    const exitCode = computeExitCode(result.exitCodeState);

    // A missing input is a command failure, not an inspection result. Keep
    // the machine-readable report on stdout for successful inspections and
    // route the failure diagnostic to stderr instead.
    if (exitCode === 3) {
      streams.stderr.write("Error: No CDB files found\n");
    } else {
      const json = JSON.stringify(result, null, 2);
      streams.stdout.write(json + "\n");
    }

    return { exitCode };
  } catch (error) {
    streams.stderr.write(
      `Error running inspect: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return { exitCode: 1 };
  }
}
