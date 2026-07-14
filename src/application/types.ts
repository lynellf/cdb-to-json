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
 * Result of a limit-relation validation.
 * INVALID_LIMIT_RELATION is emitted before discovery or input access.
 */
export type LimitRelationResult =
  | { valid: true }
  | {
      valid: false;
      /** Stable diagnostic code used before discovery/open. */
      code: "INVALID_LIMIT_RELATION";
      message: string;
    };

/**
 * Validate limit relations (pre-open, before discovery/input access).
 *
 * maxSpoolBytes must not exceed maxStagingBytes.
 * maxSnapshotBytes must not exceed maxStagingBytes.
 *
 * Returns { valid: true } if limits are consistent.
 * Returns { valid: false, code: "INVALID_LIMIT_RELATION", message } otherwise.
 * The caller uses the code to emit the stable diagnostic and exit 2 before
 * any discovery or SQLite open occurs (pre-open contract gate).
 */
export function validateLimitRelations(limits: LimitsV1): LimitRelationResult {
  if (limits.maxSpoolBytes > limits.maxStagingBytes) {
    return {
      valid: false,
      code: "INVALID_LIMIT_RELATION",
      message: `maxSpoolBytes (${limits.maxSpoolBytes}) exceeds maxStagingBytes (${limits.maxStagingBytes})`,
    };
  }
  if (limits.maxSnapshotBytes > limits.maxStagingBytes) {
    return {
      valid: false,
      code: "INVALID_LIMIT_RELATION",
      message: `maxSnapshotBytes (${limits.maxSnapshotBytes}) exceeds maxStagingBytes (${limits.maxStagingBytes})`,
    };
  }
  return { valid: true };
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
 * Registry descriptor for content-addressed registry loading.
 * Each descriptor is a pinned, content-hash-verified registry source.
 */
export interface RegistryDescriptor {
  /** Absolute path to the registry file */
  path: string;
  /** Version string for the registry */
  version: string;
  /** SHA-256 hash of the registry content */
  sha256: string;
}

/**
 * Registry configuration with pinned, verified descriptors.
 * Replaces the old path-only configuration.
 */
export interface RegistryConfig {
  /** Setcode registry descriptor (if provided) */
  setcodeRegistry?: RegistryDescriptor;
  /** Availability registry descriptor (if provided) */
  availabilityRegistry?: RegistryDescriptor;
}

/**
 * Normalized registry configuration after loading.
 */
export interface NormalizedRegistryConfig {
  /** Setcode registry data (loaded and verified) */
  setcode?: unknown;
  /** Availability registry data (loaded and verified) */
  availability?: unknown;
  /** Whether default bundled registries are used */
  usesDefaults: boolean;
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
