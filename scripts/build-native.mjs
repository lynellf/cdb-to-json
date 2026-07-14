#!/usr/bin/env node

/**
 * Build and attest the native secure-destination boundary.
 *
 * The exported runNativeBuild function is deliberately import-safe. It takes
 * the repository root, host metadata, build step, and capability probe as
 * explicit inputs so cleanup and post-copy probe outcomes can be tested
 * without depending on the current machine or a compiler.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_NAME = "secure_destination.node";
const ZERO_HASH = "0".repeat(64);
const REQUIRED_PRIMITIVES = ["openat", "openat2", "renameat2"];
const REQUIRED_FLAGS = ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"];

/** @typedef {{ platform: string, arch: string, nodeVersion: string, nodeAbi: string, napiVersion: number }} NativeBuildHost */
/** @typedef {{ supported: boolean, supportsOpenAt2: boolean, supportsRenameAt2: boolean, supportsNoReplace: boolean, supportedPrimitives: string[] }} PrimitiveProbe */
/** @typedef {{ supported: boolean, supportedPrimitives: string[], requiredFlags: string[], primitiveProbeResults: PrimitiveProbe }} NativeProbe */
/** @typedef {{ rootDir: string, sourceDir: string, modulePath: string }} NativeBuildContext */
/** @typedef {{ supported: boolean, failed: boolean, modulePath: string, manifestPath: string, error?: string }} NativeBuildResult */

function getHostFromProcess() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    nodeAbi: process.versions.modules ?? "unknown",
    napiVersion: Number(process.versions.napi ?? 0),
  };
}

function getPaths(rootDir) {
  const sourceDir = join(rootDir, "native", "secure-destination");
  const nativeDist = join(rootDir, "dist", "native");
  return {
    sourceDir,
    nativeDist,
    modulePath: join(nativeDist, MODULE_NAME),
    manifestPath: join(nativeDist, "capability.json"),
  };
}

function removeModule(modulePath) {
  rmSync(modulePath, { force: true });
}

function moduleSha256(modulePath) {
  return createHash("sha256").update(readFileSync(modulePath)).digest("hex");
}

function unsupportedManifest(host) {
  return {
    platform: host.platform,
    arch: host.arch,
    nodeAbi: host.nodeAbi,
    napiVersion: host.napiVersion,
    moduleSha256: ZERO_HASH,
    supported: false,
    supportedPrimitives: [],
    requiredFlags: [],
    primitiveProbeResults: {
      supported: false,
      supportsOpenAt2: false,
      supportsRenameAt2: false,
      supportsNoReplace: false,
      supportedPrimitives: [],
    },
  };
}

function writeManifest(manifestPath, manifest) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isSupportedHost(host) {
  if (host.platform !== "linux") return false;
  if (host.arch !== "x64" && host.arch !== "arm64") return false;
  const match = /^v(\d+)/.exec(host.nodeVersion);
  return match !== null && Number(match[1]) >= 22;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPrimitiveProbe(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.supported === "boolean" &&
    typeof value.supportsOpenAt2 === "boolean" &&
    typeof value.supportsRenameAt2 === "boolean" &&
    typeof value.supportsNoReplace === "boolean" &&
    isStringArray(value.supportedPrimitives)
  );
}

function validateProbe(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.supported !== "boolean" ||
    !isStringArray(value.supportedPrimitives) ||
    !isStringArray(value.requiredFlags) ||
    !isPrimitiveProbe(value.primitiveProbeResults)
  ) {
    return { valid: false, reason: "Capability probe returned a malformed result" };
  }

  const primitiveProbe = value.primitiveProbeResults;
  if (
    value.supported !== primitiveProbe.supported ||
    value.supportedPrimitives.join("\0") !== primitiveProbe.supportedPrimitives.join("\0")
  ) {
    return { valid: false, reason: "Capability probe returned contradictory results" };
  }

  if (value.supported) {
    const hasAllPrimitives = REQUIRED_PRIMITIVES.every((primitive) =>
      value.supportedPrimitives.includes(primitive),
    );
    const hasAllFlags = REQUIRED_FLAGS.every((flag) => value.requiredFlags.includes(flag));
    const probesPass =
      primitiveProbe.supported &&
      primitiveProbe.supportsOpenAt2 &&
      primitiveProbe.supportsRenameAt2 &&
      primitiveProbe.supportsNoReplace;
    if (!hasAllPrimitives || !hasAllFlags || !probesPass) {
      return { valid: false, reason: "Supported capability probe is missing a required primitive" };
    }
  }

  return { valid: true, value };
}

function defaultBuild(context) {
  const buildDir = join(context.sourceDir, "build");
  rmSync(buildDir, { recursive: true, force: true });
  execFileSync("node-gyp", ["rebuild"], {
    cwd: context.sourceDir,
    stdio: "inherit",
  });

  const candidates = [
    join(context.sourceDir, "build", "Release", MODULE_NAME),
    join(context.sourceDir, "build", "Debug", MODULE_NAME),
  ];
  const builtModule = candidates.find((candidate) => existsSync(candidate));
  if (!builtModule) {
    throw new Error("Built native module not found after node-gyp rebuild");
  }

  mkdirSync(dirname(context.modulePath), { recursive: true });
  cpSync(builtModule, context.modulePath);
}

async function defaultProbe(context) {
  const imported = await import(pathToFileURL(context.modulePath).href);
  const native = imported.default ?? imported;
  const result = native.probeCapability();
  return {
    supported: result.supported,
    supportedPrimitives: [...result.supportedPrimitives],
    requiredFlags: result.requiredFlags.map((flag) => {
      if (typeof flag === "string") return flag;
      if (flag === 8) return "RESOLVE_BENEATH";
      if (flag === 4) return "RESOLVE_NO_SYMLINKS";
      return String(flag);
    }),
    primitiveProbeResults: {
      supported: result.supported,
      supportsOpenAt2: result.hasOpenAt2,
      supportsRenameAt2: result.hasRenameAt2,
      supportsNoReplace: result.supportsNoReplace,
      supportedPrimitives: [...result.supportedPrimitives],
    },
  };
}

/**
 * Build, probe, and attest the native module.
 *
 * @param {string} rootDir
 * @param {NativeBuildHost} host
 * @param {(context: NativeBuildContext) => void | Promise<void>} build
 * @param {(context: NativeBuildContext) => NativeProbe | Promise<NativeProbe>} probe
 * @returns {Promise<NativeBuildResult>}
 */
export async function runNativeBuild(rootDir, host, build, probe) {
  const paths = getPaths(rootDir);
  const context = {
    rootDir,
    sourceDir: paths.sourceDir,
    modulePath: paths.modulePath,
  };
  mkdirSync(paths.nativeDist, { recursive: true });

  const reject = (error, failed = false) => {
    removeModule(paths.modulePath);
    writeManifest(paths.manifestPath, unsupportedManifest(host));
    return {
      supported: false,
      failed,
      modulePath: paths.modulePath,
      manifestPath: paths.manifestPath,
      ...(error ? { error } : {}),
    };
  };

  if (!isSupportedHost(host)) {
    return reject(`Unsupported host: ${host.platform} ${host.arch} ${host.nodeVersion}`);
  }

  if (!existsSync(join(paths.sourceDir, "binding.gyp"))) {
    return reject("Native module source not found");
  }

  try {
    await build(context);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error), true);
  }

  if (!existsSync(paths.modulePath)) {
    return reject("Build step did not produce the packaged native module", true);
  }

  let probeResult;
  try {
    probeResult = validateProbe(await probe(context));
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error), true);
  }

  if (!probeResult.valid) {
    return reject(probeResult.reason, true);
  }

  if (!probeResult.value.supported) {
    // The module was copied before the probe. It is not packageable unless the
    // complete capability contract passes, so cleanup is mandatory here.
    return reject("Native module failed the capability probe");
  }

  const hash = moduleSha256(paths.modulePath);
  writeManifest(paths.manifestPath, {
    platform: host.platform,
    arch: host.arch,
    nodeAbi: host.nodeAbi,
    napiVersion: host.napiVersion,
    moduleSha256: hash,
    supported: true,
    supportedPrimitives: [...probeResult.value.supportedPrimitives],
    requiredFlags: [...probeResult.value.requiredFlags],
    primitiveProbeResults: { ...probeResult.value.primitiveProbeResults },
  });

  return {
    supported: true,
    failed: false,
    modulePath: paths.modulePath,
    manifestPath: paths.manifestPath,
  };
}

async function runFromCommandLine() {
  const rootDir = process.cwd();
  const result = await runNativeBuild(
    rootDir,
    getHostFromProcess(),
    defaultBuild,
    defaultProbe,
  );

  if (result.failed) {
    console.error(`[build-native] ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (!result.supported) {
    console.error(`[build-native] ${result.error ?? "Native secure-destination is unavailable"}`);
    return;
  }

  console.error(
    `[build-native] Native module built and installed (sha256: ${moduleSha256(result.modulePath).slice(0, 16)}...)`,
  );
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  await runFromCommandLine();
}
