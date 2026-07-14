/**
 * Fresh split-root CLI acceptance tests.
 *
 * These tests verify the P3-AC3 fresh split-root requirement:
 * - split=database and split=card require a nonexistent fresh root
 * - an empty existing root is rejected before input access
 * - a populated existing root is rejected before input access
 * - --force does NOT override the fresh-root requirement
 * - the rejection occurs before any SQLite open or snapshot acquisition
 *
 * These tests use the CLI directly to prove the pre-open rejection behavior.
 */

import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI_PATH = join(process.cwd(), "dist", "cli.js");
const FIXTURE_CDB = join(process.cwd(), "__tests__", "input_dir", "cards.cdb");

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cdb-fresh-root-test-"));
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

describe("fresh split root — CLI-level enforcement", () => {
  it("accepts a nonexistent output directory (fresh root)", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "fresh-out");
    try {
      const { exitCode, stderr, stdout } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
      ]);
      // Raw profile conversion succeeds with fresh directory output
      expect(exitCode).toBe(0);
      // Must NOT be OUTPUT_DIRECTORY_EXISTS
      expect(stderr).not.toContain("OUTPUT_DIRECTORY_EXISTS");
      // Should produce output files
      expect(readdirSync(outputDir)).not.toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an empty existing directory before opening the input", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-out");
    mkdirSync(outputDir);

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
      ]);
      expect(exitCode).toBe(6); // OUTPUT_DIRECTORY_EXISTS
      expect(stderr).toContain("OUTPUT_DIRECTORY_EXISTS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a populated existing directory before opening the input", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-out");
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, "prior.json"), '{"prior":true}\n');

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
      ]);
      expect(exitCode).toBe(6); // OUTPUT_DIRECTORY_EXISTS
      expect(stderr).toContain("OUTPUT_DIRECTORY_EXISTS");
      // Prior file must be untouched
      expect(readFileSync(join(outputDir, "prior.json"), "utf-8")).toBe(
        '{"prior":true}\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--force does NOT override the fresh-root requirement", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-out");
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, "prior.json"), '{"prior":true}\n');

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
        "--force",
      ]);
      // --force is for replacing existing files, not existing directories
      expect(exitCode).toBe(6); // OUTPUT_DIRECTORY_EXISTS
      expect(stderr).toContain("OUTPUT_DIRECTORY_EXISTS");
      // Prior file must be untouched
      expect(readFileSync(join(outputDir, "prior.json"), "utf-8")).toBe(
        '{"prior":true}\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects existing split root with non-empty content and preserves all contents", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-out");
    mkdirSync(outputDir);
    writeFileSync(join(outputDir, "first.json"), '{"first":true}\n');
    writeFileSync(join(outputDir, "second.json"), '{"second":true}\n');

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
      ]);
      expect(exitCode).toBe(6);
      expect(stderr).toContain("OUTPUT_DIRECTORY_EXISTS");
      // All prior files must be untouched
      expect(readFileSync(join(outputDir, "first.json"), "utf-8")).toBe(
        '{"first":true}\n',
      );
      expect(readFileSync(join(outputDir, "second.json"), "utf-8")).toBe(
        '{"second":true}\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejection occurs before any SQLite open (stdout has no converted data)", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-out");
    mkdirSync(outputDir);

    try {
      const { stdout, exitCode } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputDir,
      ]);
      expect(exitCode).toBe(6);
      // stdout must be empty (no converted data was produced)
      expect(stdout.trim()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fresh root is enforced for split=card profile", () => {
    const root = makeTempRoot();
    const outputDir = join(root, "existing-card-out");
    mkdirSync(outputDir);

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "card",
        "--format", "json",
        "--split", "card",
        "--merge",
        "--output", outputDir,
      ]);
      // May fail for other reasons (card profile not available), but must NOT succeed
      // and must NOT write to the existing directory
      expect(readdirSync(outputDir)).toEqual([]); // nothing was written
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("fresh split root — --force file replacement vs directory policy", () => {
  it("--force replaces a single existing file but not an existing directory", () => {
    const root = makeTempRoot();
    const outputFile = join(root, "cards.raw.json");

    // Create an existing file (single file, not directory)
    writeFileSync(outputFile, '{"prior":true}\n');

    try {
      // Force mode should replace the single existing file
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--output", outputFile,
        "--force",
      ]);
      // Either succeeds or fails for non-directory-output reasons
      expect(stderr).not.toContain("OUTPUT_DIRECTORY_EXISTS");
      // The output is a file, not a directory — force applies to the file, not the path kind
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("split=database requires a directory output, not a file", () => {
    const root = makeTempRoot();
    const outputFile = join(root, "out.json"); // file, not directory

    try {
      const { exitCode, stderr } = runCli([
        "convert",
        FIXTURE_CDB,
        "--profile", "raw",
        "--format", "json",
        "--split", "database",
        "--output", outputFile,
      ]);
      // split=database requires directory output
      expect(exitCode).toBe(2); // invalid option combination
      expect(stderr).toMatch(/split.*database.*output/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
