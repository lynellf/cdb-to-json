#!/usr/bin/env node

/**
 * CLI adapter for cdb-to-json.
 * Parses arguments, creates logger, invokes application services,
 * and maps diagnostics to terminal output and exit codes.
 *
 * Core, application, reader, discovery, diagnostics, and compatibility
 * modules remain terminal-free. This file is the adapter edge and
 * receives explicit { stdout, stderr } streams.
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
 * Main CLI entry point with explicit streams.
 */
export async function main(
  args: string[],
  streams: { stdout: Writable; stderr: Writable } = {
    stdout: process.stdout,
    stderr: process.stderr,
  }
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

      // Install SIGINT handler around the conversion
      const abortController = new AbortController();
      const signal = abortController.signal;
      const onSigint = () => {
        abortController.abort();
        streams.stderr.write("\nReceived SIGINT, cancelling...\n");
      };

      process.on("SIGINT", onSigint);

      try {
        const result = await executeConvert(
          { ...compileResult.options, signal },
          streams
        );
        return result.exitCode;
      } finally {
        process.off("SIGINT", onSigint);
      }
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

// Run CLI when executed directly
const isMainModule =
  process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts");
if (isMainModule) {
  main(process.argv.slice(2))
    .then((code) => {
      // Do not call process.exit(): stdout/stderr may still have buffered
      // writes from a streaming conversion. Setting exitCode lets Node drain
      // those streams before terminating.
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
