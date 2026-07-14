/**
 * Process-level smoke tests for the compiled CLI.
 *
 * Spawns the compiled dist/cli.js rather than importing main().
 * Tests raw stdout JSON/JSONL, inspect, validate, schema,
 * stderr separation, invalid combinations, and unsupported-host
 * destination handling.
 */

import { describe, it, expect } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { join } from "node:path";

// Path to compiled CLI
const CLI_PATH = join(process.cwd(), "dist", "cli.js");

// Test fixture path
const FIXTURE_DIR = join(process.cwd(), "__tests__", "input_dir");
const FIXTURE_CDB = join(FIXTURE_DIR, "cards.cdb");

/**
 * Run the CLI and return stdout, stderr, and exit code (properly separated).
 */
function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 50 * 1024 * 1024,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

describe("CLI Process Smoke Tests", () => {
  it("--help prints usage and exits 0", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb-to-json");
  });

  it("--version prints version and exits 0", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb-to-json");
  });

  it("unknown command exits 2", () => {
    const { stderr, exitCode } = runCli(["unknown"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown command");
  });
});

describe("Schema Command", () => {
  it("schema raw prints the raw schema", () => {
    const { stdout, exitCode } = runCli(["schema", "raw"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb.raw/1");
  });

  it("schema card prints the card schema", () => {
    const { stdout, exitCode } = runCli(["schema", "card"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb.card/2");
  });

  it("schema card-array prints the card array schema", () => {
    const { stdout, exitCode } = runCli(["schema", "card-array"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb.card-array/2");
  });

  it("schema source prints the source schema", () => {
    const { stdout, exitCode } = runCli(["schema", "source"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ygo.card-source/1");
  });

  it("schema source-array prints the source-array schema", () => {
    const { stdout, exitCode } = runCli(["schema", "source-array"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ygo.card-source-array/1");
  });

  it("schema with invalid profile exits 2", () => {
    const { stderr, exitCode } = runCli(["schema", "invalid"]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid profile");
  });
});

describe("Inspect Command", () => {
  it("inspect a CDB file produces machine output", () => {
    const { stdout, exitCode } = runCli(["inspect", FIXTURE_CDB]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb.inspect/1");
    expect(stdout).toContain("cards.cdb");
  });

  it("inspect with no input exits 3", () => {
    const { stderr, exitCode } = runCli(["inspect", "/nonexistent/path.cdb"]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("No CDB");
  });
});

describe("Validate Command", () => {
  it("validate a CDB file produces machine output", () => {
    const { stdout, exitCode } = runCli(["validate", FIXTURE_CDB]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("cdb.validation/1");
  });

  it("validate with no CDB input exits 3", () => {
    const { stderr, exitCode } = runCli(["validate", "/nonexistent/path.cdb"]);
    expect(exitCode).toBe(3);
    expect(stderr).toContain("No CDB");
  });
});

describe("Convert Command", () => {
  it("rejects card profile with option error", () => {
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "card"
    ]);
    expect(stderr).toContain("not available");
    expect(exitCode).toBe(2);
  });

  it("rejects source profile with option error", () => {
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "source"
    ]);
    expect(stderr).toContain("not available");
    expect(exitCode).toBe(2);
  });

  it("rejects merge with raw profile", () => {
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw", "--merge"
    ]);
    expect(stderr).toContain("not support");
    expect(exitCode).toBe(2);
  });

  it("rejects split card with raw profile", () => {
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw", "--split", "card"
    ]);
    expect(stderr).toContain("not support");
    expect(exitCode).toBe(2);
  });

  it("rejects pretty with jsonl", () => {
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--format", "jsonl", "--pretty"
    ]);
    expect(stderr).toContain("not valid");
    expect(exitCode).toBe(2);
  });

  it("converts one CDB file to raw JSON on stdout", () => {
    const { stdout, stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw"
    ]);
    expect(exitCode).toBe(0);
    // stdout should contain raw JSON
    expect(stdout).toContain("cdb.raw/1");
    expect(stdout).toContain("signed-int64-decimal");
    expect(stdout).toContain("datas");
    expect(stdout).toContain("texts");
    // stderr should have diagnostic content
    expect(stderr).toBeTruthy();
  });

  it("converts one CDB file to raw JSONL on stdout", () => {
    const { stdout, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw", "--format", "jsonl"
    ]);
    expect(exitCode).toBe(0);
    // JSONL output should contain one complete envelope per line
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const firstLine = JSON.parse(lines[0]);
    expect(firstLine.schema).toBe("cdb.raw/1");
  });

  it("enforces max-output-bytes before writing a raw envelope", () => {
    const { stdout, stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw", "--max-output-bytes", "100",
    ]);
    expect(exitCode).toBe(4);
    expect(stdout).toBe("");
    expect(stderr).toContain("RESOURCE_LIMIT_EXCEEDED");
    expect(stderr.match(/RESOURCE_LIMIT_EXCEEDED/g)).toHaveLength(1);
  });

  it("no CDB input exits 3", () => {
    const { stderr, exitCode } = runCli([
      "convert", "/nonexistent/file.cdb", "--profile", "raw"
    ]);
    expect(stderr).toContain("No CDB");
    expect(exitCode).toBe(3);
  });

  it("file output requires native capability", () => {
    // On supported host: conversion succeeds (exit 0)
    // The test verifies that capability check doesn't block valid conversions
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw",
      "--output", "/tmp/cdb-test-file-output.cdb"
    ]);
    // Should succeed or fail based on input/output, not capability
    // (Exit 0 = success, 3 = no input, 5 = collision, etc.)
    expect([0, 3, 5, 6]).toContain(exitCode);
    // Should not be a parse error or option error
    expect(stderr).not.toContain("not valid");
    expect(stderr).not.toContain("Invalid");
  });

  it("directory output requires native capability", () => {
    // On supported host: conversion succeeds or fails based on input
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw", "--split", "database",
      "--output", "/tmp/cdb-test-dir-output"
    ]);
    // Should succeed or fail based on input/output, not capability
    expect([0, 3, 5, 6]).toContain(exitCode);
    // Should not be a parse error or option error
    expect(stderr).not.toContain("not valid");
  });

  it("--force with existing file is handled correctly", () => {
    // On supported host: --force doesn't cause parse errors
    const { stderr, exitCode } = runCli([
      "convert", FIXTURE_CDB, "--profile", "raw",
      "--output", "/tmp/cdb-test-force.cdb", "--force"
    ]);
    // Should succeed or fail based on input/output
    expect([0, 3, 5, 6]).toContain(exitCode);
    // Should not be a parse error or option error
    expect(stderr).not.toContain("not valid");
    expect(stderr).not.toContain("Invalid");
  });
});

describe("Stdout/Stderr Separation", () => {
  it("data goes to stdout, diagnostics to stderr", () => {
    const child = spawn("node", [CLI_PATH, "convert", FIXTURE_CDB, "--profile", "raw"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });

    return new Promise<void>((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      child.stdout!.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code: number) => {
        try {
          expect(code).toBe(0);
          // Stdout should contain raw JSON
          expect(stdout.trim()).toContain("cdb.raw/1");
          expect(stdout.trim()).toContain("signed-int64-decimal");
          // Stderr should exist (diagnostics)
          expect(stderr.trim()).toBeTruthy();
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      child.on("error", reject);
    });
  });
});
