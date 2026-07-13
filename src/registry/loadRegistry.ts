/**
 * Registry loader with content-hash verification.
 *
 * Accepts only pinned, content-hash-verified registry data.
 * Rejects unsafe paths or missing/mismatched pins.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { RegistryPin, RegistryData, RegistryLoadResult } from "./types.js";

/**
 * Load and verify a registry from a pinned descriptor.
 *
 * Only loads from the descriptor's path after verifying its SHA-256
 * matches the expected pin. Unsafe paths or mismatched hashes are rejected.
 *
 * Security notes:
 * - Hashes exact file bytes (not UTF-8 decoded text) for content-addressed verification
 * - Requires absolute paths to prevent traversal attacks
 * - Rejects paths containing ".." for traversal protection
 *
 * @param pin - Registry pin with path and expected hash
 * @returns Load result with verified data or error
 */
export async function loadRegistry(
  pin: RegistryPin
): Promise<RegistryLoadResult> {
  const { path, version, sha256: expectedHash } = pin;

  // Reject paths that are not absolute or contain traversal
  // This is a safety check; actual security comes from the hash verification
  if (!path.startsWith("/")) {
    return {
      success: false,
      error: `Registry path must be absolute: ${path}`,
    };
  }

  if (path.includes("..")) {
    return {
      success: false,
      error: `Registry path must not contain '..': ${path}`,
    };
  }

  let rawBytes: Buffer;
  try {
    // Read exact bytes for content-addressed verification
    // Use null encoding to get raw bytes, not UTF-8 text
    rawBytes = await readFile(path);
  } catch (err) {
    return {
      success: false,
      error: `Failed to read registry file: ${path} - ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Verify content hash using exact bytes (not UTF-8 decoded text)
  // This ensures content-addressed semantics are preserved
  const actualHash = createHash("sha256").update(rawBytes).digest("hex");
  if (actualHash !== expectedHash) {
    return {
      success: false,
      error: `Registry hash mismatch for ${path}: expected ${expectedHash}, got ${actualHash}`,
    };
  }

  // Decode UTF-8 only after hash verification
  let content: string;
  try {
    content = rawBytes.toString("utf-8");
  } catch (err) {
    return {
      success: false,
      error: `Failed to decode registry as UTF-8: ${path}`,
    };
  }

  let data: RegistryData;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return {
      success: false,
      error: `Registry file is not valid JSON: ${path} - ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Verify version matches pin
  if (data.version !== version) {
    return {
      success: false,
      error: `Registry version mismatch for ${path}: expected ${version}, got ${data.version}`,
    };
  }

  return {
    success: true,
    data,
  };
}

/**
 * Parse a registry override descriptor string.
 *
 * Format: <path>:<version>@<sha256>
 * Example: /path/to/registry.json:1.0.0@sha256:abc123...
 *
 * @param descriptor - Registry descriptor string
 * @returns Parsed pin or null if invalid
 */
export function parseRegistryDescriptor(descriptor: string): RegistryPin | null {
  // Match pattern: path:version@sha256:hash
  const match = descriptor.match(/^(.+):(.+?)@sha256:([a-f0-9]{64})$/);
  if (!match) {
    return null;
  }

  const [, path, version, hash] = match;

  if (!path || !version || !hash) {
    return null;
  }

  return {
    path,
    version,
    sha256: hash,
  };
}

/**
 * Bundled registry path resolution.
 * Resolves the bundled registry to an absolute path within the package.
 * Returns null if the bundled registry is not available.
 *
 * NOTE: This function is a placeholder. When actual bundled registry content
 * is provided in the package, this should return the absolute path to it.
 */
export function resolveBundledRegistryPath(): string | null {
  // Bundled registry is not yet implemented.
  // Until bundled content is provided, use external registry overrides.
  return null;
}

/**
 * Built-in registry pin for the default bundled registry.
 * 
 * NOTE: This is a placeholder. The actual bundled registry content must be
 * provided in the package and its hash computed from the exact bytes.
 * 
 * Until actual bundled content is provided, use external registry overrides
 * with pinned descriptors for registry loading.
 *
 * Format: absolute path to bundled registry file
 */
export const BUNDLED_REGISTRY_PIN: RegistryPin | null = null; // Disabled until actual bundled content is provided

/**
 * Validate that a registry descriptor is safe to load.
 *
 * @param descriptor - Registry descriptor string
 * @returns Validation result
 */
export function validateRegistryDescriptor(descriptor: string): { valid: boolean; error?: string } {
  const pin = parseRegistryDescriptor(descriptor);

  if (!pin) {
    return {
      valid: false,
      error: `Invalid registry descriptor format: ${descriptor}. Expected format: <path>:<version>@sha256:<hash>`,
    };
  }

  // Check for absolute path
  if (!pin.path.startsWith("/")) {
    return {
      valid: false,
      error: `Registry path must be absolute: ${pin.path}`,
    };
  }

  // Check for traversal
  if (pin.path.includes("..")) {
    return {
      valid: false,
      error: `Registry path must not contain '..': ${pin.path}`,
    };
  }

  return { valid: true };
}
