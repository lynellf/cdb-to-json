/**
 * Tests for --setcode-registry and --availability-registry CLI options.
 *
 * P3-AC6 acceptance criterion:
 * "The --setcode-registry and --availability-registry options parse and validate
 * as public controls before discovery or SQLite access, and the normalized option
 * object preserves each selected registry identity for the dependent phase."
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseCliArgs, compileNormalizedOptions } from "../../src/cli/parseArgs.js";

// Valid SHA-256 hash (64 hex characters)
const VALID_HASH = "a".repeat(64);
const VALID_HASH_2 = "b".repeat(64);

describe("registry options (P3-AC6)", () => {
  describe("--setcode-registry", () => {
    it("accepts a valid registry descriptor with absolute path", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        `/etc/cdb-to-json/setcodes.json:v1.0@sha256:${VALID_HASH}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.options.registries.setcodeRegistry).toEqual({
          path: "/etc/cdb-to-json/setcodes.json",
          version: "v1.0",
          sha256: VALID_HASH,
        });
      }
    });

    it("rejects an invalid registry descriptor without @sha256 marker", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        "/etc/cdb-to-json/setcodes.json:v1.0",
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Error message should contain information about invalid format
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }
    });

    it("rejects an invalid registry descriptor with wrong hash format", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        `/etc/cdb-to-json/setcodes.json:v1.0@sha256:xyz`, // hash too short
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });

    it("accepts --setcode-registry with equals syntax", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        `--setcode-registry=/etc/cdb-to-json/setcodes.json:v2.0@sha256:${VALID_HASH_2}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.options.registries.setcodeRegistry?.path).toBe(
          "/etc/cdb-to-json/setcodes.json"
        );
        expect(result.options.registries.setcodeRegistry?.version).toBe("v2.0");
        expect(result.options.registries.setcodeRegistry?.sha256).toBe(VALID_HASH_2);
      }
    });
  });

  describe("--availability-registry", () => {
    it("accepts a valid registry descriptor", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--availability-registry",
        `/etc/cdb-to-json/availability.json:v1.0@sha256:${VALID_HASH}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.options.registries.availabilityRegistry).toEqual({
          path: "/etc/cdb-to-json/availability.json",
          version: "v1.0",
          sha256: VALID_HASH,
        });
      }
    });

    it("rejects an invalid registry descriptor without path", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--availability-registry",
        `:v1.0@sha256:${VALID_HASH}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });

    it("rejects an invalid registry descriptor with empty version", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--availability-registry",
        `/etc/cdb-to-json/availability.json:@sha256:${VALID_HASH}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("both options together", () => {
    it("accepts both registry options in a single command", () => {
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        `/etc/cdb-to-json/setcodes.json:v1.0@sha256:${VALID_HASH}`,
        "--availability-registry",
        `/etc/cdb-to-json/availability.json:v2.0@sha256:${VALID_HASH_2}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.options.registries.setcodeRegistry).toBeDefined();
        expect(result.options.registries.availabilityRegistry).toBeDefined();
      }
    });

    it("validates both options before any input access", () => {
      // This test verifies that validation happens at compile time,
      // not during input discovery
      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        "invalid",
        "--availability-registry",
        `/etc/cdb-to-json/availability.json:v2.0@sha256:${VALID_HASH_2}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      // Should fail because --setcode-registry is invalid
      expect(result.valid).toBe(false);
    });
  });

  describe("registry options with inspect command", () => {
    it("accepts registry options for inspect command", () => {
      const parsed = parseCliArgs([
        "inspect",
        "cards.cdb",
        "--setcode-registry",
        `/etc/cdb-to-json/setcodes.json:v1.0@sha256:${VALID_HASH}`,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      // Inspect command uses COMMON_OPTIONS which includes registry options
      expect(parsed.command).toBe("inspect");
    });
  });

  describe("registry options preserved in normalized options", () => {
    it("preserves exact registry descriptor values", () => {
      const hash1 = "1".repeat(64);
      const hash2 = "2".repeat(64);
      const setcodeValue = `/custom/setcodes.json:v3.1@sha256:${hash1}`;
      const availabilityValue = `/custom/availability.json:v4.2@sha256:${hash2}`;

      const parsed = parseCliArgs([
        "convert",
        "cards.cdb",
        "--setcode-registry",
        setcodeValue,
        "--availability-registry",
        availabilityValue,
      ]);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const result = compileNormalizedOptions({
        command: "convert",
        inputs: parsed.inputs,
        options: parsed.options,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        // Verify exact values are preserved
        expect(result.options.registries.setcodeRegistry?.path).toBe("/custom/setcodes.json");
        expect(result.options.registries.setcodeRegistry?.version).toBe("v3.1");
        expect(result.options.registries.setcodeRegistry?.sha256).toBe(hash1);

        expect(result.options.registries.availabilityRegistry?.path).toBe("/custom/availability.json");
        expect(result.options.registries.availabilityRegistry?.version).toBe("v4.2");
        expect(result.options.registries.availabilityRegistry?.sha256).toBe(hash2);
      }
    });
  });
});
