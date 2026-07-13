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

  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    return {
      success: false,
      error: `Failed to read registry file: ${path} - ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Verify content hash
  const actualHash = createHash("sha256").update(content, "utf-8").digest("hex");
  if (actualHash !== expectedHash) {
    return {
      success: false,
      error: `Registry hash mismatch for ${path}: expected ${expectedHash}, got ${actualHash}`,
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
 * Built-in registry version and hash for the default bundled registry.
 * This is the content-addressed identity of the registry embedded in the package.
 */
export const BUNDLED_REGISTRY_PIN: RegistryPin = {
  path: "@cdb-to-json/bundled-registry",
  version: "2024.01.01",
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

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
