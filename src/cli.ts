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
  // Parse CLI arguments
  const parsed = parseCliArgs(args);

  // Handle help and version commands
  if (parsed.command === "help") {
    renderHelp(streams.stdout);
    return 0;
  }

  if (parsed.command === "version") {
    renderVersion(streams.stdout);
    return 0;
  }

  // If we ended up with convert but no recognized command word was given
  // AND the first argument looks like a command name (not a file path),
  // reject it as an unknown command.
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

  // Command routing
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
      const result = await executeInspect(parsed.inputs, {
        recursive: !!parsed.options.recursive,
        exclude: (parsed.options.exclude as string[]) || [],
        followSymlinks: !!parsed.options["follow-symlinks"],
        diagnosticsMode: (parsed.options.diagnostics as string) as any || "text",
        strict: !!parsed.options.strict,
      }, streams);
      return result.exitCode;
    }

    case "validate": {
      const result = await executeValidate(parsed.inputs, {
        strict: !!parsed.options.strict,
        recursive: !!parsed.options.recursive,
        exclude: (parsed.options.exclude as string[]) || [],
        followSymlinks: !!parsed.options["follow-symlinks"],
      }, streams);
      return result.exitCode;
    }

    case "schema": {
      const profile = parsed.inputs[0] || "";
      const result = await executeSchema(profile, {
        output: parsed.options.output as string | undefined,
      }, streams);
      return result.exitCode;
    }

    default:
      // Unknown command
      streams.stderr.write(
        `Error: Unknown command '${parsed.command}'. Use 'help' for usage.\n`
      );
      return 2;
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
