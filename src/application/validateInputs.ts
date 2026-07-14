/**
 * Validate inputs application service.
 * Validates database structure, schema, IDs, text encoding without writing converted output.
 */

import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import type { ExitCodeState } from "../cli/exitCodes.js";
import type { LimitsV1 } from "./types.js";

// Signed 64-bit integer range
const MIN_INT64 = BigInt("-9223372036854775808");
const MAX_INT64 = BigInt("9223372036854775807");

/**
 * Options for validate.
 */
export interface ValidateOptions {
  recursive?: boolean;
  exclude?: readonly string[];
  followSymlinks?: boolean;
  strict?: boolean;
  limits?: LimitsV1;
}

/**
 * Per-database validation result.
 */
export interface DatabaseValidationResult {
  path: string;
  fileName: string;
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
}

/**
 * Validation report.
 */
export interface ValidationReport {
  schema: "cdb.validation/1";
  databases: DatabaseValidationResult[];
  exitCodeState: ExitCodeState;
}

/**
 * Validate one or more CDB inputs without creating converted output.
 */
export async function validateInputs(
  inputPaths: readonly string[],
  options: ValidateOptions = {}
): Promise<ValidationReport> {
  const collector = new DiagnosticCollector();

  const discovered = await discoverInputs(inputPaths, {
    recursive: options.recursive,
    exclude: options.exclude,
    followSymlinks: options.followSymlinks,
    diagnostics: collector,
  });

  if (discovered.length === 0) {
    collector.error(
      DiagnosticCode.NO_CDB_INPUT,
      "No CDB files found in input paths"
    );
    return {
      schema: "cdb.validation/1",
      databases: [],
      exitCodeState: {
        optionError: false,
        hasUsableInput: false,
        inputError: false,
        strictFailure: false,
        resourceOrIntegerFailure: false,
        mergeCollision: false,
        outputError: false,
        cancelled: false,
        continued: false,
        completedInputCount: 0,
        failedInputCount: 0,
        internalError: false,
      },
    };
  }

  const databases: DatabaseValidationResult[] = [];
  let hasUsableInput = false;
  let hasInputError = false;
  let hasStrictFailure = false;
  let hasResourceOrIntegerFailure = false;

  for (const input of discovered) {
    const dbCollector = new DiagnosticCollector();
    let dbValid = true;

    try {
      const validationResult = await validateDatabase(input.path, {
        ...options,
        strict: options.strict ?? false,
        diagnostics: dbCollector,
      });

      dbValid = validationResult.valid;
      hasUsableInput = hasUsableInput || dbValid;

      if (!dbValid) {
        hasInputError = true;
        // Check if any error is a strict-only warning
        if (validationResult.strictWarnings.length > 0) {
          hasStrictFailure = true;
        }
        // Check for resource/integer failures
        if (validationResult.resourceOrIntegerErrors.length > 0) {
          hasResourceOrIntegerFailure = true;
        }
      }
    } catch (error) {
      dbValid = false;
      hasInputError = true;
      dbCollector.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to validate database: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    databases.push({
      path: input.path,
      fileName: input.name,
      valid: dbValid,
      errors: dbCollector
        .getErrors()
        .map((e) => `${e.code}: ${e.message}`),
      warnings: dbCollector
        .getWarnings()
        .map((w) => `${w.code}: ${w.message}`),
    });
  }

  return {
    schema: "cdb.validation/1",
    databases,
    exitCodeState: {
      optionError: false,
      hasUsableInput,
      inputError: hasInputError,
      strictFailure: hasStrictFailure,
      resourceOrIntegerFailure: hasResourceOrIntegerFailure,
      mergeCollision: false,
      outputError: false,
      cancelled: false,
      continued: false,
      completedInputCount: databases.filter((d) => d.valid).length,
      failedInputCount: databases.filter((d) => !d.valid).length,
      internalError: false,
    },
  };
}

/**
 * Internal validation result for a single database.
 */
interface SingleDatabaseValidation {
  valid: boolean;
  strictWarnings: string[];
  resourceOrIntegerErrors: string[];
}

/**
 * Validate a single database.
 */
async function validateDatabase(
  path: string,
  options: ValidateOptions & { diagnostics: DiagnosticCollector }
): Promise<SingleDatabaseValidation> {
  const { diagnostics: collector, limits, strict } = options;

  let valid = true;
  const strictWarnings: string[] = [];
  const resourceOrIntegerErrors: string[] = [];

  // Use the reader's openDatabaseSafe which handles encoding validation
  const { openDatabaseSafe, closeDatabaseSafe } = await import(
    "../cdb/openDatabase.js"
  );

  const db = openDatabaseSafe(path, collector);
  if (!db) {
    valid = false;
    return { valid, strictWarnings, resourceOrIntegerErrors };
  }

  try {
    // 1. Check required tables exist
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = new Set(tableRows.map((t) => t.name));

    if (!tableNames.has("datas")) {
      collector.error(
        DiagnosticCode.MISSING_REQUIRED_TABLE,
        "Missing required 'datas' table",
        { source: { database: path } }
      );
      valid = false;
    }

    if (!tableNames.has("texts")) {
      collector.error(
        DiagnosticCode.MISSING_REQUIRED_TABLE,
        "Missing required 'texts' table",
        { source: { database: path } }
      );
      valid = false;
    }

    if (!valid) {
      return { valid, strictWarnings, resourceOrIntegerErrors };
    }

    // 2. Validate required columns in datas table
    const datasColumns = db
      .prepare("PRAGMA table_info(\"datas\")")
      .all() as { name: string; type: string }[];

    const requiredDatasColumns = [
      "id",
      "ot",
      "alias",
      "setcode",
      "type",
      "atk",
      "def",
      "level",
      "race",
      "attribute",
      "category",
    ];

    for (const col of requiredDatasColumns) {
      if (!datasColumns.find((c) => c.name === col)) {
        collector.error(
          DiagnosticCode.MISSING_REQUIRED_COLUMN,
          `Missing required column 'datas.${col}'`,
          { source: { database: path, table: "datas", column: col } }
        );
        valid = false;
      }
    }

    // 3. Validate required columns in texts table
    const textsColumns = db
      .prepare("PRAGMA table_info(\"texts\")")
      .all() as { name: string; type: string }[];

    const requiredTextsColumns = [
      "id",
      "name",
      "desc",
      "str1",
      "str2",
      "str3",
      "str4",
      "str5",
      "str6",
      "str7",
      "str8",
      "str9",
      "str10",
      "str11",
      "str12",
      "str13",
      "str14",
      "str15",
      "str16",
    ];

    for (const col of requiredTextsColumns) {
      if (!textsColumns.find((c) => c.name === col)) {
        collector.error(
          DiagnosticCode.MISSING_REQUIRED_COLUMN,
          `Missing required column 'texts.${col}'`,
          { source: { database: path, table: "texts", column: col } }
        );
        valid = false;
      }
    }

    if (!valid) {
      return { valid, strictWarnings, resourceOrIntegerErrors };
    }

    // 4. Validate IDs: must be non-null integers in signed 64-bit range
    const datasRows = db
      .prepare("SELECT id FROM datas")
      .all() as { id: string | number | bigint | null }[];

    const seenIds = new Set<string>();
    const idValidator = (id: string | number | bigint | null, table: "datas" | "texts"): boolean => {
      if (id === null) {
        collector.error(
          DiagnosticCode.INVALID_CARD_ID,
          `NULL card ID found in ${table} table`,
          { source: { database: path, table } }
        );
        return false;
      }

      let intValue: bigint;
      if (typeof id === "bigint") {
        intValue = id;
      } else if (typeof id === "number") {
        intValue = BigInt(Math.floor(id));
      } else {
        // String - validate it's a valid decimal integer
        const parsed = BigInt(id);
        intValue = parsed;
      }

      // Check signed 64-bit range
      if (intValue < MIN_INT64 || intValue > MAX_INT64) {
        collector.error(
          DiagnosticCode.INTEGER_OUT_OF_RANGE,
          `Card ID ${intValue} is outside signed 64-bit range`,
          { source: { database: path, table } }
        );
        resourceOrIntegerErrors.push(`INTEGER_OUT_OF_RANGE: ${intValue}`);
        return false;
      }

      return true;
    };

    for (const row of datasRows) {
      if (!idValidator(row.id, "datas")) {
        valid = false;
      } else {
        const idStr = String(row.id);
        if (seenIds.has(idStr)) {
          collector.error(
            DiagnosticCode.DUPLICATE_CARD_ID,
            `Duplicate card ID ${idStr} in datas table`,
            { source: { database: path, table: "datas", cardId: idStr } }
          );
          valid = false;
        }
        seenIds.add(idStr);
      }
    }

    // 5. Validate texts IDs
    const textsRows = db
      .prepare("SELECT id FROM texts")
      .all() as { id: string | number | bigint | null }[];

    for (const row of textsRows) {
      if (!idValidator(row.id, "texts")) {
        valid = false;
      } else {
        const idStr = String(row.id);
        if (!seenIds.has(idStr)) {
          // Orphan text - datas exists but this texts ID doesn't
          collector.warning(
            DiagnosticCode.MISSING_DATA_ROW,
            `Text row has no corresponding data row for ID ${idStr}`,
            { source: { database: path, table: "texts", cardId: idStr } }
          );
          if (strict) {
            collector.error(
              DiagnosticCode.MISSING_DATA_ROW,
              `Strict mode: text row has no corresponding data row for ID ${idStr}`,
              { source: { database: path, table: "texts", cardId: idStr } }
            );
            strictWarnings.push(`MISSING_DATA_ROW: ${idStr}`);
            valid = false;
          }
        }
        seenIds.add(idStr);
      }
    }

    // 6. Check for datas rows without texts
    const allDatasIds = new Set<string>();
    const datasIdRows = db.prepare("SELECT id FROM datas").all() as { id: unknown }[];
    for (const r of datasIdRows) {
      allDatasIds.add(String(r.id));
    }

    const allTextsIds = new Set<string>();
    const textsIdRows = db.prepare("SELECT id FROM texts").all() as { id: unknown }[];
    for (const r of textsIdRows) {
      allTextsIds.add(String(r.id));
    }

    for (const datasId of allDatasIds) {
      if (!allTextsIds.has(datasId)) {
        collector.warning(
          DiagnosticCode.MISSING_TEXT_ROW,
          `Data row has no corresponding text row for ID ${datasId}`,
          { source: { database: path, table: "datas", cardId: datasId } }
        );
        if (strict) {
          collector.error(
            DiagnosticCode.MISSING_TEXT_ROW,
            `Strict mode: data row has no corresponding text row for ID ${datasId}`,
            { source: { database: path, table: "datas", cardId: datasId } }
          );
          strictWarnings.push(`MISSING_TEXT_ROW: ${datasId}`);
          valid = false;
        }
      }
    }

    // 7. Text encoding preflight - sample text columns for invalid UTF-8
    const textColumns = textsColumns.filter((c) =>
      ["name", "desc", "str1", "str2", "str3", "str4", "str5", "str6", "str7",
       "str8", "str9", "str10", "str11", "str12", "str13", "str14", "str15", "str16"].includes(c.name)
    );

    // Sample up to 1000 rows for encoding check (performance)
    const sampleRows = db
      .prepare("SELECT * FROM texts LIMIT 1000")
      .all() as Record<string, unknown>[];

    const decoder = new TextDecoder("utf-8", { fatal: true });

    for (const row of sampleRows) {
      for (const col of textColumns) {
        const value = row[col.name];
        if (value !== null && value !== undefined) {
          // Check if it's a BLOB (should be) or TEXT
          if (Buffer.isBuffer(value)) {
            try {
              decoder.decode(value);
            } catch {
              collector.error(
                DiagnosticCode.INVALID_TEXT_ENCODING,
                `Invalid UTF-8 encoding in ${col.name}`,
                { source: { database: path, table: "texts", column: col.name } }
              );
              valid = false;
            }
          } else if (typeof value === "string") {
            // Already a string - verify it decodes
            try {
              encoder.encode(value);
            } catch {
              // String was already decoded, check if it's valid UTF-16
              collector.error(
                DiagnosticCode.INVALID_TEXT_ENCODING,
                `Invalid text encoding in ${col.name}`,
                { source: { database: path, table: "texts", column: col.name } }
              );
              valid = false;
            }
          } else {
            // Wrong storage class - not TEXT or NULL
            collector.error(
              DiagnosticCode.INVALID_TEXT_VALUE,
              `Column ${col.name} has wrong storage class (expected TEXT/NULL, got ${typeof value})`,
              { source: { database: path, table: "texts", column: col.name } }
            );
            valid = false;
          }
        }
      }
    }

    // 8. Check resource limits
    const maxRows = limits?.maxRowsPerTable ?? 1_000_000;
    if (datasRows.length > maxRows) {
      collector.error(
        DiagnosticCode.MAX_ROWS_EXCEEDED,
        `datas table has ${datasRows.length} rows, exceeds limit of ${maxRows}`,
        { source: { database: path, table: "datas" } }
      );
      resourceOrIntegerErrors.push(`MAX_ROWS_EXCEEDED: ${datasRows.length}`);
      valid = false;
    }

    if (textsRows.length > maxRows) {
      collector.error(
        DiagnosticCode.MAX_ROWS_EXCEEDED,
        `texts table has ${textsRows.length} rows, exceeds limit of ${maxRows}`,
        { source: { database: path, table: "texts" } }
      );
      resourceOrIntegerErrors.push(`MAX_ROWS_EXCEEDED: ${textsRows.length}`);
      valid = false;
    }
  } finally {
    closeDatabaseSafe(db);
  }

  return { valid, strictWarnings, resourceOrIntegerErrors };
}

// Text encoder for UTF-8 validation
const encoder = new TextEncoder();
