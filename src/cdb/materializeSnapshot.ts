/**
 * Materialize a WAL snapshot into a private main-only database.
 *
 * Opens the copied bundle with ordinary WAL-capable access,
 * runs VACUUM INTO to create a private main-only materialized file,
 * then closes the bundle connection.
 */

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Materialize a snapshot bundle into a private main-only database.
 *
 * @param snapshotDir - Directory containing the copied bundle files
 * @param mainPath - Path to the copied main database
 * @param _walPath - Path to the copied WAL file, or null (unused, WAL replay happens automatically)
 * @param _shmPath - Path to the copied SHM file, or null
 * @param stagingRoot - Root directory for staging output
 * @param diagnostics - Optional diagnostic collector
 * @returns Path to the materialized main-only database file
 */
export function materializeSnapshot(
  snapshotDir: string,
  mainPath: string,
  _walPath: string | null,
  _shmPath: string | null,
  stagingRoot: string | null,
  diagnostics?: DiagnosticCollector
): string {
  // Create a materialization staging directory
  const materializeDir = join(
    stagingRoot ?? dirname(snapshotDir),
    `cdb-materialize-${randomUUID()}`
  );

  try {
    if (!existsSync(materializeDir)) {
      mkdirSync(materializeDir, { recursive: true });
    }

    const materializedPath = join(materializeDir, "materialized.db");

    // Open the copied bundle with ordinary WAL-capable access
    // Note: readonly=false is required for VACUUM INTO, but we're
    // operating on a private copy, not the original
    let bundleDb: Database.Database;
    try {
      bundleDb = new Database(mainPath, { readonly: false });
    } catch (error) {
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to open snapshot bundle: ${error instanceof Error ? error.message : String(error)}`,
        { details: { snapshotDir } }
      );
      cleanupMaterializeDir(materializeDir);
      throw error;
    }

    try {
      // Run VACUUM INTO to create a private main-only materialized file
      bundleDb.pragma("journal_mode = WAL");
      bundleDb.exec(`VACUUM INTO '${materializedPath.replace(/'/g, "''")}'`);
    } catch (error) {
      bundleDb.close();
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Failed to materialize snapshot: ${error instanceof Error ? error.message : String(error)}`,
        { details: { snapshotDir } }
      );
      cleanupMaterializeDir(materializeDir);
      throw error;
    }

    bundleDb.close();

    // Verify the materialized file exists and has content
    try {
      const stats = statSync(materializedPath);
      if (stats.size === 0) {
        throw new Error("Materialized database is empty");
      }
    } catch (error) {
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Materialized database is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
      cleanupMaterializeDir(materializeDir);
      throw error;
    }

    return materializedPath;
  } catch (error) {
    cleanupMaterializeDir(materializeDir);
    throw error;
  }
}

/**
 * Clean up materialization directory.
 */
export function cleanupMaterializeDir(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}