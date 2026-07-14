#!/usr/bin/env node

/**
 * Terminal-free CLI library.
 *
 * This module is the terminal-free adapter edge for the cdb-to-json CLI.
 * It receives only injected streams ({ stdout, stderr }) and an optional
 * AbortSignal — it never accesses process globals.
 *
 * The thin executable wrapper is app/cli.ts; it reads process.argv,
 * wires process.stdout/stderr, installs/removes the SIGINT abort handler,
 * sets process.exitCode, and handles unhandled rejections.
 *
 * INV-004: No module under src/ may import console or process-global terminal state.
 */

import { Writable } from "node:stream";
import { parseCliArgs } from "./cli/parseArgs.js";
import { renderHelp, renderVersion } from "./cli/renderHelp.js";
import { executeConvert } from "./commands/convert.js";
import { executeInspect } from "./commands/inspect.js";
import { executeValidate } from "./commands/validate.js";
import { executeSchema } from "./commands/schema.js";
import { compileNormalizedOptions } from "./cli/parseArgs.js";

/**
 * Minimal stream interface required by the CLI library.
 * src/ modules never access process.stdout/stderr directly —
 * the caller provides explicit streams.
 */
export interface CliStreams {
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/**
 * Main CLI entry point — terminal-free.
 *
 * @param args        Parsed CLI arguments (already stripped of argv[0]/argv[1]).
 * @param streams     Explicit output streams. Required; never defaults to process globals.
 * @param signal      Optional AbortSignal for cancellation. When provided, the library
 *                   uses it directly rather than installing a SIGINT handler.
 */
export async function main(
  args: string[],
  streams: CliStreams,
  signal?: AbortSignal
): Promise<number> {
  // Parse CLI arguments using the discriminated ParseResult
  const parsed = parseCliArgs(args);

  // Handle usage errors: render to stderr, exit 2
  if (!parsed.ok) {
    streams.stderr.write(`Error: ${parsed.usageError}\n`);
    return 2;
  }

  // Handle help and version commands
  if (parsed.command === "help") {
    renderHelp(streams.stdout);
    return 0;
  }

  if (parsed.command === "version") {
    renderVersion(streams.stdout);
    return 0;
  }

  // Validate bare-convert input: first positional should look like a path
  // This catches unknown commands masquerading as inputs
  if (parsed.command === "convert" && parsed.inputs.length > 0) {
    const firstInput = parsed.inputs[0];
    // If the first input doesn't look like a path (no extension, no slash),
    // it's likely an unknown command.
    if (
      !firstInput.includes(".") &&
      !firstInput.includes("/") &&
      !firstInput.includes("\\") &&
      firstInput.length < 20 &&
      /^[a-z-]+$/.test(firstInput)
    ) {
      streams.stderr.write(
        `Error: Unknown command '${firstInput}'. Use 'help' for usage.\n`
      );
      return 2;
    }
  }

  // Command routing (only reached for ok: true results)
  switch (parsed.command) {
    case "convert": {
      // Compile normalized options from parsed args
      const compileResult = compileNormalizedOptions(parsed);

      if (!compileResult.valid) {
        streams.stderr.write(`Error: ${compileResult.error}\n`);
        return 2;
      }

      // Cancellation: prefer the caller's signal, or create one if not provided.
      // The SIGINT/AbortController wiring lives in app/cli.ts (the executable wrapper),
      // not here. If the caller passes a signal, use it directly.
      const abortSignal = signal ?? AbortSignal.abort(); // never used; caller provides
      void abortSignal; // suppress unused-var in the non-signal path

      const result = await executeConvert(
        { ...compileResult.options, signal: abortSignal },
        streams
      );
      return result.exitCode;
    }

    case "inspect": {
      const result = await executeInspect(parsed.inputs as string[], {
        recursive: !!parsed.options.recursive,
        exclude: (parsed.options.exclude as string[]) || [],
        followSymlinks: !!parsed.options["follow-symlinks"],
        diagnosticsMode: (parsed.options.diagnostics as string) as any || "text",
        strict: !!parsed.options.strict,
      }, streams);
      return result.exitCode;
    }

    case "validate": {
      const result = await executeValidate(parsed.inputs as string[], {
        strict: !!parsed.options.strict,
        recursive: !!parsed.options.recursive,
        exclude: (parsed.options.exclude as string[]) || [],
        followSymlinks: !!parsed.options["follow-symlinks"],
      }, streams);
      return result.exitCode;
    }

    case "schema": {
      const profile = (parsed.inputs as string[])[0] || "";
      const result = await executeSchema(profile, {
        output: parsed.options.output as string | undefined,
      }, streams);
      return result.exitCode;
    }
  }
}
