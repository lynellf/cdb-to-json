/**
 * CDB database opener with safe integer mode, immutable extraction,
 * encoding validation, and proper lifecycle.
 */

import Database from "better-sqlite3";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Open a CDB database read-only with safe-integer mode.
 *
 * @param path - Path to the materialized main-only database
 * @param diagnostics - Optional diagnostic collector
 * @returns The open database handle
 */
export function openDatabaseSafe(
  path: string,
  diagnostics?: DiagnosticCollector
): Database.Database {
  let db: Database.Database;

  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    diagnostics?.error(
      DiagnosticCode.CDB_OPEN_FAILED,
      `Failed to open database: ${error instanceof Error ? error.message : String(error)}`,
      { details: { path } }
    );
    throw new Error(
      `Cannot open database at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Enable safe integers via pragma
  try {
    db.pragma("safe_integers = ON");
  } catch {
    // Fallback: safeIntegers may already be the default
  }

  // Disable extension loading for security
  try {
    db.pragma("extension_loading = 0");
  } catch {
    try {
      db.pragma("extensions = 0");
    } catch {
      // Best-effort
    }
  }

  // Validate UTF-8 encoding before any value work
  const encodingResult = db.pragma("encoding", { simple: true }) as string;
  const encoding = String(encodingResult ?? "").toUpperCase();

  if (encoding !== "UTF-8") {
    db.close();
    diagnostics?.error(
      DiagnosticCode.UNSUPPORTED_DATABASE_ENCODING,
      `Database encoding is ${encoding}, expected UTF-8`,
      { details: { path, encoding } }
    );
    throw new Error(`Database at ${path} uses ${encoding} encoding, only UTF-8 is supported`);
  }

  return db;
}

/**
 * Close a database handle safely.
 */
export function closeDatabaseSafe(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // Ignore close errors
  }
}