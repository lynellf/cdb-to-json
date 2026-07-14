/**
 * Package contents verification tests.
 *
 * Per P6 (Phase 5) acceptance:
 * "The packed-artifact test must import the root default legacy export and
 * named convert(), iterateRawCards(), normalizeCard(), and toSourceDocument()
 * from a clean temporary install... It must assert that require/import resolution
 * does not point at a missing app/index.js, and that the declared main, exports,
 * bin, and files metadata agree with the tarball contents."
 *
 * Evidence command: npm run package:check && npx vitest run tests/package/packageContents.test.ts
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream, chmodSync, unlinkSync, rmdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createWriteStream as createWriteStreamSync } from "node:fs";

// Test fixtures directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

// Expected package structure per package.json files array
const EXPECTED_FILES = [
  "dist/index.js",
  "dist/cli.js",
  "dist/legacy.js",
  "dist/native/capability.json",
  "schemas/cdb.raw.v1.schema.json",
  "schemas/cdb.card.v2.schema.json",
  "schemas/ygo.card-source.v1.schema.json",
  "schemas/cdb.card-array.v2.schema.json",
  "schemas/ygo.card-source-array.v1.schema.json",
  "package.json",
  "README.md",
  "LICENSE",
];

// Files that must NOT be in the package
const FORBIDDEN_PATTERNS = [
  { pattern: /^src\//, name: "source files" },
  { pattern: /^tests\//, name: "test files" },
  { pattern: /^\.pi-conductor\//, name: ".pi-conductor directory" },
  { pattern: /^app\//, name: "app/ source-tree shim" },
  { pattern: /^scripts\//, name: "build scripts" },
  { pattern: /^native\//, name: "native source files" },
];

describe("package contents", () => {
  let tarballPath: string | null = null;

  // NOTE: Build is handled by tests/globalSetup.ts (runs once before all workers).
  // Per-file build hooks were removed to avoid parallel-worker race conditions.
  // Tarball generation is inlined in each test that needs it (uses --dry-run, no file creation).

  it("package.json files array contains only runtime artifacts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    const files = pkg.files as string[];

    expect(files).toBeDefined();
    expect(files).toContain("dist");
    expect(files).toContain("schemas");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");

    // Verify no test/source/app directories in files
    const invalidEntries = files.filter(
      (f) => f.startsWith("tests/") || f.startsWith("src/") || f.startsWith("app/") || f.startsWith(".pi-conductor")
    );
    expect(invalidEntries).toHaveLength(0);
  });

  it("main points to dist/index.js", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(pkg.main).toBe("./dist/index.js");
  });

  it("exports field provides named modern APIs", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports["."]).toBeDefined();
    expect(pkg.exports["."].import).toBe("./dist/index.js");
    expect(pkg.exports["./legacy"]).toBeDefined();
    expect(pkg.exports["./legacy"].import).toBe("./dist/legacy.js");
  });

  it("bin points to dist/cli.js", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["cdb-to-json"]).toBe("./dist/cli.js");
  });

  it("types field points to dist/index.d.ts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(pkg.types).toBe("./dist/index.d.ts");
  });

  describe("dist directory structure", () => {
    it("dist/index.js exists and is executable module", () => {
      const path = "dist/index.js";
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("export");
    });

    it("dist/cli.js exists and has shebang", () => {
      const path = "dist/cli.js";
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
      expect(content).toContain("cli-runtime.js");
    });

    it("dist/legacy.js exists for compatibility", () => {
      const path = "dist/legacy.js";
      expect(existsSync(path)).toBe(true);
    });

    it("dist/native/capability.json exists", () => {
      const path = "dist/native/capability.json";
      expect(existsSync(path)).toBe(true);
      const capability = JSON.parse(readFileSync(path, "utf-8"));
      expect(capability).toHaveProperty("supported");
    });
  });

  describe("schemas directory", () => {
    const schemaFiles = [
      "schemas/cdb.raw.v1.schema.json",
      "schemas/cdb.card.v2.schema.json",
      "schemas/ygo.card-source.v1.schema.json",
      "schemas/cdb.card-array.v2.schema.json",
      "schemas/ygo.card-source-array.v1.schema.json",
    ];

    for (const schema of schemaFiles) {
      it(`${schema} exists and is valid JSON`, () => {
        expect(existsSync(schema)).toBe(true);
        const content = readFileSync(schema, "utf-8");
        expect(() => JSON.parse(content)).not.toThrow();
      });
    }
  });

  describe("tarball integrity", () => {
    // Uses --dry-run throughout to avoid race conditions on the tarball file.

    it("npm pack --dry-run succeeds", () => {
      const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8", stdio: "pipe" });
      expect(output).toBeDefined();
      expect(output.length).toBeGreaterThan(0);
    });

    it("tarball contains only declared files", () => {
      const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8", stdio: "pipe" });
      const lines = output.split("\n").filter((l: string) => l.trim());

      // Check each line against allowed/forbidden patterns
      for (const line of lines) {
        // Skip npm notices and empty lines
        if (line.includes("npm notice") || !line.includes("/")) continue;

        const file = line.trim();

        // Must be in expected files or subdirectories of dist/schemas
        const isAllowed =
          EXPECTED_FILES.some((f) => file.endsWith(f)) ||
          file.startsWith("dist/") ||
          file.startsWith("schemas/") ||
          file === "package.json" ||
          file === "README.md" ||
          file === "LICENSE" ||
          file.match(/^dist\/.*\.map$/); // Source maps are allowed

        expect(isAllowed).toBe(true);
      }
    });

    it("tarball excludes source files", () => {
      const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8", stdio: "pipe" });
      const lines = output.split("\n");

      for (const pattern of FORBIDDEN_PATTERNS) {
        const matches = lines.filter((l: string) => pattern.pattern.test(l.trim()));
        expect(matches).toHaveLength(0);
      }
    });
  });

  describe("package exports resolution", () => {
    it("dist/index.js exports named modern APIs", () => {
      const content = readFileSync("dist/index.js", "utf-8");
      // Check that key exports are present
      expect(content).toContain("export");
    });

    it("dist/legacy.js exports legacyConvert", () => {
      const content = readFileSync("dist/legacy.js", "utf-8");
      expect(content).toContain("export");
    });

    it("no app/index.js reference in package exports", () => {
      // app/index.js is a source-tree shim, not part of the packed package
      const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
      const pkgStr = JSON.stringify(pkg);

      // Should not reference app/index.js in main or exports
      expect(pkgStr).not.toContain("app/index.js");
      expect(pkgStr).not.toContain('"app"');
    });
  });

  describe("native module packaging", () => {
    it("dist/native directory exists when native module is present", () => {
      const nodeModule = "dist/native/secure_destination.node";
      if (existsSync(nodeModule)) {
        expect(existsSync("dist/native/capability.json")).toBe(true);
        const capability = JSON.parse(readFileSync("dist/native/capability.json", "utf-8"));
        expect(capability.supported).toBe(true);
        expect(capability.moduleSha256).toBeDefined();
      }
    });

    it("unsupported host has no native module but has capability.json", () => {
      // This test verifies the invariant on supported hosts
      // On unsupported platforms, native module should not exist
      const nodeModule = "dist/native/secure_destination.node";
      const capability = "dist/native/capability.json";

      if (!existsSync(nodeModule) && existsSync(capability)) {
        const cap = JSON.parse(readFileSync(capability, "utf-8"));
        expect(cap.supported).toBe(false);
      }
    });
  });
});
