/**
 * Application-level types and configuration.
 */

/**
 * Versioned resource limits.
 */
export interface LimitsV1 {
  maxRowsPerTable: number;
  maxTextBytes: number;
  maxOutputBytes: number;
  maxStagingBytes: number;
  maxSpoolBytes: number;
  maxSnapshotBytes: number;
}

/**
 * Default limits (named defaults for documentation).
 */
export const DEFAULT_MAX_ROWS = 1_000_000;
export const DEFAULT_MAX_TEXT_BYTES = 4 * 1024 * 1024; // 4 MiB
export const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const DEFAULT_MAX_STAGING_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB
export const DEFAULT_MAX_SPOOL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const DEFAULT_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

/**
 * Get the default limits.
 */
export function getDefaultLimits(): LimitsV1 {
  return {
    maxRowsPerTable: DEFAULT_MAX_ROWS,
    maxTextBytes: DEFAULT_MAX_TEXT_BYTES,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    maxStagingBytes: DEFAULT_MAX_STAGING_BYTES,
    maxSpoolBytes: DEFAULT_MAX_SPOOL_BYTES,
    maxSnapshotBytes: DEFAULT_MAX_SNAPSHOT_BYTES,
  };
}

/**
 * Validate limit relations.
 * maxSpoolBytes must not exceed maxStagingBytes.
 * maxSnapshotBytes must not exceed maxStagingBytes.
 * Returns null if valid, or an error message if invalid.
 */
export function validateLimitRelations(limits: LimitsV1): string | null {
  if (limits.maxSpoolBytes > limits.maxStagingBytes) {
    return `maxSpoolBytes (${limits.maxSpoolBytes}) exceeds maxStagingBytes (${limits.maxStagingBytes})`;
  }
  if (limits.maxSnapshotBytes > limits.maxStagingBytes) {
    return `maxSnapshotBytes (${limits.maxSnapshotBytes}) exceeds maxStagingBytes (${limits.maxStagingBytes})`;
  }
  return null;
}

/**
 * Conversion destination types.
 */
export type ConversionDestination =
  | { kind: "stdout" }
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

/**
 * Output profile type.
 */
export type OutputProfile = "raw" | "card" | "source";

/**
 * Output format type.
 */
export type OutputFormat = "json" | "jsonl";

/**
 * Split mode.
 */
export type SplitMode = "none" | "database" | "card";

/**
 * Conflict resolution when merging.
 */
export type OnConflict = "error" | "first" | "last";

/**
 * Diagnostic rendering mode.
 */
export type DiagnosticsMode = "text" | "json" | "jsonl" | "none";

/**
 * Registry configuration.
 */
export interface RegistryConfig {
  setcodeRegistryPath?: string;
  availabilityRegistryPath?: string;
}

/**
 * Normalized convert options after parsing and validation.
 * These are the semantic options used by the application layer.
 */
export interface NormalizedConvertOptions {
  inputs: readonly string[];
  profile: OutputProfile;
  format: OutputFormat;
  split: SplitMode;
  merge: boolean;
  onConflict: OnConflict;
  destination: ConversionDestination;
  limits: LimitsV1;
  locale: string | undefined;
  sourceNamespace: string;
  includeRaw: boolean;
  strict: boolean;
  pretty: boolean;
  force: boolean;
  recursive: boolean;
  exclude: readonly string[];
  followSymlinks: boolean;
  diagnosticsMode: DiagnosticsMode;
  continueOnError: boolean;
  registries: RegistryConfig;
  signal: AbortSignal | undefined;
  cliArgs: readonly string[];
}

/**
 * Options for the convert function (public API).
 */
export interface ConvertOptions {
  inputs: readonly string[];
  profile?: OutputProfile;
  format?: OutputFormat;
  split?: SplitMode;
  merge?: boolean;
  onConflict?: OnConflict;
  locale?: string;
  sourceNamespace?: string;
  includeRaw?: boolean;
  strict?: boolean;
  recursive?: boolean;
  exclude?: readonly string[];
  followSymlinks?: boolean;
  outputPath?: string | null;
  pretty?: boolean;
  force?: boolean;
  continueOnError?: boolean;
  limits?: LimitsV1;
  registries?: RegistryConfig;
  signal?: AbortSignal;
  maxSnapshotBytes?: number;
  maxStagingBytes?: number;
  maxSpoolBytes?: number;
  maxOutputBytes?: number;
  maxTextBytes?: number;
  maxRows?: number;
}

/**
 * Options for reading a single database.
 */
export interface ReadOptions {
  signal?: AbortSignal;
  limits?: LimitsV1;
  strict?: boolean;
}

/**
 * Normalization context for card conversion.
 */
export interface NormalizationContext {
  locale: string;
  sourceNamespace: string;
  registryHashes: Record<string, string>;
  limits: LimitsV1;
}

/**
 * Result of a normalization operation with diagnostics.
 */
export interface NormalizationResult<T> {
  value: T;
  diagnostics: string[];
  warnings: string[];
}
