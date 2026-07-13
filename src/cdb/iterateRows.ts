/**
 * Deterministic async iterator for raw CDB card rows.
 *
 * Owns the complete reader lifecycle:
 * sourceHandle acquisition → snapshot → materialize → open → preflight → iterate → close.
 *
 * The SourceHandle is acquired once at the start of iteration and retained until
 * after the final identity recheck, at which point it is closed in finally.
 * WAL/SHM bytes are read through the handle's descriptors, not by path reopening.
 */

import type Database from "better-sqlite3";
import type { RawCardRows, RawDatasRow, RawTextsRow } from "./rawTypes.js";
import type { LimitsV1 } from "../application/types.js";
import { acquireSnapshotBundle, type SnapshotBundle } from "./snapshotBundle.js";
import { materializeSnapshot, cleanupMaterializeDir } from "./materializeSnapshot.js";
import { acquireSourceHandle, type SourceHandle } from "./sourceHandle.js";
import { preflightTextColumns } from "./textPreflight.js";
import { openDatabaseSafe, closeDatabaseSafe } from "./openDatabase.js";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Metadata about extra tables (non-card tables).
 */
export interface ExtraTableMetadata {
  name: string;
  columns: readonly string[];
  rowCount: number;
}

/**
 * Database metadata exposed after snapshot acquisition and WAL materialization.
 */
export interface RawDatabaseMetadata {
  /** SHA-256 hash of the verified physical snapshot bundle (with 'sha256:' prefix) */
  bundleHash: string;
  /** Size of the original source .cdb main file in bytes */
  sourceSizeBytes: number;
  /** Metadata for non-card tables (empty array if none) */
  extraTables: readonly ExtraTableMetadata[];
}

/**
 * Callback to receive database metadata before row iteration begins.
 * Called once after snapshot acquisition, WAL materialization, and preflight checks.
 */
export type MetadataCallback = (metadata: RawDatabaseMetadata) => void;

/**
 * Options for reading card rows as an async iterator.
 */
export interface IterateRawCardsOptions {
  /**
   * Signal to abort the operation.
   */
  signal?: AbortSignal;
  /**
   * Limits for row iteration.
   */
  limits?: LimitsV1;
  /**
   * If true, follow symlinks when opening the source database.
   * Default is false (no-follow, symlinks are rejected).
   */
  followSymlinks?: boolean;
  /**
   * Strict mode for parsing.
   */
  strict?: boolean;
  /**
   * Optional diagnostic collector.
   */
  diagnostics?: DiagnosticCollector;
  /**
   * Optional callback invoked once with verified database metadata
   * after snapshot acquisition and WAL materialization, before row iteration.
   * Allows the caller to obtain bundle hash and extra-table metadata
   * without opening the source twice.
   */
  onMetadata?: MetadataCallback;
}

// Checkpoint counter for yield/signal interleaving
const CHECKPOINT_INTERVAL = 256;

/**
 * Iterate over raw card rows from a CDB database.
 *
 * This is the ONLY public row API. It is an async iterable iterator
 * that owns the entire reader lifecycle and cleans up in finally.
 */
export async function* iterateRawCards(
  databasePath: string,
  options: IterateRawCardsOptions = {}
): AsyncIterableIterator<RawCardRows> {
  const { signal, limits, diagnostics, onMetadata, followSymlinks = false } = options;
  const maxRowsPerTable = limits?.maxRowsPerTable ?? 1_000_000;
  const maxTextBytes = limits?.maxTextBytes ?? 4 * 1024 * 1024;
  const maxSnapshotBytes = limits?.maxSnapshotBytes ?? 4 * 1024 * 1024 * 1024;

  // Track cleanup resources
  let sourceHandle: SourceHandle | null = null;
  let snapshotBundle: SnapshotBundle | null = null;
  let materializedPath: string | null = null;
  let materializeDir: string | null = null;
  let db: Database.Database | null = null;

  // Row counter for checkpoint scheduling
  let rowCount = 0;

  try {
    // Check abort signal before starting
    checkAborted(signal);

    // Phase 0: Acquire opaque SourceHandle for this input.
    // This opens the source main fd and parent fd once, captures the identity,
    // and retains them for all subsequent reads through the descriptor boundary.
    // No bytes may be read by path reopening after this point.
    sourceHandle = await acquireSourceHandle(databasePath, {
      followSymlinks,
      diagnostics,
    });

    checkAborted(signal);

    // Phase 1: Acquire snapshot bundle through the bound SourceHandle.
    // All source bytes (main, WAL, SHM) are read through the handle's descriptors.
    // The returned bundle retains a reference to the same SourceHandle for later
    // final identity recheck.
    snapshotBundle = await acquireSnapshotBundle(
      sourceHandle,
      null,
      maxSnapshotBytes,
      diagnostics
    );

    checkAborted(signal);

    // Phase 2: Materialize WAL into main-only database
    materializedPath = materializeSnapshot(
      snapshotBundle.stagingDir,
      snapshotBundle.mainPath,
      snapshotBundle.walPath,
      snapshotBundle.shmPath,
      null,
      diagnostics
    );
    materializeDir = materializedPath ? materializedPath.substring(0, materializedPath.lastIndexOf("/")) : null;

    checkAborted(signal);

    // Phase 3: Open materialized database read-only with immutable=1
    db = openDatabaseSafe(materializedPath, diagnostics);

    checkAborted(signal);

    // Phase 4: Run preflight checks
    // 4a: Row count preflight
    const datasCount = db.prepare("SELECT COUNT(*) AS row_count FROM datas").get() as { row_count: number };
    const textsCount = db.prepare("SELECT COUNT(*) AS row_count FROM texts").get() as { row_count: number };

    if (datasCount.row_count > maxRowsPerTable) {
      diagnostics?.error(
        DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
        `datas table row count (${datasCount.row_count}) exceeds maxRowsPerTable (${maxRowsPerTable})`,
        {
          details: { limitCode: "MAX_ROWS_EXCEEDED", actualCount: datasCount.row_count, maxRows: maxRowsPerTable },
        }
      );
      return;
    }

    if (textsCount.row_count > maxRowsPerTable) {
      diagnostics?.error(
        DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
        `texts table row count (${textsCount.row_count}) exceeds maxRowsPerTable (${maxRowsPerTable})`,
        {
          details: { limitCode: "MAX_ROWS_EXCEEDED", actualCount: textsCount.row_count, maxRows: maxRowsPerTable },
        }
      );
      return;
    }

    checkAborted(signal);

    // 4b: Duplicate ID preflight
    const dupDatas = db.prepare("SELECT id FROM datas GROUP BY id HAVING COUNT(*) > 1").all() as { id: bigint }[];
    if (dupDatas.length > 0) {
      const ids = dupDatas.map((r) => String(r.id));
      diagnostics?.error(
        DiagnosticCode.DUPLICATE_CARD_ID,
        `Duplicate IDs found in datas table: ${ids.join(", ")}`,
        {
          source: { database: databasePath, table: "datas" },
          details: { duplicateIds: ids },
        }
      );
      return;
    }

    const dupTexts = db.prepare("SELECT id FROM texts GROUP BY id HAVING COUNT(*) > 1").all() as { id: bigint }[];
    if (dupTexts.length > 0) {
      const ids = dupTexts.map((r) => String(r.id));
      diagnostics?.error(
        DiagnosticCode.DUPLICATE_CARD_ID,
        `Duplicate IDs found in texts table: ${ids.join(", ")}`,
        {
          source: { database: databasePath, table: "texts" },
          details: { duplicateIds: ids },
        }
      );
      return;
    }

    checkAborted(signal);

    // 4c: Text byte preflight
    const textPreflight = preflightTextColumns(db, maxTextBytes, diagnostics);
    if (!textPreflight.valid) {
      return;
    }

    checkAborted(signal);

    // Phase 4d: Collect extra-table metadata
    // Uses SQLite identifier quoting (double quotes with embedded quotes doubled)
    // to safely handle arbitrary table and column names.
    const extraTables: ExtraTableMetadata[] = [];
    try {
      const tableInfos = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('datas','texts') ORDER BY name"
        )
        .all() as { name: string }[];
      for (const { name } of tableInfos) {
        // Quote a SQLite identifier by doubling embedded double-quote characters.
        const quotedName = `"${name.replace(/"/g, '""')}"`;
        try {
          const cols = db
            .prepare(`PRAGMA table_info(${quotedName})`)
            .all() as { name: string }[];
          const countResult = db
            .prepare(`SELECT COUNT(*) AS cnt FROM ${quotedName}`)
            .get() as { cnt: number };
          extraTables.push({
            name,
            columns: cols.map((c) => c.name),
            rowCount: countResult.cnt,
          });
        } catch (err) {
          // Table became inaccessible (e.g., dropped concurrently);
          // report it as a diagnostic rather than silently skipping.
          diagnostics?.warning(
            DiagnosticCode.INVALID_PATH,
            `Could not read extra table "${name}": ${err instanceof Error ? err.message : String(err)}`,
            { source: { database: databasePath } }
          );
        }
      }
    } catch {
      // No extra tables or query failed entirely
    }

    // Emit metadata via callback before row iteration.
    // sourceSizeBytes is the original main .cdb file size (provenance contract).
    // bundleHash covers the full bundle including WAL/SHM.
    if (onMetadata) {
      onMetadata({
        bundleHash: `sha256:${snapshotBundle!.bundleHash}`,
        sourceSizeBytes: snapshotBundle!.mainFileSize,
        extraTables,
      });
    }

    // Phase 5: Execute the bounded CTE join query
    const joinSql = `
      WITH
        d AS (
          SELECT id AS sort_id, CAST(id AS TEXT) AS data_id,
                 ot, alias, setcode, type, atk, def, level, race, attribute, category,
                 ROW_NUMBER() OVER (ORDER BY id) - 1 AS data_ordinal
          FROM datas
        ),
        t AS (
          SELECT id AS sort_id, CAST(id AS TEXT) AS text_id,
                 CAST(name AS BLOB) AS name_blob,
                 CAST(desc AS BLOB) AS desc_blob,
                 CAST(str1 AS BLOB) AS str1_blob,
                 CAST(str2 AS BLOB) AS str2_blob,
                 CAST(str3 AS BLOB) AS str3_blob,
                 CAST(str4 AS BLOB) AS str4_blob,
                 CAST(str5 AS BLOB) AS str5_blob,
                 CAST(str6 AS BLOB) AS str6_blob,
                 CAST(str7 AS BLOB) AS str7_blob,
                 CAST(str8 AS BLOB) AS str8_blob,
                 CAST(str9 AS BLOB) AS str9_blob,
                 CAST(str10 AS BLOB) AS str10_blob,
                 CAST(str11 AS BLOB) AS str11_blob,
                 CAST(str12 AS BLOB) AS str12_blob,
                 CAST(str13 AS BLOB) AS str13_blob,
                 CAST(str14 AS BLOB) AS str14_blob,
                 CAST(str15 AS BLOB) AS str15_blob,
                 CAST(str16 AS BLOB) AS str16_blob,
                 ROW_NUMBER() OVER (ORDER BY id) - 1 AS text_ordinal
          FROM texts
        ),
        joined AS (
          SELECT d.sort_id AS order_id, 0 AS branch_rank,
                 d.data_id, d.data_ordinal,
                 t.text_id, t.text_ordinal,
                 d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level,
                 d.race, d.attribute, d.category,
                 t.name_blob, t.desc_blob,
                 t.str1_blob, t.str2_blob, t.str3_blob, t.str4_blob,
                 t.str5_blob, t.str6_blob, t.str7_blob, t.str8_blob,
                 t.str9_blob, t.str10_blob, t.str11_blob, t.str12_blob,
                 t.str13_blob, t.str14_blob, t.str15_blob, t.str16_blob
          FROM d LEFT JOIN t ON d.sort_id = t.sort_id
          UNION ALL
          SELECT t.sort_id AS order_id, 1 AS branch_rank,
                 NULL, NULL,
                 t.text_id, t.text_ordinal,
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL,
                 t.name_blob, t.desc_blob,
                 t.str1_blob, t.str2_blob, t.str3_blob, t.str4_blob,
                 t.str5_blob, t.str6_blob, t.str7_blob, t.str8_blob,
                 t.str9_blob, t.str10_blob, t.str11_blob, t.str12_blob,
                 t.str13_blob, t.str14_blob, t.str15_blob, t.str16_blob
          FROM t LEFT JOIN d ON t.sort_id = d.sort_id
          WHERE d.sort_id IS NULL
        )
      SELECT data_id, text_id, data_ordinal, text_ordinal,
             ot, alias, setcode, type, atk, def, level, race, attribute, category,
             name_blob, desc_blob,
             str1_blob, str2_blob, str3_blob, str4_blob,
             str5_blob, str6_blob, str7_blob, str8_blob,
             str9_blob, str10_blob, str11_blob, str12_blob,
             str13_blob, str14_blob, str15_blob, str16_blob
      FROM joined
      ORDER BY order_id, branch_rank, COALESCE(data_ordinal, text_ordinal)
    `;

    const stmt = db.prepare(joinSql);

    // Phase 6: Stream rows with checkpoints
    for (const row of stmt.iterate()) {
      checkAborted(signal);
      rowCount++;

      // Yield to event loop every CHECKPOINT_INTERVAL rows
      if (rowCount % CHECKPOINT_INTERVAL === 0) {
        await yieldToEventLoop();
        checkAborted(signal);
      }

      const r = row as JoinRow;

      if (r.data_id !== null) {
        // Has datas row
        const datasRow: RawDatasRow = {
          id: r.data_id!,
          ot: bigintToString(r.ot as bigint | null),
          alias: bigintToString(r.alias as bigint | null),
          setcode: bigintToString(r.setcode as bigint | null),
          type: bigintToString(r.type as bigint | null),
          atk: bigintToString(r.atk as bigint | null),
          def: bigintToString(r.def as bigint | null),
          level: bigintToString(r.level as bigint | null),
          race: bigintToString(r.race as bigint | null),
          attribute: bigintToString(r.attribute as bigint | null),
          category: bigintToString(r.category as bigint | null),
        };

        if (r.text_id !== null) {
          // Complete pair
          const textsRow = buildTextsRow(r);
          yield {
            datas: datasRow,
            texts: textsRow,
            dataOrdinal: r.data_ordinal as number,
            textOrdinal: r.text_ordinal as number,
          };
        } else {
          // Datas-only (orphan)
          diagnostics?.warning(
            DiagnosticCode.MISSING_TEXT_ROW,
            `Card ID ${datasRow.id} has datas row but no matching texts row`,
            { source: { database: databasePath, cardId: datasRow.id } }
          );
          yield {
            datas: datasRow,
            texts: null,
            dataOrdinal: r.data_ordinal as number,
            textOrdinal: null,
          };
        }
      } else if (r.text_id !== null) {
        // Texts-only (orphan)
        const textsRow = buildTextsRow(r);
        diagnostics?.warning(
          DiagnosticCode.MISSING_DATA_ROW,
          `Card ID ${textsRow.id} has texts row but no matching datas row`,
          { source: { database: databasePath, cardId: textsRow.id } }
        );
        yield {
          datas: null,
          texts: textsRow,
          dataOrdinal: null,
          textOrdinal: r.text_ordinal as number,
        };
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      diagnostics?.error(
        DiagnosticCode.CANCELLED,
        "Conversion cancelled",
        { details: { reason: "AbortSignal" } }
      );
    } else {
      diagnostics?.error(
        DiagnosticCode.CDB_OPEN_FAILED,
        `Database read failed: ${error instanceof Error ? error.message : String(error)}`,
        { source: { database: databasePath } }
      );
    }
  } finally {
    // Cleanup in reverse order:
    // 1. Close SQLite connection to materialized database
    if (db) {
      closeDatabaseSafe(db);
      db = null;
    }

    // 2. Clean up materialized directory
    if (materializeDir) {
      cleanupMaterializeDir(materializeDir);
    }

    // 3. Clean up snapshot staging directory
    if (snapshotBundle) {
      const { rm } = await import("node:fs/promises");
      try {
        await rm(snapshotBundle.stagingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    // 4. Close the SourceHandle and its owned descriptors.
    // This is the last step in reader-owned cleanup, AFTER all private
    // artifacts (materialized, staging) have been removed.
    // Note: The SourceHandle was verified during snapshot acquisition (via
    // verifyMainIdentity). The final post-read identity recheck and publication
    // barrier happen at the application level, not here.
    if (sourceHandle) {
      await sourceHandle.close().catch(() => {});
      sourceHandle = null;
    }
  }
}

/**
 * Interface for the join query result row.
 */
interface JoinRow {
  data_id: string | null;
  text_id: string | null;
  data_ordinal: number | null;
  text_ordinal: number | null;
  ot: bigint | null;
  alias: bigint | null;
  setcode: bigint | null;
  type: bigint | null;
  atk: bigint | null;
  def: bigint | null;
  level: bigint | null;
  race: bigint | null;
  attribute: bigint | null;
  category: bigint | null;
  name_blob: Buffer | null;
  desc_blob: Buffer | null;
  str1_blob: Buffer | null;
  str2_blob: Buffer | null;
  str3_blob: Buffer | null;
  str4_blob: Buffer | null;
  str5_blob: Buffer | null;
  str6_blob: Buffer | null;
  str7_blob: Buffer | null;
  str8_blob: Buffer | null;
  str9_blob: Buffer | null;
  str10_blob: Buffer | null;
  str11_blob: Buffer | null;
  str12_blob: Buffer | null;
  str13_blob: Buffer | null;
  str14_blob: Buffer | null;
  str15_blob: Buffer | null;
  str16_blob: Buffer | null;
}

/**
 * Convert a bigint to its decimal string representation.
 * null is preserved as null.
 */
function bigintToString(value: bigint | null): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/**
 * Decode a BLOB as UTF-8 text, returning null if null input.
 */
function decodeBlob(blob: Buffer | null): string | null {
  if (blob === null) return null;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(blob);
  } catch {
    return null;
  }
}

/**
 * Build a RawTextsRow from a join query result.
 */
function buildTextsRow(r: JoinRow): RawTextsRow {
  return {
    id: r.text_id as string,
    name: decodeBlob(r.name_blob),
    desc: decodeBlob(r.desc_blob),
    str1: decodeBlob(r.str1_blob),
    str2: decodeBlob(r.str2_blob),
    str3: decodeBlob(r.str3_blob),
    str4: decodeBlob(r.str4_blob),
    str5: decodeBlob(r.str5_blob),
    str6: decodeBlob(r.str6_blob),
    str7: decodeBlob(r.str7_blob),
    str8: decodeBlob(r.str8_blob),
    str9: decodeBlob(r.str9_blob),
    str10: decodeBlob(r.str10_blob),
    str11: decodeBlob(r.str11_blob),
    str12: decodeBlob(r.str12_blob),
    str13: decodeBlob(r.str13_blob),
    str14: decodeBlob(r.str14_blob),
    str15: decodeBlob(r.str15_blob),
    str16: decodeBlob(r.str16_blob),
  };
}

/**
 * Check AbortSignal and throw if aborted.
 */
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Operation cancelled");
  }
}

/**
 * Yield to the event loop to allow other operations (e.g., signal handling) to proceed.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}