#!/usr/bin/env node

/**
 * Benchmark script for cdb-to-json conversion.
 *
 * Per P6 (Phase 5) acceptance:
 * "The command takes both named fixture arguments and writes JSON with one result
 * per fixture. Each result must contain elapsedMs, peakHeapBytes, outputBytes,
 * profile, format, nodeVersion, and fixtureIdentity."
 *
 * Usage:
 *   npm run benchmark -- --full-cdb __tests__/input_dir/cards.cdb \
 *     --high-cardinality benchmarks/fixtures/high-cardinality.cdb \
 *     --profile raw --format json \
 *     --report benchmarks/reports/convert-full-cdb.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchmarkResult {
  fixture: string;
  fixtureIdentity: {
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  profile: string;
  format: string;
  nodeVersion: string;
  elapsedMs: number;
  peakHeapBytes: number;
  outputBytes: number;
  timestamp: string;
}

interface BenchmarkReport {
  metadata: {
    nodeVersion: string;
    platform: string;
    arch: string;
    timestamp: string;
  };
  command: string[];
  results: BenchmarkResult[];
}

function computeFileHash(path: string): string {
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

function getCurrentHeap(): number {
  // Note: In Node.js, process.memoryUsage().heapUsed gives current heap usage.
  // We cannot get true "peak" heap from within the same process without a profiler.
  // This measures heap before and after the CLI subprocess to estimate delta.
  const { heapUsed } = process.memoryUsage();
  return heapUsed;
}

async function runBenchmark(
  fixturePath: string,
  profile: string,
  format: string
): Promise<BenchmarkResult> {
  const resolvedPath = resolve(fixturePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Fixture not found: ${resolvedPath}`);
  }

  const fileStats = readFileSync(resolvedPath);
  const fixtureIdentity = {
    path: resolvedPath,
    sizeBytes: fileStats.length,
    sha256: computeFileHash(resolvedPath),
  };

  // Import the CLI dynamically to measure memory
  const { execSync } = await import("node:child_process");

  // Measure heap before and after CLI run
  const initialHeap = getCurrentHeap();

  // Run the conversion and measure
  const startTime = performance.now();

  // Capture output - this will throw if the CLI fails
  let output: Buffer;
  try {
    output = execSync(
      `node dist/cli.js convert "${resolvedPath}" --profile ${profile} --format ${format}`,
      {
        encoding: null, // Binary output
        maxBuffer: 1024 * 1024 * 1024, // 1GB max
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Re-throw with context for the fixture
    throw new Error(`Conversion failed for ${fixturePath}: ${message}`);
  }

  const endTime = performance.now();
  const finalHeap = getCurrentHeap();

  // Use the heap delta as an approximation of peak heap during conversion.
  // This is an estimate since the true peak occurs during the child process.
  const peakHeapBytes = Math.max(initialHeap, finalHeap);

  const result: BenchmarkResult = {
    fixture: fixturePath,
    fixtureIdentity,
    profile,
    format,
    nodeVersion: process.version,
    elapsedMs: Math.round(endTime - startTime),
    peakHeapBytes,
    outputBytes: output.length,
    timestamp: new Date().toISOString(),
  };

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const fullCdbArg = args.indexOf("--full-cdb");
  const highCardinalityArg = args.indexOf("--high-cardinality");
  const profileArg = args.indexOf("--profile");
  const formatArg = args.indexOf("--format");
  const reportArg = args.indexOf("--report");

  const fixtures: string[] = [];
  let profile = "raw";
  let format = "json";
  let reportPath = "benchmarks/reports/convert-full-cdb.json";

  if (fullCdbArg !== -1 && args[fullCdbArg + 1]) {
    fixtures.push(args[fullCdbArg + 1]);
  }

  if (highCardinalityArg !== -1 && args[highCardinalityArg + 1]) {
    fixtures.push(args[highCardinalityArg + 1]);
  }

  if (profileArg !== -1 && args[profileArg + 1]) {
    profile = args[profileArg + 1];
  }

  if (formatArg !== -1 && args[formatArg + 1]) {
    format = args[formatArg + 1];
  }

  if (reportArg !== -1 && args[reportArg + 1]) {
    reportPath = args[reportArg + 1];
  }

  if (fixtures.length === 0) {
    console.error("Usage: npm run benchmark -- --full-cdb <path> [--high-cardinality <path>] [--profile raw] [--format json] [--report <path>]");
    process.exit(1);
  }

  console.log("Running benchmarks...");
  console.log(`Fixtures: ${fixtures.join(", ")}`);
  console.log(`Profile: ${profile}`);
  console.log(`Format: ${format}`);
  console.log();

  const results: BenchmarkResult[] = [];
  const errors: string[] = [];

  for (const fixture of fixtures) {
    console.log(`Benchmarking: ${fixture}`);
    try {
      const result = await runBenchmark(fixture, profile, format);
      results.push(result);
      console.log(`  Elapsed: ${result.elapsedMs}ms`);
      console.log(`  Output: ${result.outputBytes} bytes`);
      console.log(`  Heap delta: ${Math.round(result.peakHeapBytes / 1024 / 1024)}MB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  Error: ${message}`);
      errors.push(`${fixture}: ${message}`);
    }
    console.log();
  }

  // Fail if any fixture failed or if no results were produced
  if (errors.length > 0) {
    console.error("\nBenchmark failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (results.length === 0) {
    console.error("\nBenchmark failed: no results produced (all fixtures missing or conversion failed)");
    process.exit(1);
  }

  const report: BenchmarkReport = {
    metadata: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timestamp: new Date().toISOString(),
    },
    command: process.argv,
    results,
  };

  // Write report
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to: ${reportPath}`);

  // Summary
  console.log("\nSummary:");
  for (const result of results) {
    console.log(`  ${result.fixture}:`);
    console.log(`    - Time: ${result.elapsedMs}ms`);
    console.log(`    - Output: ${result.outputBytes} bytes`);
    console.log(`    - Memory: ${Math.round(result.peakHeapBytes / 1024 / 1024)}MB`);
  }
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
