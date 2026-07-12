/**
 * Path policy utilities for safe, deterministic file discovery.
 *
 * Uses lstat for symlink detection, slash-normalized relative paths,
 * and proper cycle tracking.
 */

import { lstat, realpath } from "node:fs/promises";

/**
 * Result of a symlink check.
 */
export interface SymlinkInfo {
  /** The resolved realpath if it's a symlink */
  realpath: string | null;
  /** Whether the path is a symbolic link */
  isSymlink: boolean;
}

/**
 * Check if a path is a symbolic link using lstat.
 */
export async function checkSymlink(path: string): Promise<SymlinkInfo> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      // Resolve the symlink to an absolute path
      const resolved = await realpath(path);
      return { realpath: resolved, isSymlink: true };
    }
    return { realpath: null, isSymlink: false };
  } catch {
    return { realpath: null, isSymlink: false };
  }
}

/**
 * Normalize path separators to forward slashes.
 */
export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Track visited realpaths to break symlink cycles.
 */
export class SymlinkCycleTracker {
  private visited = new Set<string>();

  /**
   * Check if a realpath has been visited and mark it if not.
   * Returns true if this is a new path (not a cycle).
   */
  tryVisit(realpathStr: string): boolean {
    if (this.visited.has(realpathStr)) {
      return false;
    }
    this.visited.add(realpathStr);
    return true;
  }

  /**
   * Clear the visited set.
   */
  reset(): void {
    this.visited.clear();
  }
}

/**
 * Determine if a filename has a .cdb extension (case-insensitive, exact final extension).
 */
export function isExactCdbFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".cdb") && lower.length > 4 && lower[lower.length - 4] === ".";
}

/**
 * Determine if a filename was accepted by the legacy "contains .cdb" rule.
 */
export function legacyContainsCdb(filename: string): boolean {
  return filename.toLowerCase().includes(".cdb");
}

/**
 * Get the legacy basename (first dot segment) from a filename.
 */
export function legacyBasename(filename: string): string {
  return filename.split(".")[0];
}