#!/usr/bin/env node

/**
 * Build the native secure-destination N-API module.
 * On supported Linux: rebuild with node-gyp, verify, and copy to dist/native/.
 * On unsupported hosts: remove any stale module, write unsupported manifest.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { platform, arch } from "node:process";
import { join } from "node:path";

const MODULE_SRC = "native/secure-destination";
const MODULE_DIST = "dist/native";
const MODULE_NAME = "secure_destination.node";

const isSupported =
  platform === "linux" &&
  (arch === "x64" || arch === "arm64") &&
  process.version.startsWith("v22");

function computeSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

// Ensure dist/native exists
if (!existsSync(MODULE_DIST)) {
  mkdirSync(MODULE_DIST, { recursive: true });
}

if (!isSupported) {
  // Remove any stale module
  const staleModule = `${MODULE_DIST}/${MODULE_NAME}`;
  if (existsSync(staleModule)) {
    rmSync(staleModule);
  }

  // Write unsupported capability manifest
  writeFileSync(
    `${MODULE_DIST}/capability.json`,
    JSON.stringify(
      {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supported: false,
        message: "Native secure-destination module is only available on Linux Node 22+",
      },
      null,
      2
    ) + "\n"
  );

  console.error(`[build-native] Unsupported host: ${platform} ${arch} ${process.version}. Writing unsupported manifest.`);
  process.exit(0);
}

// Supported host - attempt native build
const cwd = process.cwd();
const sourceDir = join(cwd, MODULE_SRC);
const bindingGyp = join(sourceDir, "binding.gyp");

if (!existsSync(bindingGyp)) {
  // No native source yet, write unsupported manifest
  writeFileSync(
    `${MODULE_DIST}/capability.json`,
    JSON.stringify(
      {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supported: false,
        message: "Native module source not yet implemented",
      },
      null,
      2
    ) + "\n"
  );
  console.error("[build-native] Native module source not found. Writing unsupported manifest.");
  process.exit(0);
}

// Clean any previous build artifacts
const buildDir = join(sourceDir, "build");
if (existsSync(buildDir)) {
  rmSync(buildDir, { recursive: true, force: true });
}

// Build with node-gyp
try {
  console.error(`[build-native] Building native module for ${platform} ${arch} ${process.version}...`);
  execSync("node-gyp rebuild", {
    cwd: sourceDir,
    stdio: "inherit",
  });
} catch (error) {
  writeFileSync(
    `${MODULE_DIST}/capability.json`,
    JSON.stringify(
      {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supported: false,
        message: `Native module build failed: ${error.message}`,
      },
      null,
      2
    ) + "\n"
  );
  console.error(`[build-native] Build failed: ${error.message}`);
  process.exit(1);
}

// Find the built .node file
const libBindingDir = join(sourceDir, "build", "Release");
let builtNodePath = join(libBindingDir, MODULE_NAME);

if (!existsSync(builtNodePath)) {
  // Try other possible locations
  const possiblePaths = [
    join(libBindingDir, "secure_destination.node"),
    join(sourceDir, "build", "Debug", MODULE_NAME),
    join(sourceDir, "build", "Debug", "secure_destination.node"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      builtNodePath = p;
      break;
    }
  }
}

if (!existsSync(builtNodePath)) {
  writeFileSync(
    `${MODULE_DIST}/capability.json`,
    JSON.stringify(
      {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supported: false,
        message: "Built native module not found after node-gyp rebuild",
      },
      null,
      2
    ) + "\n"
  );
  console.error("[build-native] Built module not found after rebuild.");
  process.exit(1);
}

// Copy to dist/native/
const destNodePath = join(MODULE_DIST, MODULE_NAME);
cpSync(builtNodePath, destNodePath);

// Verify the module
const moduleHash = computeSha256(destNodePath);

// Write capability manifest
writeFileSync(
  `${MODULE_DIST}/capability.json`,
  JSON.stringify(
    {
      platform,
      arch,
      nodeAbi: process.version,
      secureDestination: true,
      supported: true,
      supportedPrimitives: ["openat2", "openat", "linkat", "renameat2"],
      requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
      moduleSha256: moduleHash,
    },
    null,
    2
  ) + "\n"
);

console.error(`[build-native] Native module built and installed (sha256: ${moduleHash.substring(0, 16)}...)`);
