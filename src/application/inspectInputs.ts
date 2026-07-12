/**
 * Inspect inputs application service.
 * Reads database metadata without emitting converted card records.
 */

import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { computeFileHash } from "../hashing/sha256.js";
import type { ExitCodeState } from "../cli/exitCodes.js";

/**
 * Options for inspect.
 */
export interface InspectOptions {
  recursive?: boolean;
  exclude?: readonly string[];
  followSymlinks?: boolean;
  strict?: boolean;
}

/**
 * Table info from a CDB database.
 */
export interface TableInfo {
  name: string;
  columns: readonly { name: string; type: string }[];
  rowCount: number;
}

/**
 * Database inspection result.
 */
export interface DatabaseInspectResult {
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  tables: TableInfo[];
  datasRowCount: number;
  textsRowCount: number;
  warnings: readonly string[];
}

/**
 * Inspect report.
 */
export interface InspectReport {
  schema: "cdb.inspect/1";
  databases: DatabaseInspectResult[];
  exitCodeState: ExitCodeState;
}

/**
 * Inspect one or more CDB inputs.
 * Reads metadata without emitting converted card records.
 */
export async function inspectInputs(
  inputPaths: readonly string[],
  options: InspectOptions = {}
): Promise<InspectReport> {
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
      schema: "cdb.inspect/1",
      databases: [],
      exitCodeState: {
        optionError: false,
        hasUsableInput: false,
        inputError: true,
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

  const databases: DatabaseInspectResult[] = [];

  for (const input of discovered) {
    try {
      const sha256 = await computeFileHash(input.path);

      // Use better-sqlite3 to inspect schema
      const { openDatabaseSafe, closeDatabaseSafe } = await import(
        "../cdb/openDatabase.js"
      );

      const db = openDatabaseSafe(input.path, collector);

      const tables: TableInfo[] = [];

      // Get table list
      const tableRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      for (const table of tableRows) {
        const columnRows = db
          .prepare(
            `PRAGMA table_info("${table.name.replace(/"/g, '""')}")`
          )
          .all() as { name: string; type: string }[];

        const countRow = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM "${table.name.replace(/"/g, '""')}"`
          )
          .get() as { cnt: number };

        tables.push({
          name: table.name,
          columns: columnRows.map((c) => ({
            name: c.name,
            type: c.type,
          })),
          rowCount: countRow.cnt,
        });
      }

      const datasCount =
        tables.find((t) => t.name === "datas")?.rowCount ?? 0;
      const textsCount =
        tables.find((t) => t.name === "texts")?.rowCount ?? 0;

      closeDatabaseSafe(db);

      databases.push({
        path: input.path,
        fileName: input.name,
        sizeBytes: input.sizeBytes,
        sha256,
        tables,
        datasRowCount: datasCount,
        textsRowCount: textsCount,
        warnings: collector
          .getWarnings()
          .map((w) => `${w.code}: ${w.message}`),
      });
    } catch (error) {
      collector.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to inspect database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    schema: "cdb.inspect/1",
    databases,
    exitCodeState: {
      optionError: false,
      hasUsableInput: databases.length > 0,
      inputError: collector.hasErrors(),
      strictFailure: false,
      resourceOrIntegerFailure: false,
      mergeCollision: false,
      outputError: false,
      cancelled: false,
      continued: false,
      completedInputCount: databases.length,
      failedInputCount: discovered.length - databases.length,
      internalError: false,
    },
  };
}
