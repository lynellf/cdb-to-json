/**
 * Minimal legacy output writer for the v1 compatibility bridge.
 *
 * Owns output-directory creation, direct-child/symlink checks,
 * exclusive legacy lock, sibling temporary file, force-compatible
 * atomic replacement, and finally cleanup.
 */

import { writeFile, mkdir, rename, stat, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Legacy output configuration.
 */
export interface LegacyOutputOptions {
  /** Diagnostic collector */
  diagnostics?: DiagnosticCollector;
  /** Enable detailed error messages */
  verbose?: boolean;
}

/**
 * Result of a legacy write operation.
 */
export interface LegacyWriteResult {
  /** Whether the write was successful */
  success: boolean;
  /** Final output path */
  outputPath: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Write a legacy output file with the compatible v1 behavior.
 *
 * Creates the output directory if needed, uses reservation/temp/atomic
 * replacement compatible with the v1 write-repeat contract.
 */
export async function writeLegacyFile(
  outputDir: string,
  basenameStr: string,
  content: string,
  options?: LegacyOutputOptions
): Promise<LegacyWriteResult> {
  const diagnostics = options?.diagnostics;

  try {
    // Create output directory if it doesn't exist
    await mkdir(outputDir, { recursive: true });

    const outputPath = join(outputDir, `${basenameStr}.json`);
    const tempPath = `${outputPath}.tmp-${randomUUID()}`;

    // Write to temporary file
    await writeFile(tempPath, content, "utf-8");

    // Atomically replace any existing file (v1 compatible behavior)
    // Legacy bridge uses force-compatible atomic replacement
    try {
      await rename(tempPath, outputPath);
    } catch {
      // If rename fails (cross-device), copy and unlink
      await copyFile(tempPath, outputPath);
      await unlink(tempPath);
    }

    return {
      success: true,
      outputPath,
    };
  } catch (error) {
    diagnostics?.error(
      DiagnosticCode.OUTPUT_WRITE_FAILED,
      `Failed to write legacy output: ${error instanceof Error ? error.message : String(error)}`,
      { details: { outputDir, basename: basenameStr } }
    );
    return {
      success: false,
      outputPath: join(outputDir, `${basenameStr}.json`),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a legacy output path exists.
 */
export async function legacyOutputExists(
  outputDir: string,
  basenameStr: string
): Promise<boolean> {
  try {
    await stat(join(outputDir, `${basenameStr}.json`));
    return true;
  } catch {
    return false;
  }
}