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
  RegistryConfig,
  RegistryDescriptor,
} from "../application/types.js";
import {
  getDefaultLimits,
  validateLimitRelations,
} from "../application/types.js";
import { validateRegistryDescriptor } from "../registry/loadRegistry.js";

/**
 * Discriminated union for parse results.
 * Success: valid parse with command and options
 * UsageError: structured usage failure with error message
 * Help/Version: explicit help or version requests
 */
export type ParseResult =
  | { ok: true; command: "convert" | "inspect" | "validate" | "schema"; inputs: string[]; options: Record<string, unknown> }
  | { ok: true; command: "help" }
  | { ok: true; command: "version" }
  | { ok: false; usageError: string };

/**
 * Legacy parsed CLI arguments (for backward compatibility).
 * @deprecated Use ParseResult instead.
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
  "setcode-registry": { type: "string" as const },
  "availability-registry": { type: "string" as const },
};

/**
 * Convert options.
 */
const CONVERT_OPTIONS = {
  ...COMMON_OPTIONS,
  "profile": { type: "string" as const, short: "p", default: "raw" as const },
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
 * Canonical decimal integer grammar.
 * Accepts: 0, 1, 2, ..., 123, 999, etc.
 * Rejects: +1, -1, 1.2, 12junk, 01, "", etc.
 */
const CANONICAL_INTEGER_REGEX = /^(0|[1-9][0-9]*)$/;

/**
 * Track option occurrences for duplicate detection.
 */
function trackOptionOccurrences(
  args: string[],
  optionDefs: Record<string, unknown>
): { valid: boolean; duplicates?: string[] } {
  const occurrences: Record<string, number> = {};
  const duplicateNonRepeatable: string[] = [];

  // Non-repeatable option types (not multiple)
  const nonRepeatable = new Set<string>();
  for (const [name, def] of Object.entries(optionDefs)) {
    const defObj = def as { multiple?: boolean };
    if (!defObj.multiple) {
      nonRepeatable.add(name);
    }
  }

  // Count occurrences by walking args manually
  // This is a simplified approach - we track key occurrences
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      // Handle --option=value and --option value
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const optName = arg.slice(2, eqIndex);
        occurrences[optName] = (occurrences[optName] || 0) + 1;
      } else {
        const optName = arg.slice(2);
        occurrences[optName] = (occurrences[optName] || 0) + 1;
        // Check if next arg is a value (not an option)
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          // This is handled by parseArgs, but we count the option
        }
      }
    } else if (arg.startsWith("-") && arg.length > 2) {
      // Short option - check for duplicates
      const shortName = arg.slice(1, 2);
      // Map short to long name
      for (const [name, def] of Object.entries(optionDefs)) {
        const defObj = def as { short?: string };
        if (defObj.short === shortName) {
          occurrences[name] = (occurrences[name] || 0) + 1;
          break;
        }
      }
    }
  }

  // Check for duplicates in non-repeatable options
  for (const [name, count] of Object.entries(occurrences)) {
    if (count > 1 && nonRepeatable.has(name)) {
      duplicateNonRepeatable.push(name);
    }
  }

  if (duplicateNonRepeatable.length > 0) {
    return { valid: false, duplicates: duplicateNonRepeatable };
  }

  return { valid: true };
}

/**
 * Parse CLI arguments.
 * Uses strict node:util.parseArgs with duplicate detection.
 * Returns a discriminated ParseResult.
 */
export function parseCliArgs(args: string[]): ParseResult {
  const { command, remainingArgs } = detectCommand(args);

  // Handle explicit help/version before option parsing
  if (command === "help") {
    return { ok: true, command: "help" };
  }
  if (command === "version") {
    return { ok: true, command: "version" };
  }

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

  // Check for duplicate non-repeatable options before parsing
  const duplicateCheck = trackOptionOccurrences(remainingArgs, optionDefs);
  if (!duplicateCheck.valid && duplicateCheck.duplicates) {
    const dupList = duplicateCheck.duplicates.join(", ");
    return {
      ok: false,
      usageError: `Duplicate option(s): ${dupList}. These options may not be repeated.`,
    };
  }

  try {
    const { values, positionals } = parseArgs({
      args: remainingArgs,
      options: optionDefs as any,
      allowPositionals: true,
      strict: true, // Strict parsing for CLI safety
    });

    return {
      ok: true,
      command: command as "convert" | "inspect" | "validate" | "schema",
      inputs: positionals,
      options: values as Record<string, unknown>,
    };
  } catch (err) {
    // Strict parse errors are returned as structured usage failures
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      usageError: message,
    };
  }
}

/**
 * Parse numeric option value from string using canonical grammar.
 * Only accepts: 0, 1, 2, ..., 999, ... (no signs, no fractions, no trailing junk)
 */
function parseNumericOption(
  value: unknown,
  name: string
): { valid: boolean; value?: number; error?: string } {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }

  const str = String(value);

  // Validate canonical decimal integer grammar first
  if (!CANONICAL_INTEGER_REGEX.test(str)) {
    return {
      valid: false,
      error: `Invalid ${name}: '${str}' is not a valid non-negative integer (use 0, 1, 2, ...)`,
    };
  }

  const num = parseInt(str, 10);

  // Double-check after parsing
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
  // Handle usage errors from parseCliArgs
  if (!parsed.command || parsed.command === "help" || parsed.command === "version") {
    return {
      valid: false,
      options: null as any,
      error: "Invalid CLI arguments",
    };
  }

  const opts = parsed.options;

  // Parse command-specific values
  const profile = (opts.profile as string) || "raw";
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

  // split=database requires a directory output; reject file paths early
  // Use extension heuristic: paths ending with common output extensions
  // are considered file paths and are invalid with --split database
  if (split === "database" && outputPath && !outputPath.endsWith("/")) {
    const fileExtensions = [".json", ".jsonl", ".ndjson", ".txt", ".csv"];
    const hasFileExtension = fileExtensions.some((ext) =>
      outputPath.toLowerCase().endsWith(ext)
    );
    if (hasFileExtension) {
      return {
        valid: false,
        options: null as any,
        error: "--split database requires a directory output. Use --output <directory> instead of --output <file>.",
      };
    }
    destination = { kind: "directory", path: outputPath };
  } else if (outputPath === "-" || !outputPath) {
    destination = { kind: "stdout" };
  } else if (outputPath) {
    if (parsed.inputs.length > 1) {
      // Multiple inputs default to directory
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

  // Validate limit relations (pre-open: exits 2 with INVALID_LIMIT_RELATION before any discovery/open).
  // Per INV-004 / P1-AC3: this check runs before discovery or input access.
  const limitResult = validateLimitRelations(limits);
  if (!limitResult.valid) {
    // Emit the stable INVALID_LIMIT_RELATION diagnostic code and exit 2 before discovery.
    return {
      valid: false,
      options: null as any,
      error: `[${limitResult.code}] ${limitResult.message}`,
    };
  }

  // Parse registry options
  const registries = parseRegistryOptions(opts);
  if (!registries.valid) {
    return { valid: false, options: null as any, error: registries.error };
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
      registries: registries.config,
      signal: undefined,
      cliArgs: parsed.inputs,
    },
  };
}

/**
 * Parse registry options into RegistryDescriptor format.
 * Format: <path>:<version>@sha256:<hash>
 */
function parseRegistryOptions(
  opts: Record<string, unknown>
): { valid: boolean; config: RegistryConfig; error?: string } {
  const config: RegistryConfig = {};

  // Parse setcode-registry
  const setcodeRegistry = opts["setcode-registry"] as string | undefined;
  if (setcodeRegistry !== undefined) {
    const validation = validateRegistryDescriptor(setcodeRegistry);
    if (!validation.valid) {
      return { valid: false, config, error: validation.error };
    }

    const descriptor = parseRegistryDescriptorString(setcodeRegistry);
    if (!descriptor) {
      return {
        valid: false,
        config,
        error: `Invalid --setcode-registry format: ${setcodeRegistry}`,
      };
    }
    config.setcodeRegistry = descriptor;
  }

  // Parse availability-registry
  const availabilityRegistry = opts["availability-registry"] as string | undefined;
  if (availabilityRegistry !== undefined) {
    const validation = validateRegistryDescriptor(availabilityRegistry);
    if (!validation.valid) {
      return { valid: false, config, error: validation.error };
    }

    const descriptor = parseRegistryDescriptorString(availabilityRegistry);
    if (!descriptor) {
      return {
        valid: false,
        config,
        error: `Invalid --availability-registry format: ${availabilityRegistry}`,
      };
    }
    config.availabilityRegistry = descriptor;
  }

  return { valid: true, config };
}

/**
 * Parse a registry descriptor string into a RegistryDescriptor.
 * Format: <path>:<version>@sha256:<hash>
 * The path can contain colons (e.g., Windows paths or URLs).
 * The @sha256: prefix marks the start of the hash.
 */
function parseRegistryDescriptorString(descriptor: string): RegistryDescriptor | null {
  // Find the @sha256: marker and split there
  const markerIndex = descriptor.lastIndexOf("@sha256:");
  if (markerIndex === -1) {
    return null;
  }

  const hashPart = descriptor.substring(markerIndex + 8); // Skip "@sha256:"
  const beforeMarker = descriptor.substring(0, markerIndex);

  // Validate hash (64 hex characters)
  if (!/^[a-f0-9]{64}$/.test(hashPart)) {
    return null;
  }

  // Find the last colon before @sha256: to separate path from version
  const lastColonIndex = beforeMarker.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return null;
  }

  const path = beforeMarker.substring(0, lastColonIndex);
  const version = beforeMarker.substring(lastColonIndex + 1);

  if (!path || !version) {
    return null;
  }

  return {
    path,
    version,
    sha256: hashPart,
  };
}
