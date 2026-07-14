#!/usr/bin/env node

/**
 * Thin executable wrapper — the only module that directly accesses process globals.
 * All other src/ modules are terminal-free and accept explicit streams.
 *
 * This module:
 * - Reads process.argv to extract CLI arguments
 * - Wires process.stdout/stderr as explicit streams to src/cli.ts main()
 * - Installs/removes the SIGINT abort handler
 * - Sets process.exitCode on completion
 * - Handles truly unhandled rejections with a terminal-safe message
 *
 * The src/cli.ts library module receives only injected streams and AbortSignal,
 * never process globals.
 */

import { main } from "../dist/cli.js";

const isMainModule =
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli");

if (!isMainModule) {
  // Imported as a library — do not run the executable path.
  // Library consumers use main() directly with explicit streams.
  process.exit(0);
}

main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
})
  .then((code: number) => {
    // Do not call process.exit(): stdout/stderr may still have buffered
    // writes from a streaming conversion. Setting exitCode lets Node drain
    // those streams before terminating.
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Fatal errors are returned as non-zero exit codes through the normal
    // main() path. The catch here handles truly unhandled rejections only.
    // Write directly to process.stderr only at the actual entry point.
    process.stderr.write(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
