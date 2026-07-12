/**
 * Legacy compatibility wrapper for v1.x API.
 *
 * @deprecated Use convert() with profile: "raw" from the main export.
 *
 * This is the sole implementation of the deprecated v1-shaped API.
 * A non-null outputDir is the legacy caller's explicit authorization
 * to replace the old <basename>.json destinations.
 */

import { iterateRawCards } from "./cdb/iterateRows.js";
import { writeLegacyFile } from "./compatibility/legacyOutput.js";
import { DiagnosticCollector } from "./diagnostics/collector.js";
import { DiagnosticCode } from "./diagnostics/codes.js";
import { legacyContainsCdb, legacyBasename } from "./discovery/pathPolicy.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Legacy table result structure matching v1.x output.
 */
export interface LegacyTableResult {
  name: string;
  data: {
    datas: Record<string, unknown>[];
    texts: Record<string, unknown>[];
  };
}

/**
 * Options for legacy conversion.
 */
interface LegacyOptions {
  /** Whether to return tables (default: true) */
  emit?: boolean;
  /** List of file names (first-dot basename) to ignore */
  ignore?: string[];
}

/**
 * Legacy convert function that replicates the v1.x API as closely as possible.
 *
 * @deprecated Use convert() with profile: "raw" instead.
 *
 * @param inputDir - Directory containing CDB files
 * @param outputDir - Optional output directory for writing <basename>.json files
 * @param options - Options object
 * @returns Array of { name, data } results if emit is true, otherwise void
 */
export default async function legacyConvert(
  inputDir: string,
  outputDir?: string,
  options: LegacyOptions = { emit: true, ignore: [] }
): Promise<LegacyTableResult[] | void> {
  const { emit = true, ignore = [] } = options;

  const diagnostics = new DiagnosticCollector();

  try {
    // Discover legacy files: direct children whose names contain ".cdb"
    // (v1 compatible: uses first-dot basename, even for dotted/non-final names)
    const allFiles = await readdir(inputDir);
    const cdbFiles = allFiles
      .filter((name) => legacyContainsCdb(name))
      .map((name) => ({
        name: legacyBasename(name),
        path: join(inputDir, name),
      }))
      .filter((file) => !ignore.includes(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    if (cdbFiles.length === 0) {
      throw new Error("No databases found.");
    }

    // Check for basename collisions before reading
    const nameSet = new Set<string>();
    for (const file of cdbFiles) {
      if (nameSet.has(file.name)) {
        diagnostics.error(
          DiagnosticCode.LEGACY_BASENAME_COLLISION,
          `Duplicate legacy basename: ${file.name}`,
          { details: { basename: file.name } }
        );
        throw new Error(`Duplicate legacy basename collision: ${file.name}`);
      }
      nameSet.add(file.name);
    }

    const tables: LegacyTableResult[] = [];

    // Process each file through the new reader
    for (const file of cdbFiles) {
      const datasRows: Record<string, unknown>[] = [];
      const textsRows: Record<string, unknown>[] = [];

      try {
        for await (const cardRow of iterateRawCards(file.path, {
          diagnostics,
        })) {
          if (cardRow.datas) {
            datasRows.push({ ...cardRow.datas });
          }
          if (cardRow.texts) {
            textsRows.push({ ...cardRow.texts });
          }
        }
      } catch (error) {
        throw new Error(
          `Failed to parse database ${file.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      tables.push({
        name: file.name,
        data: {
          datas: datasRows,
          texts: textsRows,
        },
      });
    }

    // Write output files if output directory is specified
    if (outputDir) {
      for (const table of tables) {
        const content = JSON.stringify(table.data);
        await writeLegacyFile(outputDir, table.name, content, { diagnostics });
      }
    }

    if (emit) {
      return tables;
    }
    return;
  } catch (error) {
    // Wrap errors with the v1 compatible message format
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse databases: ${message}`);
  }
}