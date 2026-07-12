/**
 * SHA-256 hashing utilities with canonical JSON serialization.
 */

import { createHash } from "node:crypto";

/**
 * Compute SHA-256 of a buffer.
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Compute SHA-256 of a string (UTF-8 encoded).
 */
export function sha256String(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

/**
 * Canonical JSON serialization.
 *
 * Rules:
 * - UTF-8 encoding
 * - Sorted object keys (by Unicode code point order)
 * - No insignificant whitespace
 * - Explicit array order preserved
 * - Finite values only
 * - Integers encoded as decimal strings when marked
 */
export function canonicalJson(
  value: unknown,
  integerFields?: Set<string>,
  path?: string
): string {
  const currentPath = path ?? "";

  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot serialize non-finite number in canonical JSON at ${currentPath}`);
    }
    // Use JSON.stringify for numbers to get precise representation
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item, i) =>
      canonicalJson(item, integerFields, `${currentPath}[${i}]`)
    );
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map((key) => {
      const val = (value as Record<string, unknown>)[key];
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;

      // Check if this field should be treated as an integer
      if (integerFields?.has(fieldPath) && typeof val === "number") {
        return `${JSON.stringify(key)}:${JSON.stringify(String(val))}`;
      }

      return `${JSON.stringify(key)}:${canonicalJson(val, integerFields, fieldPath)}`;
    });
    return `{${pairs.join(",")}}`;
  }

  throw new Error(
    `Cannot serialize value of type ${typeof value} in canonical JSON at ${currentPath}`
  );
}

/**
 * Compute SHA-256 of a canonical JSON representation of a value.
 */
export function canonicalSha256(
  value: unknown,
  integerFields?: Set<string>
): string {
  const json = canonicalJson(value, integerFields);
  return sha256String(json);
}

/**
 * Encode a base64 string from a buffer for the snapshot bundle representation.
 */
export function base64Encode(buffer: Buffer): string {
  return buffer.toString("base64");
}

/**
 * Compute SHA-256 hash of a file.
 */
export async function computeFileHash(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(path);
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}