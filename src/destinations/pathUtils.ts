/**
 * Shared path utilities for destination modules.
 *
 * Extracted to avoid circular dependencies between fileDestination.ts,
 * commitJournal.ts, and directoryDestination.ts.
 */

import { resolve } from "node:path";

/**
 * Split an absolute output path into its parent directory and leaf name.
 * Validates the leaf name.
 */
export function splitAbsolutePath(outputPath: string): {
  parentPath: string;
  leaf: string;
} {
  if (!outputPath || outputPath.includes("\0")) {
    throw new Error("Invalid output path: empty or contains NUL");
  }
  const absolute = resolve(outputPath);
  const slash = absolute.lastIndexOf("/");
  const parentPath = slash <= 0 ? "/" : absolute.slice(0, slash);
  const leaf = absolute.slice(slash + 1);

  if (
    leaf.length === 0 ||
    leaf === "." ||
    leaf === ".." ||
    leaf.includes("/") ||
    leaf.includes("\\") ||
    leaf.includes("\0")
  ) {
    throw new Error(`Invalid output leaf: ${leaf}`);
  }

  return { parentPath, leaf };
}
