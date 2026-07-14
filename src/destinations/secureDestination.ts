/**
 * Secure destination capability manifest and adapter interface.
 *
 * Phase 2 contract: defines the typed native capability boundary.
 * The adapter uses openat2 with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS
 * and descriptor-relative operations.
 *
 * The modern native adapter is defined in nativeAdapter.ts.
 * This module provides the legacy probe interface for compatibility.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { probeNativeCapability as probeNativeCapabilityFromAdapter, toLegacyManifest } from "./nativeAdapter.js";

/**
 * Supported filesystem primitives for secure destination operations.
 */
export interface SecureDestinationCapabilityManifest {
  platform: string;
  arch: string;
  nodeAbi: string;
  secureDestination: boolean;
  supportedPrimitives: string[];
  requiredFlags: string[];
  moduleSha256?: string;
  /** Whether identity-guarded replace is supported */
  identityGuardedReplace?: false;
}

/**
 * Capability probe result.
 */
export interface CapabilityProbeResult {
  supported: boolean;
  manifest: SecureDestinationCapabilityManifest;
  error?: string;
}

/**
 * Get the dirname of a module.
 */
function getModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Probe the system for secure destination capability.
 *
 * This function first checks the build-time manifest, then attempts
 * to probe the native module. It returns the capability result.
 *
 * The supported result requires:
 * 1. Linux x64 or arm64 platform
 * 2. Node 22+ with N-API support
 * 3. openat2 syscall available (kernel 5.6+)
 * 4. Native module that passes all primitive probes
 * 5. Module hash verification between build-time and runtime
 *
 * When supported, the manifest includes:
 * - identityGuardedReplace: false (this package does not support force replace)
 * - supportedPrimitives: the verified primitives
 * - requiredFlags: RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS
 */
export async function probeNativeCapabilityAsync(): Promise<CapabilityProbeResult> {
  const platform = process.platform;
  const arch = process.arch;

  if (platform !== "linux" || (arch !== "x64" && arch !== "arm64")) {
    return {
      supported: false,
      manifest: {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supportedPrimitives: [],
        requiredFlags: [],
        identityGuardedReplace: false,
      },
      error: `Secure destination is only supported on Linux (x64 or arm64), got ${platform} ${arch}`,
    };
  }

  // Check if native module exists
  const moduleDir = getModuleDir();
  const nativeModulePath = join(moduleDir, "..", "native", "secure_destination.node");
  if (!existsSync(nativeModulePath)) {
    return {
      supported: false,
      manifest: {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supportedPrimitives: ["openat", "openat2", "renameat2"],  // linkat absent per INV-006
        requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
        identityGuardedReplace: false,
      },
      error: "Native secure-destination module not built. Run 'npm run build:native' first.",
    };
  }

  // Probe the native module
  const probe = await probeNativeCapabilityFromAdapter();

  if (!probe.supported) {
    return {
      supported: false,
      manifest: {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supportedPrimitives: [...(probe.manifest?.supportedPrimitives ?? ["openat", "openat2", "renameat2"])],  // linkat absent per INV-006
        requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
        identityGuardedReplace: false,
      },
      error: probe.error ?? "Native secure-destination module failed capability probe",
    };
  }

  // Convert to legacy manifest format
  const legacyManifest = toLegacyManifest(probe.manifest!);

  return {
    supported: true,
    manifest: {
      ...legacyManifest,
      identityGuardedReplace: false,
    },
  };
}

/**
 * Synchronous probe for use in CLI initialization.
 * Returns the best-effort result based on build-time manifest.
 */
export function probeNativeCapability(): CapabilityProbeResult {
  const platform = process.platform;
  const arch = process.arch;

  if (platform !== "linux" || (arch !== "x64" && arch !== "arm64")) {
    return {
      supported: false,
      manifest: {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supportedPrimitives: [],
        requiredFlags: [],
        identityGuardedReplace: false,
      },
      error: `Secure destination is only supported on Linux (x64 or arm64), got ${platform} ${arch}`,
    };
  }

  // Check build-time manifest
  const buildManifest = readBuildTimeManifest();

  if (!buildManifest) {
    return {
      supported: false,
      manifest: {
        platform,
        arch,
        nodeAbi: process.version,
        secureDestination: false,
        supportedPrimitives: ["openat", "openat2", "renameat2"],  // linkat absent per INV-006
        requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
        identityGuardedReplace: false,
      },
      error: "Build-time capability manifest not found. Run 'npm run build:native' first.",
    };
  }

  // Build manifest indicates native support, but runtime module may not be loaded yet
  // Return supported: false to trigger runtime probe in async path
  return {
    supported: false, // Will be re-probed at runtime
    manifest: {
      platform,
      arch,
      nodeAbi: process.version,
      secureDestination: false,
      supportedPrimitives: ["openat", "openat2", "renameat2"],  // linkat absent per INV-006
      requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
      identityGuardedReplace: false,
    },
    error: "Native module requires runtime probe. This is normal before first use.",
  };
}

/**
 * Read the build-time capability manifest from dist/native/capability.json.
 */
function readBuildTimeManifest(): SecureDestinationCapabilityManifest | null {
  try {
    const moduleDir = getModuleDir();
    const manifestPath = join(moduleDir, "..", "..", "dist", "native", "capability.json");
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);
    return {
      platform: manifest.platform,
      arch: manifest.arch,
      nodeAbi: manifest.nodeAbi,
      // Use 'supported' as the canonical key (consistent with nativeAdapter and build-native)
      secureDestination: manifest.supported ?? manifest.secureDestination ?? false,
      supportedPrimitives: manifest.supportedPrimitives ?? [],
      requiredFlags: manifest.requiredFlags ?? [],
      moduleSha256: manifest.moduleSha256,
      identityGuardedReplace: false,
    };
  } catch {
    return null;
  }
}

/**
 * Read the capability manifest from dist/native/capability.json.
 * @deprecated Use probeNativeCapabilityAsync() for accurate runtime results
 */
export function readCapabilityManifest(): CapabilityProbeResult | null {
  const manifest = readBuildTimeManifest();
  if (!manifest) {
    return null;
  }
  return {
    supported: manifest.secureDestination,
    manifest,
  };
}