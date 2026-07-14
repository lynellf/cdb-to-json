#!/usr/bin/env node

/**
 * Package content verification script.
 *
 * Runs `npm pack --dry-run` and verifies that all required artifacts are present.
 * On a supported host, also verifies the native module SHA-256.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const REQUIRED_FILES = [
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

// Check if this is a release host
const isReleaseHost = process.env.CDB_RELEASE_HOST === "1";

/**
 * Returns true when the host meets the declared Linux Node 22+ capability matrix.
 * Accepts every Node major version >= 22 (per package engine Node >=22.0.0).
 */
function getIsSupported() {
  if (process.platform !== "linux") return false;
  if (process.arch !== "x64" && process.arch !== "arm64") return false;
  const match = process.version.match(/^v(\d+)/);
  if (!match) return false;
  return parseInt(match[1], 10) >= 22;
}

const isSupported = getIsSupported();

let failed = false;

// Check each required file
for (const file of REQUIRED_FILES) {
  if (!existsSync(file)) {
    console.error(`[FAIL] Missing required file: ${file}`);
    failed = true;
  } else {
    console.log(`[OK] ${file} (${statSync(file).size} bytes)`);
  }
}

// Check optional files
const optionalFiles = ["dist/native/secure_destination.node"];
for (const file of optionalFiles) {
  if (existsSync(file)) {
    console.log(`[OK] ${file} (${statSync(file).size} bytes)`);
  } else {
    console.log(`[INFO] Optional file not present: ${file}`);
  }
}

// Check capability manifest
const manifestPath = "dist/native/capability.json";
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    // Use the canonical "supported" key consistently (same as build-native.mjs)
    const isManifestSupported = !!manifest.supported;
    if (isManifestSupported) {
      // Supported host: verify native module
      const modulePath = "dist/native/secure_destination.node";
      if (!existsSync(modulePath)) {
        console.error("[FAIL] Capability reports supported but native module is missing");
        failed = true;
      } else if (manifest.moduleSha256) {
        const moduleContent = readFileSync(modulePath);
        const actualHash = createHash("sha256").update(moduleContent).digest("hex");
        if (actualHash !== manifest.moduleSha256) {
          console.error(`[FAIL] Native module SHA-256 mismatch: expected ${manifest.moduleSha256}, got ${actualHash}`);
          failed = true;
        } else {
          console.log("[OK] Native module SHA-256 verified");
        }
      }
    } else {
      // Unsupported host: verify no stale module
      const modulePath = "dist/native/secure_destination.node";
      if (existsSync(modulePath)) {
        console.error("[FAIL] Unsupported host but native module exists");
        failed = true;
      }
    }

    console.log(`[OK] Capability manifest: ${JSON.stringify(manifest)}`);
  } catch (error) {
    console.error(`[FAIL] Invalid capability manifest: ${error.message}`);
    failed = true;
  }
}

// Check npm pack --dry-run
try {
  const output = execSync("npm pack --dry-run 2>&1", { encoding: "utf-8" });
  console.log("\n--- npm pack --dry-run output ---");
  for (const line of output.split("\n").filter((l) => l.trim())) {
    console.log(`  ${line}`);
  }
} catch (error) {
  console.error(`[FAIL] npm pack --dry-run failed: ${error.message}`);
  failed = true;
}

// On release host, require native module
if (isReleaseHost && isSupported) {
  if (!existsSync("dist/native/secure_destination.node")) {
    console.error("[FAIL] Release host: native module is required but missing");
    failed = true;
  }
}

if (failed) {
  console.error("\n[FAIL] Package check failed");
  process.exit(1);
} else {
  console.log("\n[OK] Package check passed");
}