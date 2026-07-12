/**
 * Secure destination capability manifest and adapter interface.
 *
 * Phase 0-1 contract: defines the typed native capability boundary.
 * The adapter uses openat2 with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS
 * and descriptor-relative operations. Full implementation is Phase 2.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

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
 * Secure destination adapter interface.
 */
export interface SecureDestinationAdapter {
  /** Acquire a trusted root directory descriptor */
  acquireRoot(rootPath: string): Promise<number>;
  /** Release a root descriptor */
  releaseRoot(fd: number): void;
  /** Create a reservation lock */
  createReservation(rootFd: number, path: string): Promise<boolean>;
  /** Create a temporary sibling file */
  createTemp(rootFd: number, path: string): Promise<string>;
  /** Atomically publish (no-clobber) */
  publishNoClobber(rootFd: number, tempPath: string, finalPath: string): Promise<boolean>;
  /** Force replace */
  publishForce(rootFd: number, tempPath: string, finalPath: string): Promise<void>;
  /** Cleanup */
  cleanup(rootFd: number, path: string): Promise<void>;
}

/**
 * Get the dirname of a module.
 */
function getModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Probe the system for secure destination capability.
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
      },
      error: `Secure destination is only supported on Linux (x64 or arm64), got ${platform} ${arch}`,
    };
  }

  return {
    supported: false,
    manifest: {
      platform,
      arch,
      nodeAbi: process.version,
      secureDestination: false,
      supportedPrimitives: ["openat2", "openat", "linkat", "renameat2"],
      requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
    },
    error: "Native secure destination module not yet implemented",
  };
}

/**
 * Read the capability manifest from dist/native/capability.json.
 */
export function readCapabilityManifest(): CapabilityProbeResult | null {
  try {
    const moduleDir = getModuleDir();
    const manifestPath = join(moduleDir, "..", "..", "dist", "native", "capability.json");
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);
    return {
      supported: manifest.secureDestination === true,
      manifest,
    };
  } catch {
    return null;
  }
}