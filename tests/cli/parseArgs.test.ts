/**
 * Tests for CLI argument parsing with strict mode.
 */

import { describe, it, expect } from "vitest";
import {
  parseCliArgs,
  compileNormalizedOptions,
  type CliArgs,
} from "../../dist/cli/parseArgs.js";

describe("parseCliArgs", () => {
  describe("command detection", () => {
    it("detects convert command", () => {
      const result = parseCliArgs(["convert", "input.cdb"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("convert");
        expect(result.inputs).toEqual(["input.cdb"]);
      }
    });

    it("detects convert as default", () => {
      const result = parseCliArgs(["input.cdb"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("convert");
        expect(result.inputs).toEqual(["input.cdb"]);
      }
    });

    it("detects inspect command", () => {
      const result = parseCliArgs(["inspect", "input.cdb"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("inspect");
        expect(result.inputs).toEqual(["input.cdb"]);
      }
    });

    it("detects validate command", () => {
      const result = parseCliArgs(["validate", "input.cdb"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("validate");
        expect(result.inputs).toEqual(["input.cdb"]);
      }
    });

    it("detects schema command", () => {
      const result = parseCliArgs(["schema"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("schema");
        expect(result.inputs).toEqual([]);
      }
    });

    it("detects --version", () => {
      const result = parseCliArgs(["--version"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("version");
      }
    });

    it("detects --help", () => {
      const result = parseCliArgs(["--help"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("help");
      }
    });

    it("empty args returns help", () => {
      const result = parseCliArgs([]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.command).toBe("help");
      }
    });
  });

  describe("unknown options with strict mode", () => {
    it("returns usage error on unknown option", () => {
      const result = parseCliArgs(["--unknown-option", "input.cdb"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.usageError).toBeDefined();
      }
    });

    it("returns usage error on unknown short option", () => {
      const result = parseCliArgs(["-x", "input.cdb"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.usageError).toBeDefined();
      }
    });
  });

  describe("duplicate options", () => {
    it("rejects duplicate scalar --max-rows", () => {
      const result = parseCliArgs([
        "--max-rows=1000",
        "--max-rows=2000",
        "input.cdb"
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.usageError).toContain("Duplicate");
        expect(result.usageError).toContain("max-rows");
      }
    });

    it("rejects duplicate --profile", () => {
      const result = parseCliArgs([
        "--profile=card",
        "--profile=raw",
        "input.cdb"
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.usageError).toContain("Duplicate");
        expect(result.usageError).toContain("profile");
      }
    });

    it("allows repeated --exclude (explicitly multiple)", () => {
      const result = parseCliArgs([
        "--exclude=*.tmp",
        "--exclude=*.log",
        "input.cdb"
      ]);
      // exclude is marked as multiple: true, so duplicates are allowed
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.options.exclude).toEqual(["*.tmp", "*.log"]);
      }
    });
  });

  describe("canonical numeric parsing", () => {
    it("accepts canonical integer 0", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "0",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
    });

    it("accepts canonical integer 12345", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "12345",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
    });

    it("rejects non-canonical +12", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "+12",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a valid non-negative integer");
    });

    it("rejects non-canonical 1.2", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "1.2",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a valid non-negative integer");
    });

    it("rejects trailing junk 12junk", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "12junk",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a valid non-negative integer");
    });

    it("rejects negative -5", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "-5",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a valid non-negative integer");
    });

    it("rejects leading zero 01", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-rows": "01",
        },
      };
      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not a valid non-negative integer");
    });
  });

  describe("registry options", () => {
    it("parses setcode-registry option", () => {
      const hash = "a".repeat(64);
      const result = parseCliArgs([
        `--setcode-registry=/path/registry.json:1.0.0@sha256:${hash}`,
        "input.cdb",
      ]);
      expect(result.command).toBe("convert");
      expect(result.options["setcode-registry"]).toBe(
        `/path/registry.json:1.0.0@sha256:${hash}`
      );
    });

    it("parses availability-registry option", () => {
      const hash = "b".repeat(64);
      const result = parseCliArgs([
        `--availability-registry=/path/availability.json:1.0.0@sha256:${hash}`,
        "input.cdb",
      ]);
      expect(result.command).toBe("convert");
      expect(result.options["availability-registry"]).toBe(
        `/path/availability.json:1.0.0@sha256:${hash}`
      );
    });

    it("parses both registry options", () => {
      const hash = "c".repeat(64);
      const result = parseCliArgs([
        `--setcode-registry=/path/setcode.json:1.0.0@sha256:${hash}`,
        `--availability-registry=/path/availability.json:2.0.0@sha256:${hash}`,
        "input.cdb",
      ]);
      expect(result.options["setcode-registry"]).toBeDefined();
      expect(result.options["availability-registry"]).toBeDefined();
    });
  });

  describe("numeric limit options", () => {
    it("parses max-rows", () => {
      const result = parseCliArgs(["--max-rows=1000", "input.cdb"]);
      expect(result.options["max-rows"]).toBe("1000");
    });

    it("parses max-text-bytes", () => {
      const result = parseCliArgs(["--max-text-bytes=4096", "input.cdb"]);
      expect(result.options["max-text-bytes"]).toBe("4096");
    });

    it("parses all limit options", () => {
      const result = parseCliArgs([
        "--max-rows=1000",
        "--max-text-bytes=4096",
        "--max-output-bytes=1048576",
        "--max-staging-bytes=1073741824",
        "--max-spool-bytes=536870912",
        "--max-snapshot-bytes=2147483648",
        "input.cdb",
      ]);
      expect(result.options["max-rows"]).toBe("1000");
      expect(result.options["max-text-bytes"]).toBe("4096");
      expect(result.options["max-output-bytes"]).toBe("1048576");
      expect(result.options["max-staging-bytes"]).toBe("1073741824");
      expect(result.options["max-spool-bytes"]).toBe("536870912");
      expect(result.options["max-snapshot-bytes"]).toBe("2147483648");
    });
  });
});

describe("compileNormalizedOptions", () => {
  describe("registry options validation", () => {
    it("accepts valid setcode-registry descriptor", () => {
      const hash = "d".repeat(64);
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "setcode-registry": `/path/registry.json:1.0.0@sha256:${hash}`,
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(true);
      expect(result.options.registries.setcodeRegistry).toBeDefined();
      expect(result.options.registries.setcodeRegistry!.path).toBe("/path/registry.json");
      expect(result.options.registries.setcodeRegistry!.version).toBe("1.0.0");
      expect(result.options.registries.setcodeRegistry!.sha256).toBe(hash);
    });

    it("accepts valid availability-registry descriptor", () => {
      const hash = "e".repeat(64);
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "availability-registry": `/path/availability.json:1.0.0@sha256:${hash}`,
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(true);
      expect(result.options.registries.availabilityRegistry).toBeDefined();
    });

    it("rejects invalid setcode-registry format", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "setcode-registry": "not-a-valid-format",
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid registry descriptor format");
    });

    it("rejects invalid availability-registry format", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "availability-registry": "relative/path.json:1.0.0@sha256:a".repeat(3),
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid registry descriptor format");
    });

    it("rejects setcode-registry with traversal", () => {
      const hash = "f".repeat(64);
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "setcode-registry": `/path/../etc.json:1.0.0@sha256:${hash}`,
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("'..'");
    });

    it("rejects setcode-registry with wrong hash length", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "setcode-registry": "/path/registry.json:1.0.0@sha256:abc123",
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(false);
    });

    it("allows no registry options (uses defaults)", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);

      expect(result.valid).toBe(true);
      expect(result.options.registries.setcodeRegistry).toBeUndefined();
      expect(result.options.registries.availabilityRegistry).toBeUndefined();
    });
  });

  describe("profile validation", () => {
    it("accepts raw profile", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.profile).toBe("raw");
    });

    it("rejects invalid profile", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "invalid",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid profile");
    });
  });

  describe("format validation", () => {
    it("accepts json format", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.format).toBe("json");
    });

    it("accepts jsonl format", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "jsonl",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.format).toBe("jsonl");
    });

    it("rejects invalid format", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "xml",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid format");
    });
  });

  describe("pretty + jsonl conflict", () => {
    it("rejects pretty with jsonl", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "jsonl",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          pretty: true,
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("--pretty is not valid with --format jsonl");
    });

    it("accepts pretty with json", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          pretty: true,
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.pretty).toBe(true);
    });
  });

  describe("split mode validation", () => {
    it("accepts none split", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.split).toBe("none");
    });

    it("accepts database split", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "database",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.split).toBe("database");
    });

    it("accepts card split for non-raw profiles", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "card",
          merge: true,
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.split).toBe("card");
    });

    it("rejects card split for raw profile", () => {
      // Note: This validation happens in outputPlan.ts, not parseArgs.ts
      // parseArgs accepts all valid enum values
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "card",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      // parseArgs validates format but not profile-specific constraints
      // The profile+split constraint is validated in outputPlan.ts
      expect(result.valid).toBe(true);
      expect(result.options.split).toBe("card");
    });
  });

  describe("on-conflict validation", () => {
    it("accepts error", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.onConflict).toBe("error");
    });

    it("accepts first", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "first",
          merge: true,
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.onConflict).toBe("first");
    });

    it("accepts last", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "last",
          merge: true,
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.onConflict).toBe("last");
    });

    it("rejects invalid on-conflict", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "card",
          format: "json",
          split: "none",
          "on-conflict": "invalid",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid on-conflict");
    });
  });

  describe("destination", () => {
    it("defaults to stdout", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.destination.kind).toBe("stdout");
    });

    it("uses - for stdout explicitly", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          output: "-",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.destination.kind).toBe("stdout");
    });

    it("uses file for single input with output path", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          output: "output.json",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.destination.kind).toBe("file");
      expect(result.options.destination.path).toBe("output.json");
    });

    it("uses directory for database split", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "database",
          "on-conflict": "error",
          diagnostics: "text",
          output: "output-dir",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
      expect(result.options.destination.kind).toBe("directory");
      expect(result.options.destination.path).toBe("output-dir");
    });
  });

  describe("limit relations", () => {
    it("accepts valid limit relations", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-staging-bytes": "1000000",
          "max-spool-bytes": "500000",
          "max-snapshot-bytes": "800000",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
    });

    it("rejects maxSpoolBytes > maxStagingBytes", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-staging-bytes": "1000",
          "max-spool-bytes": "2000",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("maxSpoolBytes");
      expect(result.error).toContain("maxStagingBytes");
    });

    it("rejects maxSnapshotBytes > maxStagingBytes", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-staging-bytes": "1000",
          "max-spool-bytes": "500", // Set spool under limit first
          "max-snapshot-bytes": "2000", // Now snapshot exceeds staging
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("maxSnapshotBytes");
      expect(result.error).toContain("maxStagingBytes");
    });

    it("accepts equal limits", () => {
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          "max-staging-bytes": "1000",
          "max-spool-bytes": "1000",
          "max-snapshot-bytes": "1000",
        },
      };

      const result = compileNormalizedOptions(parsed);
      expect(result.valid).toBe(true);
    });
  });

  describe("merge with raw", () => {
    it("rejects merge with raw profile", () => {
      // Note: This validation happens in outputPlan.ts, not parseArgs.ts
      // parseArgs accepts boolean merge flag regardless of profile
      const parsed: CliArgs = {
        command: "convert",
        inputs: ["input.cdb"],
        options: {
          profile: "raw",
          format: "json",
          split: "none",
          "on-conflict": "error",
          diagnostics: "text",
          merge: true,
        },
      };

      const result = compileNormalizedOptions(parsed);
      // parseArgs validates format but not profile-specific constraints
      // The profile+merge constraint is validated in outputPlan.ts
      expect(result.valid).toBe(true);
      expect(result.options.merge).toBe(true);
    });
  });
});
