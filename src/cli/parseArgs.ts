/**
 * CLI argument parsing using Node.js built-in parseArgs.
 *
 * Returns a typed parse result or a structured usage failure.
 * Uses strict node:util.parseArgs definitions when possible.
 * Help and version are handled separately from conversion.
 */

import { parseArgs } from "node:util";
import type {
  NormalizedConvertOptions,
  OutputProfile,
  OutputFormat,
  SplitMode,
  OnConflict,
  ConversionDestination,
  DiagnosticsMode,
  LimitsV1,
} from "../application/types.js";
import {
  getDefaultLimits,
  validateLimitRelations,
} from "../application/types.js";

/**
 * Parsed CLI arguments.
 */
export interface CliArgs {
  command: "convert" | "inspect" | "validate" | "schema" | "help" | "version";
  inputs: string[];
  options: Record<string, unknown>;
}

/**
 * Result of compiling normalized options from CLI args.
 */
export interface CompileResult {
  valid: boolean;
  options: NormalizedConvertOptions;
  error?: string;
}

/**
 * Common options available to all commands.
 */
const COMMON_OPTIONS = {
  "locale": { type: "string" as const, short: "l" },
  "source-namespace": { type: "string" as const },
  "strict": { type: "boolean" as const, short: "s" },
  "recursive": { type: "boolean" as const, short: "R" },
  "exclude": { type: "string" as const, multiple: true, short: "e" },
  "follow-symlinks": { type: "boolean" as const },
  "diagnostics": {
    type: "string" as const,
    default: "text" as const,
  },
  "continue-on-error": { type: "boolean" as const, short: "C" },
  "max-rows": { type: "string" as const },
  "max-text-bytes": { type: "string" as const },
  "max-output-bytes": { type: "string" as const },
  "max-staging-bytes": { type: "string" as const },
  "max-spool-bytes": { type: "string" as const },
  "max-snapshot-bytes": { type: "string" as const },
};

/**
 * Convert options.
 */
const CONVERT_OPTIONS = {
  ...COMMON_OPTIONS,
  "profile": { type: "string" as const, short: "p", default: "card" as const },
  "format": { type: "string" as const, short: "f", default: "json" as const },
  "output": { type: "string" as const, short: "o" },
  "split": { type: "string" as const, default: "auto" as const },
  "merge": { type: "boolean" as const, short: "m" },
  "on-conflict": { type: "string" as const, default: "error" as const },
  "pretty": { type: "boolean" as const, short: "P" },
  "force": { type: "boolean" as const, short: "F" },
  "include-raw": { type: "boolean" as const },
  "source-namespace": { type: "string" as const },
};

/**
 * Detect command from positional arguments.
 */
function detectCommand(
  args: string[]
): { command: string; remainingArgs: string[] } {
  const commands = [
    "convert",
    "inspect",
    "validate",
    "schema",
    "help",
    "version",
  ];

  if (args.length === 0) {
    return { command: "help", remainingArgs: [] };
  }

  const first = args[0];

  // Check for --version or -v
  if (first === "--version" || first === "-v") {
    return { command: "version", remainingArgs: [] };
  }

  // Check for --help or -h
  if (first === "--help" || first === "-h") {
    return { command: "help", remainingArgs: [] };
  }

  // Check if it's a known command
  if (commands.includes(first)) {
    return { command: first, remainingArgs: args.slice(1) };
  }

  // Assume convert command with the args as inputs
  return { command: "convert", remainingArgs: args };
}

/**
 * Parse CLI arguments.
 * Uses strict node:util.parseArgs where possible.
 */
export function parseCliArgs(args: string[]): CliArgs {
  const { command, remainingArgs } = detectCommand(args);

  // Determine option definitions based on command
  let optionDefs: Record<string, any>;

  switch (command) {
    case "convert":
      optionDefs = CONVERT_OPTIONS;
      break;
    case "inspect":
      optionDefs = COMMON_OPTIONS;
      break;
    case "validate":
      optionDefs = COMMON_OPTIONS;
      break;
    case "schema":
      optionDefs = { output: { type: "string" as const, short: "o" } };
      break;
    default:
      optionDefs = {};
  }

  try {
    const { values, positionals } = parseArgs({
      args: remainingArgs,
      options: optionDefs as any,
      allowPositionals: true,
      strict: false, // Use permissive mode for best-effort parsing
    });

    return {
      command: command as CliArgs["command"],
      inputs: positionals,
      options: values as Record<string, unknown>,
    };
  } catch {
    return {
      command: "help",
      inputs: [],
      options: {},
    };
  }
}

/**
 * Parse numeric option value from string.
 */
function parseNumericOption(
  value: unknown,
  name: string
): { valid: boolean; value?: number; error?: string } {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }

  const str = String(value);
  const num = parseInt(str, 10);

  if (isNaN(num) || !Number.isSafeInteger(num) || num < 0) {
    return {
      valid: false,
      error: `Invalid ${name}: '${str}' is not a valid non-negative integer`,
    };
  }

  return { valid: true, value: num };
}

/**
 * Compile normalized options from parsed CLI arguments.
 * Validates all values and returns a NormalizedConvertOptions or error.
 */
export function compileNormalizedOptions(
  parsed: CliArgs
): CompileResult {
  const opts = parsed.options;

  // Parse command-specific values
  const profile = (opts.profile as string) || "card";
  if (!["raw", "card", "source"].includes(profile)) {
    return {
      valid: false,
      options: null as any,
      error: `Invalid profile '${profile}'. Valid values: raw, card, source`,
    };
  }

  const format = (opts.format as string) || "json";
  if (!["json", "jsonl"].includes(format)) {
    return {
      valid: false,
      options: null as any,
      error: `Invalid format '${format}'. Valid values: json, jsonl`,
    };
  }

  if (format === "jsonl" && opts.pretty) {
    return {
      valid: false,
      options: null as any,
      error: "--pretty is not valid with --format jsonl.",
    };
  }

  const split = (opts.split as string) || "auto";
  if (!["none", "database", "card", "auto"].includes(split)) {
    return {
      valid: false,
      options: null as any,
      error: `Invalid split mode '${split}'. Valid values: none, database, card`,
    };
  }

  const onConflict = (opts["on-conflict"] as string) || "error";
  if (!["error", "first", "last"].includes(onConflict)) {
    return {
      valid: false,
      options: null as any,
      error: `Invalid on-conflict policy '${onConflict}'. Valid values: error, first, last`,
    };
  }

  const diagnosticsMode = (opts.diagnostics as string) || "text";
  if (!["text", "json", "jsonl", "none"].includes(diagnosticsMode)) {
    return {
      valid: false,
      options: null as any,
      error: `Invalid diagnostics mode '${diagnosticsMode}'. Valid values: text, json, jsonl, none`,
    };
  }

  // Parse numeric limits
  const maxRowsResult = parseNumericOption(opts["max-rows"], "max-rows");
  if (!maxRowsResult.valid) return { valid: false, options: null as any, error: maxRowsResult.error };
  const maxRows = maxRowsResult.value;

  const maxTextBytesResult = parseNumericOption(opts["max-text-bytes"], "max-text-bytes");
  if (!maxTextBytesResult.valid) return { valid: false, options: null as any, error: maxTextBytesResult.error };
  const maxTextBytes = maxTextBytesResult.value;

  const maxOutputBytesResult = parseNumericOption(opts["max-output-bytes"], "max-output-bytes");
  if (!maxOutputBytesResult.valid) return { valid: false, options: null as any, error: maxOutputBytesResult.error };
  const maxOutputBytes = maxOutputBytesResult.value;

  const maxStagingBytesResult = parseNumericOption(opts["max-staging-bytes"], "max-staging-bytes");
  if (!maxStagingBytesResult.valid) return { valid: false, options: null as any, error: maxStagingBytesResult.error };
  const maxStagingBytes = maxStagingBytesResult.value;

  const maxSpoolBytesResult = parseNumericOption(opts["max-spool-bytes"], "max-spool-bytes");
  if (!maxSpoolBytesResult.valid) return { valid: false, options: null as any, error: maxSpoolBytesResult.error };
  const maxSpoolBytes = maxSpoolBytesResult.value;

  const maxSnapshotBytesResult = parseNumericOption(opts["max-snapshot-bytes"], "max-snapshot-bytes");
  if (!maxSnapshotBytesResult.valid) return { valid: false, options: null as any, error: maxSnapshotBytesResult.error };
  const maxSnapshotBytes = maxSnapshotBytesResult.value;

  // Determine destination
  let destination: ConversionDestination;
  const outputPath = opts.output as string | undefined;

  if (outputPath === "-" || !outputPath) {
    destination = { kind: "stdout" };
  } else if (outputPath) {
    // Determine if it's a file or directory based on extension or split mode
    // Default to file for single input (Phase 2)
    if (split === "database" || parsed.inputs.length > 1) {
      destination = { kind: "directory", path: outputPath };
    } else {
      destination = { kind: "file", path: outputPath };
    }
  } else {
    destination = { kind: "stdout" };
  }

  // Build limits
  const defaults = getDefaultLimits();
  const limits: LimitsV1 = {
    maxRowsPerTable: maxRows ?? defaults.maxRowsPerTable,
    maxTextBytes: maxTextBytes ?? defaults.maxTextBytes,
    maxOutputBytes: maxOutputBytes ?? defaults.maxOutputBytes,
    maxStagingBytes: maxStagingBytes ?? defaults.maxStagingBytes,
    maxSpoolBytes: maxSpoolBytes ?? defaults.maxSpoolBytes,
    maxSnapshotBytes: maxSnapshotBytes ?? defaults.maxSnapshotBytes,
  };

  // Validate limit relations
  const limitError = validateLimitRelations(limits);
  if (limitError) {
    return { valid: false, options: null as any, error: limitError };
  }

  return {
    valid: true,
    options: {
      inputs: parsed.inputs,
      profile: profile as OutputProfile,
      format: format as OutputFormat,
      split: split === "auto"
        ? (parsed.inputs.length > 1 ? "database" : "none")
        : (split as SplitMode),
      merge: !!opts.merge,
      onConflict: onConflict as OnConflict,
      destination,
      limits,
      locale: opts.locale as string | undefined,
      sourceNamespace: (opts["source-namespace"] as string) || "konami",
      includeRaw: !!opts["include-raw"],
      strict: !!opts.strict,
      pretty: !!opts.pretty,
      force: !!opts.force,
      recursive: !!opts.recursive,
      exclude: (opts.exclude as string[]) || [],
      followSymlinks: !!opts["follow-symlinks"],
      diagnosticsMode: diagnosticsMode as DiagnosticsMode,
      continueOnError: !!opts["continue-on-error"],
      registries: {},
      signal: undefined,
      cliArgs: parsed.inputs,
    },
  };
}
