/**
 * Diagnostic codes for the cdb-to-json tool.
 * These are stable, machine-readable identifiers for issues encountered during conversion.
 */

/**
 * All possible diagnostic codes.
 * Codes are grouped by category for organizational purposes.
 */
export const DiagnosticCode = {
  // Input discovery
  NO_CDB_INPUT: "NO_CDB_INPUT",
  INVALID_PATH: "INVALID_PATH",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_PATH_TRAVERSAL: "INVALID_PATH_TRAVERSAL",

  // Database operations
  CDB_OPEN_FAILED: "CDB_OPEN_FAILED",
  UNSUPPORTED_DATABASE_ENCODING: "UNSUPPORTED_DATABASE_ENCODING",
  SOURCE_MUTATED_DURING_READ: "SOURCE_MUTATED_DURING_READ",

  // Schema validation
  MISSING_REQUIRED_TABLE: "MISSING_REQUIRED_TABLE",
  MISSING_REQUIRED_COLUMN: "MISSING_REQUIRED_COLUMN",
  INVALID_COLUMN_TYPE: "INVALID_COLUMN_TYPE",

  // Row-level issues
  INVALID_CARD_ID: "INVALID_CARD_ID",
  INVALID_INTEGER_VALUE: "INVALID_INTEGER_VALUE",
  INTEGER_OUT_OF_RANGE: "INTEGER_OUT_OF_RANGE",
  DUPLICATE_CARD_ID: "DUPLICATE_CARD_ID",
  MISSING_DATA_ROW: "MISSING_DATA_ROW",
  MISSING_TEXT_ROW: "MISSING_TEXT_ROW",

  // Text issues
  INVALID_TEXT_VALUE: "INVALID_TEXT_VALUE",
  INVALID_TEXT_ENCODING: "INVALID_TEXT_ENCODING",

  // Decoding issues
  UNKNOWN_TYPE_BITS: "UNKNOWN_TYPE_BITS",
  UNKNOWN_ATTRIBUTE_BITS: "UNKNOWN_ATTRIBUTE_BITS",
  UNKNOWN_MONSTER_TYPE_BITS: "UNKNOWN_MONSTER_TYPE_BITS",
  UNKNOWN_LINK_MARKER_BITS: "UNKNOWN_LINK_MARKER_BITS",
  UNKNOWN_AVAILABILITY_BITS: "UNKNOWN_AVAILABILITY_BITS",
  UNKNOWN_CATEGORY_BITS: "UNKNOWN_CATEGORY_BITS",
  INVALID_PACKED_LEVEL: "INVALID_PACKED_LEVEL",
  INVALID_PACKED_SETCODE: "INVALID_PACKED_SETCODE",

  // Conflict flags
  CONFLICTING_CARD_KIND_FLAGS: "CONFLICTING_CARD_KIND_FLAGS",
  CONFLICTING_SUBTYPE_FLAGS: "CONFLICTING_SUBTYPE_FLAGS",
  CONFLICTING_PROGRESSION_FLAGS: "CONFLICTING_PROGRESSION_FLAGS",

  // Text segmentation
  AMBIGUOUS_TEXT_SEGMENTATION: "AMBIGUOUS_TEXT_SEGMENTATION",
  INVALID_TEXT_MARKER: "INVALID_TEXT_MARKER",

  // Merge/conflict issues
  CARD_ID_COLLISION: "CARD_ID_COLLISION",

  // Output issues
  OUTPUT_EXISTS: "OUTPUT_EXISTS",
  OUTPUT_WRITE_FAILED: "OUTPUT_WRITE_FAILED",
  OUTPUT_PATH_COLLISION: "OUTPUT_PATH_COLLISION",
  OUTPUT_DIRECTORY_EXISTS: "OUTPUT_DIRECTORY_EXISTS",
  UNSAFE_DESTINATION_FILESYSTEM: "UNSAFE_DESTINATION_FILESYSTEM",

  // Resource limits
  RESOURCE_LIMIT_EXCEEDED: "RESOURCE_LIMIT_EXCEEDED",
  MAX_ROWS_EXCEEDED: "MAX_ROWS_EXCEEDED",
  MAX_TEXT_LENGTH_EXCEEDED: "MAX_TEXT_LENGTH_EXCEEDED",

  // Limit relations
  INVALID_LIMIT_RELATION: "INVALID_LIMIT_RELATION",

  // Legacy compatibility
  LEGACY_INTEGER_UNREPRESENTABLE: "LEGACY_INTEGER_UNREPRESENTABLE",
  LEGACY_BASENAME_COLLISION: "LEGACY_BASENAME_COLLISION",

  // Cancellation
  CANCELLED: "CANCELLED",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

/**
 * Diagnostic severity levels.
 */
export const DiagnosticSeverity = {
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
} as const;

export type DiagnosticSeverity =
  (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

/**
 * Basic diagnostic structure.
 */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  source?: {
    database?: string;
    table?: "datas" | "texts";
    cardId?: string;
    column?: string;
  };
  rawValue?: unknown;
  details?: Readonly<Record<string, unknown>>;
}

/**
 * Create a diagnostic with common fields.
 */
export function createDiagnostic(
  code: DiagnosticCode,
  severity: DiagnosticSeverity,
  message: string,
  options?: Partial<Pick<Diagnostic, "source" | "rawValue" | "details">>
): Diagnostic {
  return {
    code,
    severity,
    message,
    ...(options?.source && { source: options.source }),
    ...(options?.rawValue !== undefined && { rawValue: options.rawValue }),
    ...(options?.details && { details: options.details }),
  };
}