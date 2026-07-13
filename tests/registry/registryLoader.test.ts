/**
 * Tests for registry loader with content-hash verification.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  loadRegistry,
  parseRegistryDescriptor,
  validateRegistryDescriptor,
  BUNDLED_REGISTRY_PIN,
} from "../../dist/registry/loadRegistry.js";

describe("Registry Loader", () => {
  const testDir = "/tmp/cdb-to-json-registry-test";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("parseRegistryDescriptor", () => {
    it("parses valid descriptor with absolute path", () => {
      const hash = "a".repeat(64);
      const descriptor = `/path/to/registry.json:1.0.0@sha256:${hash}`;
      const pin = parseRegistryDescriptor(descriptor);

      expect(pin).not.toBeNull();
      expect(pin!.path).toBe("/path/to/registry.json");
      expect(pin!.version).toBe("1.0.0");
      expect(pin!.sha256).toBe(hash);
    });

    it("parses descriptor with complex path", () => {
      const hash = "b".repeat(64);
      const descriptor = `/var/data/my-registry-2024.json:2.1.0@sha256:${hash}`;
      const pin = parseRegistryDescriptor(descriptor);

      expect(pin).not.toBeNull();
      expect(pin!.path).toBe("/var/data/my-registry-2024.json");
      expect(pin!.version).toBe("2.1.0");
      expect(pin!.sha256).toBe(hash);
    });

    it("returns null for invalid format - missing sha256", () => {
      const pin = parseRegistryDescriptor("/path/to/registry.json:1.0.0");
      expect(pin).toBeNull();
    });

    it("returns null for invalid format - missing version", () => {
      const pin = parseRegistryDescriptor("/path/to/registry.json@sha256:a".repeat(64));
      expect(pin).toBeNull();
    });

    it("returns null for invalid format - missing path", () => {
      const pin = parseRegistryDescriptor(":1.0.0@sha256:a".repeat(64));
      expect(pin).toBeNull();
    });

    it("returns null for invalid format - wrong hash length", () => {
      const pin = parseRegistryDescriptor("/path/to/registry.json:1.0.0@sha256:abc123");
      expect(pin).toBeNull();
    });

    it("returns null for invalid format - wrong prefix", () => {
      const hash = "a".repeat(64);
      const pin = parseRegistryDescriptor(`/path/to/registry.json:1.0.0@md5:${hash}`);
      expect(pin).toBeNull();
    });
  });

  describe("validateRegistryDescriptor", () => {
    it("accepts valid absolute path descriptor", () => {
      const hash = "c".repeat(64);
      const result = validateRegistryDescriptor(`/path/registry.json:1.0.0@sha256:${hash}`);
      expect(result.valid).toBe(true);
    });

    it("rejects relative path", () => {
      const hash = "d".repeat(64);
      const result = validateRegistryDescriptor(`relative/path.json:1.0.0@sha256:${hash}`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("absolute");
    });

    it("rejects path with traversal", () => {
      const hash = "e".repeat(64);
      const result = validateRegistryDescriptor(`/path/../etc.json:1.0.0@sha256:${hash}`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("'..'");
    });

    it("rejects invalid descriptor format", () => {
      const result = validateRegistryDescriptor("not-a-valid-descriptor");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid registry descriptor format");
    });
  });

  describe("loadRegistry", () => {
    it("loads and verifies valid registry", async () => {
      const registryContent = JSON.stringify({
        version: "1.0.0",
        meta: { description: "Test registry" },
        data: { test: "value" },
      });
      const filePath = join(testDir, "test-registry.json");
      await writeFile(filePath, registryContent);

      // Hash exact bytes (same as loader does)
      const fileBytes = readFileSync(filePath);
      const hash = createHash("sha256").update(fileBytes).digest("hex");

      const pin = {
        path: filePath,
        version: "1.0.0",
        sha256: hash,
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.version).toBe("1.0.0");
    });

    it("rejects mismatched hash", async () => {
      const registryContent = JSON.stringify({
        version: "1.0.0",
        data: { test: "value" },
      });
      const filePath = join(testDir, "mismatched-registry.json");
      await writeFile(filePath, registryContent);

      const pin = {
        path: filePath,
        version: "1.0.0",
        sha256: "f".repeat(64), // Wrong hash
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("hash mismatch");
    });

    it("rejects mismatched version", async () => {
      const registryContent = JSON.stringify({
        version: "2.0.0",
        data: { test: "value" },
      });
      const filePath = join(testDir, "version-mismatch.json");
      await writeFile(filePath, registryContent);

      // Hash exact bytes
      const fileBytes = readFileSync(filePath);
      const hash = createHash("sha256").update(fileBytes).digest("hex");

      const pin = {
        path: filePath,
        version: "1.0.0", // Wrong version
        sha256: hash,
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("version mismatch");
    });

    it("rejects missing file", async () => {
      const pin = {
        path: "/nonexistent/path/registry.json",
        version: "1.0.0",
        sha256: "0".repeat(64),
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read");
    });

    it("rejects invalid JSON", async () => {
      const filePath = join(testDir, "invalid-json.json");
      await writeFile(filePath, "not valid json {{{");

      // Hash exact bytes
      const fileBytes = readFileSync(filePath);
      const hash = createHash("sha256").update(fileBytes).digest("hex");
      const pin = {
        path: filePath,
        version: "1.0.0",
        sha256: hash,
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not valid JSON");
    });

    it("rejects relative path", async () => {
      const pin = {
        path: "relative/path.json",
        version: "1.0.0",
        sha256: "1".repeat(64),
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be absolute");
    });

    it("rejects path with traversal", async () => {
      const pin = {
        path: "/path/../etc/passwd",
        version: "1.0.0",
        sha256: "2".repeat(64),
      };

      const result = await loadRegistry(pin);

      expect(result.success).toBe(false);
      expect(result.error).toContain("must not contain '..'");
    });
  });

  describe("BUNDLED_REGISTRY_PIN", () => {
    it("is null until actual bundled content is provided", () => {
      // BUNDLED_REGISTRY_PIN is null until actual bundled registry content is provided
      // This ensures the security contract is maintained (no placeholder content)
      expect(BUNDLED_REGISTRY_PIN).toBeNull();
    });
  });
});
