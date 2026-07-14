/**
 * Inspect inputs application service.
 * Reads database metadata using the verified snapshot/materialization session.
 */

import { discoverInputs } from "../discovery/discoverCdbInputs.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import type { ExitCodeState } from "../cli/exitCodes.js";
import type { LimitsV1 } from "./types.js";

/**
 * Options for inspect.
 */
export interface InspectOptions {
  recursive?: boolean;
  exclude?: readonly string[];
  followSymlinks?: boolean;
  strict?: boolean;
  limits?: LimitsV1;
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
 * Uses the verified snapshot/materialization session for provenance.
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

  const databases: DatabaseInspectResult[] = [];
  let hasUsableInput = false;
  let inputError = false;

  for (const input of discovered) {
    try {
      const result = await inspectDatabase(input.path, input.name, input.sizeBytes, {
        ...options,
        diagnostics: collector,
      });

      if (result) {
        databases.push(result);
        hasUsableInput = true;
      } else {
        inputError = true;
      }
    } catch (error) {
      collector.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to inspect database: ${error instanceof Error ? error.message : String(error)}`
      );
      inputError = true;
    }
  }

  return {
    schema: "cdb.inspect/1",
    databases,
    exitCodeState: {
      optionError: false,
      hasUsableInput,
      inputError,
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

/**
 * Inspect a single database using the verified reader session.
 */
async function inspectDatabase(
  path: string,
  name: string,
  sizeBytes: number,
  options: InspectOptions & { diagnostics: DiagnosticCollector }
): Promise<DatabaseInspectResult | null> {
  const { diagnostics: collector, limits } = options;

  // Use the verified reader session to get metadata
  const { iterateRawCards } = await import("../cdb/iterateRows.js");

  let bundleHash: string | null = null;
  let sourceSizeBytes: number | null = null;
  const extraTables: { name: string; columns: readonly string[]; rowCount: number }[] = [];
  let datasRowCount = 0;
  let textsRowCount = 0;

  // Track if we got metadata
  let metadataObtained = false;

  // Create an iterator that captures metadata without yielding any rows
  const iterator = iterateRawCards(path, {
    limits,
    diagnostics: collector,
    onMetadata: (metadata) => {
      bundleHash = metadata.bundleHash;
      sourceSizeBytes = metadata.sourceSizeBytes;
      extraTables.push(...metadata.extraTables);
      metadataObtained = true;
    },
  });

  // We only want metadata, not rows. Use the iterator to consume
  // the metadata callback, then return immediately.
  try {
    // Get an iterator result - this will call onMetadata
    await iterator.next();

    // If we got here, onMetadata was called and we have metadata
    if (!metadataObtained || bundleHash === null) {
      collector.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        "Failed to obtain database metadata from reader session"
      );
      return null;
    }

    // Now get row counts from the materialized database
    // We need to open the materialized database to get counts
    const { materializeSnapshot } = await import("../cdb/materializeSnapshot.js");
    const { openDatabaseSafe, closeDatabaseSafe } = await import(
      "../cdb/openDatabase.js"
    );
    const { acquireSnapshotBundle } = await import(
      "../cdb/snapshotBundle.js"
    );

    const maxSnapshotBytes = limits?.maxSnapshotBytes ?? 4 * 1024 * 1024 * 1024;
    const maxStagingBytes = limits?.maxStagingBytes ?? 4 * 1024 * 1024 * 1024;

    const bundle = await acquireSnapshotBundle(
      path,
      null,
      maxSnapshotBytes,
      collector
    );

    const materializedPath = materializeSnapshot(
      bundle.stagingDir,
      bundle.mainPath,
      bundle.walPath,
      bundle.shmPath,
      null,
      collector,
      {
        snapshotBytes: bundle.totalBytes,
        maxSnapshotBytes,
        maxStagingBytes,
      },
    );

    if (!materializedPath) {
      collector.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        "Failed to materialize snapshot"
      );
      return null;
    }

    const db = openDatabaseSafe(materializedPath, collector);
    if (!db) {
      return null;
    }

    try {
      // Get row counts
      const datasCount = db
        .prepare("SELECT COUNT(*) AS cnt FROM datas")
        .get() as { cnt: number };
      const textsCount = db
        .prepare("SELECT COUNT(*) AS cnt FROM texts")
        .get() as { cnt: number };

      datasRowCount = datasCount.cnt;
      textsRowCount = textsCount.cnt;

      // Get all table info
      const tables: TableInfo[] = [];

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

      return {
        path,
        fileName: name,
        sizeBytes: sourceSizeBytes ?? sizeBytes,
        sha256: bundleHash,
        tables,
        datasRowCount,
        textsRowCount,
        warnings: collector
          .getWarnings()
          .map((w) => `${w.code}: ${w.message}`),
      };
    } finally {
      closeDatabaseSafe(db);
    }
  } catch (error) {
    collector.error(
      DiagnosticCode.CDB_OPEN_FAILED,
      `Failed to inspect database: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}
