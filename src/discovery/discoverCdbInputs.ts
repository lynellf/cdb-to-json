/**
 * Input discovery for CDB files with proper symlink handling,
 * deterministic ordering, and exclusion rules.
 *
 * Uses lstat for symlink detection, slash-normalized relative paths,
 * and tracks realpaths to break cycles when following symlinks.
 */

import { readdir, stat } from "node:fs/promises";
import { join, basename, isAbsolute, resolve, relative } from "node:path";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { checkSymlink, SymlinkCycleTracker, isExactCdbFile, normalizePathSeparators } from "./pathPolicy.js";

/**
 * A discovered CDB input.
 */
export interface DiscoveredInput {
  /** Resolved absolute path */
  path: string;
  /** File name */
  name: string;
  /** File size in bytes */
  sizeBytes: number;
  /** True if this is a directory */
  isDirectory: boolean;
}

/**
 * Options for input discovery.
 */
export interface DiscoverInputsOptions {
  /** Diagnostic collector */
  diagnostics?: DiagnosticCollector;
  /** Recursively traverse directories */
  recursive?: boolean;
  /** Glob patterns to exclude */
  exclude?: readonly string[];
  /** Follow symbolic links */
  followSymlinks?: boolean;
}

/**
 * Check if a path matches an exclude pattern.
 */
function matchesExclude(path: string, patterns: readonly string[]): boolean {
  const normalizedPath = normalizePathSeparators(path);
  for (const pattern of patterns) {
    const normalizedPattern = normalizePathSeparators(pattern);
    if (normalizedPattern.includes("*")) {
      const regex = new RegExp(
        "^" + normalizedPattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        "i"
      );
      if (regex.test(normalizedPath)) return true;
    } else if (normalizedPattern.includes("?")) {
      const regex = new RegExp(
        "^" + normalizedPattern.replace(/\?/g, ".") + "$",
        "i"
      );
      if (regex.test(normalizedPath)) return true;
    } else if (normalizedPath.toLowerCase() === normalizedPattern.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Discover CDB files in a directory with lstat-based symlink detection.
 */
async function discoverInDirectory(
  dirPath: string,
  options: DiscoverInputsOptions,
  collected: Map<string, DiscoveredInput>,
  symlinkTracker?: SymlinkCycleTracker
): Promise<void> {
  const { recursive = false, exclude = [], diagnostics } = options;
  const tracker = symlinkTracker ?? new SymlinkCycleTracker();

  let fileNames: string[];
  try {
    fileNames = await readdir(dirPath);
  } catch (error) {
    diagnostics?.error(
      DiagnosticCode.INVALID_PATH,
      `Cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
      { details: { path: dirPath } }
    );
    return;
  }

  // Sort entries by normalized relative path for determinism
  const sortedNames = [...fileNames].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  for (const name of sortedNames) {
    const fullPath = join(dirPath, name);

    // Check exclusions against various path forms
    const relPath = normalizePathSeparators(relative(dirPath, fullPath));
    if (matchesExclude(relPath, exclude) || matchesExclude(name, exclude) || matchesExclude(fullPath, exclude)) {
      continue;
    }

    try {
      // Use lstat for symlink detection
      const symlinkInfo = await checkSymlink(fullPath);

      if (symlinkInfo.isSymlink) {
        if (!options.followSymlinks) {
          // Skip symlinks by default
          continue;
        }

        // When following symlinks, track realpaths to prevent cycles
        if (!tracker.tryVisit(symlinkInfo.realpath!)) {
          // Cycle detected, skip
          continue;
        }
      }

      // Stat the file (or target if following symlinks)
      const stats = await stat(fullPath);

      if (stats.isFile() && isExactCdbFile(name)) {
        // Only add if not already present (by realpath)
        const canonicalPath = symlinkInfo.realpath ?? fullPath;
        if (!collected.has(canonicalPath)) {
          collected.set(canonicalPath, {
            path: canonicalPath,
            name,
            sizeBytes: stats.size,
            isDirectory: false,
          });
        }
      } else if (stats.isDirectory() && recursive) {
        await discoverInDirectory(fullPath, options, collected, tracker);
      }
    } catch {
      // Skip files we can't stat
      continue;
    }
  }
}

/**
 * Discover all CDB inputs from a list of paths.
 */
export async function discoverInputs(
  inputPaths: readonly string[],
  options: DiscoverInputsOptions = {}
): Promise<readonly DiscoveredInput[]> {
  const { diagnostics } = options;
  const collected = new Map<string, DiscoveredInput>();

  // Process inputs in order
  for (const inputPath of inputPaths) {
    // Resolve to absolute path
    const absolutePath = isAbsolute(inputPath) ? inputPath : resolve(inputPath);

    try {
      // Check for symlink first
      const symlinkInfo = await checkSymlink(absolutePath);

      if (symlinkInfo.isSymlink && !options.followSymlinks) {
        diagnostics?.info(
          DiagnosticCode.INVALID_PATH,
          `Skipping symlink: ${absolutePath}`,
          { details: { path: absolutePath } }
        );
        continue;
      }

      const stats = await stat(absolutePath);

      if (stats.isFile()) {
        const fileName = basename(absolutePath);

        // Check extension — exact final .cdb
        if (!isExactCdbFile(fileName)) {
          diagnostics?.info(
            DiagnosticCode.INVALID_PATH,
            `File does not have exact .cdb extension: ${fileName}`,
            { details: { path: absolutePath } }
          );
          continue;
        }

        // Check exclusions
        if (matchesExclude(absolutePath, options.exclude ?? []) || matchesExclude(fileName, options.exclude ?? [])) {
          continue;
        }

        // Only add if not already present
        if (!collected.has(absolutePath)) {
          collected.set(absolutePath, {
            path: absolutePath,
            name: fileName,
            sizeBytes: stats.size,
            isDirectory: false,
          });
        }
      } else if (stats.isDirectory()) {
        const tracker = new SymlinkCycleTracker();
        if (symlinkInfo.isSymlink && symlinkInfo.realpath) {
          tracker.tryVisit(symlinkInfo.realpath);
        }
        await discoverInDirectory(absolutePath, options, collected, tracker);
      }
    } catch (error) {
      diagnostics?.error(
        DiagnosticCode.FILE_NOT_FOUND,
        `Path not found or inaccessible: ${inputPath}`,
        { details: { path: absolutePath, error: String(error) } }
      );
    }
  }

  return [...collected.values()];
}