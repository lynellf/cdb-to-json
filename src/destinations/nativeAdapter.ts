/**
 * Native secure destination adapter.
 *
 * This module is the ONLY loader and caller of the native secure-destination
 * module. It provides a handle-based interface where native-owned handles are
 * opaque to TypeScript and never forgeable as raw integers.
 *
 * All operations after initial acquisition are descriptor-relative.
 * The minimum handle operations are defined by the adversarial publication
 * amendment (B2-1 through B2-5).
 *
 * ## C++ API alignment (P1-F-007 remediation)
 *
 * The TypeScript interface names match the ACTUAL C++ N-API exports in
 * native/secure-destination/src/secure_destination.cc:
 *
 * C++ export              | TS equivalent
 * ------------------------|-----------------------------------------------
 * probeCapability()       | probeCapability() → { supported, hasOpenAt2, ... }
 * acquireTrustedRoot(path)| acquireTrustedRoot(path) → { success, fd, ... }
 * openRelative(fd,path,fl) | openRelative(rootFd, relPath, flags)
 * createTempRelative(fd,p)| createTempRelative(rootFd, prefix)
 * atomicRename(oldD,oldP, | atomicRename(oldDirFd, oldPath, newDirFd, newPath)
 *   newD, newP)
 * lockFile(path, op)      | lockFile(path, operation)
 * unlockFile(path)         | unlockFile(path)
 * closeFd(fd)             | closeFd(fd)
 * RESOLVE_BENEATH value   | RESOLVE_BENEATH / RESOLVE_BENEATH_FLAG()
 * RESOLVE_NO_SYMLINKS val | RESOLVE_NO_SYMLINKS / RESOLVE_NO_SYMLINKS_FLAG()
 * RENAME_NOREPLACE value  | RENAME_NOREPLACE / RENAME_NOREPLACE_FLAG()
 *
 * Higher-level operations (acquireSourceIdentity, publishFile, publishDirectory,
 * acquireLease, etc.) are not yet implemented in the C++ module and are marked
 * as TODO: requires C++ implementation.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

// Re-export handle types
export type { NativeHandle } from "./handles.js";

// =============================================================================
// Handle types (opaque, native-owned)
// =============================================================================

/**
 * Opaque parent handle for descriptor-relative operations.
 * Contains: anchorIdentity, parentIdentity, finalLeaf
 */
export interface ParentHandle {
  readonly _brand: unique symbol;
  readonly anchorIdentity: FileIdentity;
  readonly parentIdentity: FileIdentity;
  readonly finalLeaf: string;
}

/**
 * Opaque source handle for snapshot input.
 * Contains: opened fd, device/inode/type/size, source parent handle + validated main leaf
 */
export interface SourceHandle {
  readonly _brand: unique symbol;
  readonly identity: FileIdentity;
  readonly mainLeaf: string;
}

/**
 * Opaque lease handle for exclusive reservation.
 * Contains: parent, leaf, scope, ownerToken, createdNs
 */
export interface LeaseHandle {
  readonly _brand: unique symbol;
  readonly parent: ParentHandle;
  readonly leaf: string;
  readonly scope: LeaseScope;
  readonly ownerToken: string;
  readonly createdNs: bigint;
}

/**
 * Opaque temp file handle.
 */
export interface TempHandle {
  readonly _brand: unique symbol;
  readonly identity: FileIdentity;
  readonly parent: ParentHandle;
  readonly leaf: string;
}

/**
 * Opaque stage directory handle.
 */
export interface StageHandle {
  readonly _brand: unique symbol;
  readonly identity: FileIdentity;
  readonly parent: ParentHandle;
  readonly stageLeaf: string;
}

/**
 * Opaque stage child file handle.
 */
export interface StageChildHandle {
  readonly _brand: unique symbol;
  readonly identity: FileIdentity;
  readonly leaf: string;
}

/**
 * Stage child file identity (returned after close).
 */
export interface StageChildIdentity {
  device: number;
  inode: number;
  type: "regular";
  size: number;
}

/**
 * Stage verified status.
 */
export interface StageVerified {
  readonly verified: true;
  readonly childCount: number;
}

/**
 * Identity check result.
 */
export interface IdentityCheck {
  readonly sourceMatches: boolean;
  readonly destinationMatches: boolean;
  readonly sourceStillOriginal: boolean;
  readonly destinationStillOriginal: boolean;
}

// =============================================================================
// Supporting types
// =============================================================================

/**
 * File identity for descriptor-relative checks.
 */
export interface FileIdentity {
  device: number;
  inode: number;
  type: "regular" | "directory" | "symlink" | "other";
  size?: number;
}

/**
 * Leaf inspection result.
 */
export type LeafStatus =
  | { kind: "ABSENT" }
  | { kind: "REGULAR"; identity: FileIdentity }
  | { kind: "DIRECTORY"; identity: FileIdentity }
  | { kind: "SYMLINK" }
  | { kind: "OTHER"; identity: FileIdentity };

/**
 * Lease scope.
 */
export type LeaseScope = "file" | "directory";

/**
 * Authorization for lease/temp creation.
 */
export type Authorization =
  | { kind: "ABSENT" }
  | { kind: "EXPECTED_PRESENT"; identity: FileIdentity }
  | { kind: "UNSAFE_FINAL" };

/**
 * Filesystem probe result.
 */
export interface FilesystemProbe {
  readonly supportsOpenAt2: boolean;
  readonly supportsRenameAt2: boolean;
  readonly supportsNoReplace: boolean;
  readonly supportedPrimitives: string[];
}

/**
 * Publish result for atomic operations.
 */
export type PublishResult =
  | { kind: "COMMITTED"; identity: FileIdentity }
  | { kind: "NOT_COMMITTED"; reason: string }
  | { kind: "INDETERMINATE"; reason: string; details?: string };

/**
 * Cleanup result.
 */
export type CleanupResult =
  | { kind: "SUCCESS" }
  | { kind: "PARTIAL"; failures: string[] }
  | { kind: "FAILED"; reason: string };

// =============================================================================
// Capability manifest
// =============================================================================

/**
 * Modern capability manifest format.
 *
 * The primary capability key is "supported" (boolean), consistent with
 * scripts/build-native.mjs and scripts/package-check.mjs.
 */
export interface NativeCapabilityManifest {
  readonly platform: string;
  readonly arch: string;
  readonly nodeAbi: string;
  readonly napiVersion: number;
  readonly moduleSha256: string;
  readonly supported: boolean;
  readonly supportedPrimitives: readonly string[];
  readonly requiredFlags: readonly string[];
  readonly primitiveProbeResults: FilesystemProbe;
}

/**
 * Native capability probe result.
 */
export interface NativeCapabilityProbe {
  readonly supported: boolean;
  readonly manifest: NativeCapabilityManifest | null;
  readonly error?: string;
  readonly buildTimeModuleHash?: string;
  readonly runtimeModuleHash?: string;
}

// =============================================================================
// Native module wrapper interface
//
// Matches the actual C++ N-API exports in secure_destination.cc
// =============================================================================

/**
 * Low-level native module exports.
 *
 * Matches the ACTUAL C++ N-API module exports:
 * - probeCapability() returns { supported, hasOpenAt2, hasRenameAt2, requiredFlags, supportedPrimitives }
 * - acquireTrustedRoot(path) opens a directory fd with openat2
 * - openRelative(rootFd, relPath, flags) opens a path relative to a descriptor
 * - createTempRelative(rootFd, prefix) creates a temp file under a directory
 * - atomicRename(oldDirFd, oldPath, newDirFd, newPath) calls renameat2 with RENAME_NOREPLACE
 * - lockFile / unlockFile / closeFd for fd lifecycle
 * - RESOLVE_BENEATH / RESOLVE_NO_SYMLINKS / RENAME_NOREPLACE as constants or getter functions
 *
 * Higher-level operations (publishFile, acquireSourceIdentity, acquireLease, etc.)
 * are not implemented in the C++ module yet; those TS stubs throw with a clear
 * "requires C++ implementation" message.
 */
interface SecureDestinationNative {
  /**
   * Probe platform for openat2 and RENAME_NOREPLACE capability.
   *
   * The C++ probe now performs a functional RENAME_NOREPLACE test:
   * - hasOpenAt2: syscall availability (safe probe)
   * - hasRenameAt2: syscall availability
   * - supportsNoReplace: functional test of renameat2(..., RENAME_NOREPLACE)
   *   Returns true only when the syscall + flag combination actually works (EEXIST on collision).
   * - supported: hasOpenAt2 AND supportsNoReplace (INV-006 exact no-replace primitive).
   * - linkat is deliberately NOT advertised (no publication primitive uses it).
   */
  probeCapability(): {
    supported: boolean;
    platform: string;
    arch?: string;
    nodeAbi?: string;
    hasOpenAt2: boolean;
    hasRenameAt2: boolean;
    supportsNoReplace: boolean;   // functional RENAME_NOREPLACE probe
    requiredFlags: unknown[];
    supportedPrimitives: string[];  // openat + openat2 + renameat2 (no linkat)
  };

  /** Acquire a trusted root directory fd with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS. */
  acquireTrustedRoot(path: string): {
    success: boolean;
    fd: number;
    errcode: number;
    error_msg: string;
    identity?: {
      device: number;
      inode: number;
      type: string;
      size: number;
    };
  };

  /** Open a path relative to a trusted root descriptor. */
  openRelative(
    rootFd: number,
    relPath: string,
    flags: number,
    mode?: number,
  ): {
    success: boolean;
    fd: number;
    errcode: number;
    error_msg: string;
    identity?: {
      device: number;
      inode: number;
      type: string;
      size: number;
    };
  };

  /** Create one directory component under a held directory descriptor. */
  mkdirRelative(rootFd: number, leaf: string, mode: number): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Remove one file component under a held directory descriptor. */
  unlinkRelative(rootFd: number, leaf: string): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Remove one directory component under a held directory descriptor. */
  rmdirRelative(rootFd: number, leaf: string): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Create a temporary file under a trusted root directory. */
  createTempRelative(
    rootFd: number,
    prefix: string
  ): {
    success: boolean;
    fd: number;
    errcode: number;
    error_msg: string;
  };

  /**
   * Atomic rename with RENAME_NOREPLACE (no-clobber semantics).
   * The C++ implementation passes RENAME_NOREPLACE to renameat2(2).
   */
  atomicRename(
    oldDirFd: number,
    oldPath: string,
    newDirFd: number,
    newPath: string
  ): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /**
   * Atomic rename with explicit flags for force replacement.
   * @param flags - renameat2 flags (0 for replace, RENAME_NOREPLACE for no-clobber)
   */
  atomicRenameWithFlags(
    oldDirFd: number,
    oldPath: string,
    newDirFd: number,
    newPath: string,
    flags: number
  ): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /**
   * Force replace: atomically rename with flags=0 (allows clobbering destination).
   * Used for --force replacement where an existing final must be replaced.
   */
  atomicRenameReplace(
    oldDirFd: number,
    oldPath: string,
    newDirFd: number,
    newPath: string
  ): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Acquire an flock(2) lock on a file by path. */
  lockFile(
    path: string,
    operation: number
  ): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Release an flock(2) lock on a file by path. */
  unlockFile(path: string): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  /** Close a raw file descriptor. */
  closeFd(fd: number): {
    success: boolean;
    errcode: number;
    error_msg: string;
  };

  // ── Constants (plain values) ──────────────────────────────────────────────
  RESOLVE_BENEATH: number;
  RESOLVE_NO_SYMLINKS: number;
  RENAME_NOREPLACE: number;

  // ── Constants (getter functions, preferred over plain values) ─────────────
  RESOLVE_BENEATH_FLAG(): number;
  RESOLVE_NO_SYMLINKS_FLAG(): number;
  RENAME_NOREPLACE_FLAG(): number;
}

/**
 * Result of a descriptor-relative native open.
 *
 * This small low-level seam is also used by sourceHandle.ts. Keeping the
 * native loader here means source acquisition never needs to resolve the
 * addon or fall back to a path-based open itself.
 */
export interface RelativeOpenResult {
  success: boolean;
  fd: number;
  errcode: number;
  error_msg: string;
}

export interface RelativeOperationResult {
  success: boolean;
  errcode: number;
  error_msg: string;
}

// =============================================================================
// Module loading
// =============================================================================

// Cached module reference
let _nativeModule: SecureDestinationNative | null = null;
let _moduleLoadError: string | null = null;
let _moduleLoadAttempted = false;

/**
 * Returns the path to the packaged native module artifact.
 *
 * After `npm run build`, the native addon is copied to dist/native/secure_destination.node
 * by scripts/build-native.mjs.  This path is the single canonical location used by:
 *   - build-native.mjs  (builds the module and copies it to dist/native/)
 *   - package-check.mjs  (verifies the module at that exact path)
 *
 * Previously this resolved to the repo source path (native/secure-destination.node),
 * which does not match the packaged artifact and breaks the supported-host gate.
 */
function getNativeModulePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "dist",
    "native",
    "secure_destination.node"
  );
}

/**
 * Load the native module synchronously (if not already attempted).
 * Uses createRequire() for ESM compatibility — the native .node is a CommonJS N-API addon.
 * Returns null if the module cannot be loaded.
 */
function loadNativeModuleSync(): SecureDestinationNative | null {
  if (_moduleLoadAttempted) {
    return _nativeModule;
  }
  _moduleLoadAttempted = true;

  const modulePath = getNativeModulePath();

  if (!existsSync(modulePath)) {
    _moduleLoadError = `Native module not found at ${modulePath}. Run 'npm run build' first.`;
    _nativeModule = null;
    return null;
  }

  try {
    // createRequire allows this ESM module to require() the native addon.
    // The addon is a CommonJS N-API module; dynamic import() is not reliable
    // across all Node versions for .node files.
    const require_ = createRequire(import.meta.url);
    const native = require_(modulePath);
    _nativeModule = native as unknown as SecureDestinationNative;
    _moduleLoadError = null;
    return _nativeModule;
  } catch (error) {
    _moduleLoadError = error instanceof Error ? error.message : String(error);
    _nativeModule = null;
    return null;
  }
}

/**
 * Open one path component relative to a held directory descriptor.
 *
 * The native implementation applies RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS
 * and returns the real descriptor so callers can hold it through copying and
 * hashing. There is deliberately no path-based fallback.
 */
export function openRelativeDescriptor(
  parentFd: number,
  relativePath: string,
  flags: number,
  mode?: number,
): RelativeOpenResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative source access is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  return mode === undefined
    ? native.openRelative(parentFd, relativePath, flags)
    : native.openRelative(parentFd, relativePath, flags, mode);
}

/** Create one directory component relative to a held descriptor. */
export function mkdirRelativeDescriptor(
  parentFd: number,
  leaf: string,
  mode: number,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative directory creation is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  return native.mkdirRelative(parentFd, leaf, mode);
}

/** Remove one file component relative to a held descriptor. */
export function unlinkRelativeDescriptor(
  parentFd: number,
  leaf: string,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative unlink is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  return native.unlinkRelative(parentFd, leaf);
}

/** Remove one directory component relative to a held descriptor. */
export function rmdirRelativeDescriptor(
  parentFd: number,
  leaf: string,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative directory removal is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  return native.rmdirRelative(parentFd, leaf);
}

/** Atomically rename one held-root child with RENAME_NOREPLACE semantics. */
export function atomicRenameDescriptor(
  oldDirFd: number,
  oldLeaf: string,
  newDirFd: number,
  newLeaf: string,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative rename is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  return native.atomicRename(oldDirFd, oldLeaf, newDirFd, newLeaf);
}

/**
 * Atomically rename with explicit flags.
 * @param flags - renameat2 flags (0 for replace, RENAME_NOREPLACE for no-clobber)
 */
export function atomicRenameWithFlags(
  oldDirFd: number,
  oldLeaf: string,
  newDirFd: number,
  newLeaf: string,
  flags: number,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative rename is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  if (typeof native.atomicRenameWithFlags !== "function") {
    throw new Error("Native module does not support atomicRenameWithFlags");
  }
  return native.atomicRenameWithFlags(oldDirFd, oldLeaf, newDirFd, newLeaf, flags);
}

/**
 * Force replace: atomically rename with flags=0 (allows clobbering destination).
 * Used for --force replacement where an existing final must be replaced.
 */
export function atomicRenameReplace(
  oldDirFd: number,
  oldLeaf: string,
  newDirFd: number,
  newLeaf: string,
): RelativeOperationResult {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Native descriptor-relative rename is unavailable: ${_moduleLoadError ?? "module not loaded"}`,
    );
  }
  if (typeof native.atomicRenameReplace !== "function") {
    throw new Error("Native module does not support atomicRenameReplace");
  }
  return native.atomicRenameReplace(oldDirFd, oldLeaf, newDirFd, newLeaf);
}

/**
 * Compute SHA-256 hash of a file.
 */
function computeModuleHashSync(modulePath: string): string {
  try {
    const content = readFileSync(modulePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "0000000000000000000000000000000000000000000000000000000000000000";
  }
}

/**
 * Get the capability manifest from dist/native/capability.json.
 */
function readBuildTimeManifest(): NativeCapabilityManifest | null {
  try {
    const manifestPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "dist",
      "native",
      "capability.json"
    );
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as NativeCapabilityManifest;
  } catch {
    return null;
  }
}

// =============================================================================
// Capability probing
// =============================================================================

/**
 * Probe native capability and return the capability manifest.
 * This is the primary entry point for checking native support.
 */
export async function probeNativeCapability(): Promise<NativeCapabilityProbe> {
  // Read build-time manifest
  const buildManifest = readBuildTimeManifest();

  // Try to load the native module (sync version)
  const native = loadNativeModuleSync();

  if (!native) {
    return {
      supported: false,
      manifest: null,
      error: _moduleLoadError ?? "Native secure-destination module could not be loaded",
    };
  }

  // Run capability probe — the C++ module now exports the supported field
  const probe = native.probeCapability();

  if (!probe.supported || !probe.hasOpenAt2 || !probe.supportsNoReplace) {
    return {
      supported: false,
      manifest: null,
      error: "Platform does not support required primitives (openat2, RENAME_NOREPLACE)",
    };
  }

  // Compute runtime module hash
  const modulePath = getNativeModulePath();
  const runtimeHash = existsSync(modulePath) ? computeModuleHashSync(modulePath) : undefined;

  // Build manifest from probe results
  const manifest: NativeCapabilityManifest = {
    platform: probe.platform,
    arch: probe.arch ?? process.arch,
    nodeAbi: probe.nodeAbi ?? process.version,
    napiVersion: buildManifest?.napiVersion ?? 0,
    moduleSha256: buildManifest?.moduleSha256 ?? runtimeHash ?? "unknown",
    supported: true,
    supportedPrimitives: [...probe.supportedPrimitives],
    requiredFlags: ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"],
    primitiveProbeResults: {
      supportsOpenAt2: probe.hasOpenAt2,
      supportsRenameAt2: probe.hasRenameAt2,
      // Use the functional probe result directly (not a constant check).
      // The C++ probeCapability() already performed the actual no-replace test.
      supportsNoReplace: probe.supportsNoReplace,
      supportedPrimitives: [...probe.supportedPrimitives],
    },
  };

  // Verify build-time and runtime hashes match
  if (buildManifest?.moduleSha256 && runtimeHash && buildManifest.moduleSha256 !== runtimeHash) {
    return {
      supported: false,
      manifest: null,
      error: "Native module hash mismatch (stale build?)",
    };
  }

  return {
    supported: true,
    manifest,
  };
}

/**
 * Run filesystem-specific capability probe.
 * This exercises the primitives and verifies constants.
 */
export async function probeFilesystemCapability(
  _parentPath: string
): Promise<FilesystemProbe | null> {
  const native = loadNativeModuleSync();
  if (!native) {
    return null;
  }

  // Prefer the getter functions for the constants; fall back to plain values.
  const resolveBeneath =
    native.RESOLVE_BENEATH_FLAG?.() ?? native.RESOLVE_BENEATH;
  const resolveNoSymlinks =
    native.RESOLVE_NO_SYMLINKS_FLAG?.() ?? native.RESOLVE_NO_SYMLINKS;
  const renameNoReplace =
    native.RENAME_NOREPLACE_FLAG?.() ?? native.RENAME_NOREPLACE;

  // If any required constant is 0 (undefined), the module was not built correctly.
  if (resolveBeneath === 0 || resolveNoSymlinks === 0 || renameNoReplace === 0) {
    return null;
  }

  // Build supportedPrimitives based on actual probed constants.
  // Only include primitives whose constants are non-zero (were resolved from the native module).
  const probedPrimitives: string[] = ["openat"]; // openat is always available on Linux
  if (resolveBeneath !== 0) probedPrimitives.push("openat2");
  if (renameNoReplace !== 0) probedPrimitives.push("renameat2");
  // linkat is not verified in this probe function; rely on the C++ probeCapability for it

  return {
    supportsOpenAt2: resolveBeneath !== 0,
    supportsRenameAt2: renameNoReplace !== 0,
    supportsNoReplace: renameNoReplace !== 0,
    supportedPrimitives: probedPrimitives,
  };
}

// =============================================================================
// Handle operations
// =============================================================================

/**
 * Acquire a trusted parent directory handle.
 * Validates path shape, opens with openat2/RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS.
 *
 * Note: The underlying C++ call is acquireTrustedRoot(path), which already
 * applies the resolve flags internally.  This TS wrapper provides the
 * ParentHandle abstraction.
 */
export async function acquireTrustedParent(
  path: string,
  _createMissingParents: boolean = false
): Promise<ParentHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error(
      `Cannot acquire trusted parent: ${_moduleLoadError ?? "native module not loaded"}`
    );
  }

  // Validate path
  if (!path || path.includes("\0")) {
    throw new Error("Invalid path: empty or contains NUL");
  }

  // For now, createMissingParents is not supported
  if (_createMissingParents) {
    throw new Error("createMissingParents=false is required");
  }

  // acquireTrustedRoot takes a path string and returns an fd opened with
  // RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS baked in by the C++ implementation.
  const result = native.acquireTrustedRoot(path);

  if (!result.success) {
    throw new Error(
      `Failed to acquire trusted parent: ${result.error_msg} (${result.errcode})`
    );
  }

  const identity: FileIdentity = {
    device: result.identity?.device ?? 0,
    inode: result.identity?.inode ?? 0,
    type: (result.identity?.type ?? "directory") as FileIdentity["type"],
    size: result.identity?.size,
  };

  return {
    _brand: Symbol("ParentHandle"),
    anchorIdentity: identity,
    parentIdentity: identity,
    finalLeaf: "", // Empty for root
  } as ParentHandle;
}

/**
 * Inspect a leaf entry without following symlinks.
 *
 * Note: This uses openRelative from the C++ module.
 * TODO: Full implementation requires C++ support for inspectLeaf semantics.
 */
export async function inspectLeaf(
  _parent: ParentHandle,
  _leafName: string
): Promise<LeafStatus> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }

  // Validate leaf name
  if (
    !_leafName ||
    _leafName.includes("\0") ||
    _leafName.includes("/") ||
    _leafName.includes("\\") ||
    _leafName === "." ||
    _leafName === ".."
  ) {
    return { kind: "ABSENT" };
  }

  // TODO: Full implementation requires C++ fd-based inspectLeaf with
  // descriptor-relative openRelative call.
  throw new Error(
    "inspectLeaf requires C++ implementation of descriptor-relative fd tracking"
  );
}

/**
 * Open a source file and return a source handle.
 * Default is no-follow (rejects source symlinks).
 *
 * Note: The C++ module provides acquireTrustedRoot and openRelative, but
 * the combined acquireSourceIdentity semantics require additional C++ work.
 * TODO: Full implementation requires C++ implementation.
 */
export async function openSourceIdentity(
  path: string,
  followSymlinks: boolean = false
): Promise<SourceHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }

  // Parse path into parent and leaf
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parentPath = lastSlash >= 0 ? path.slice(0, lastSlash) : ".";
  const leafName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  // Follow symlinks is not yet supported at the C++ level
  if (followSymlinks) {
    throw new Error(
      "followSymlinks=true requires C++ implementation of descriptor-relative openRelative with follow-symlink flag"
    );
  }

  // Acquire trusted parent (descriptor)
  const parentResult = native.acquireTrustedRoot(parentPath);
  if (!parentResult.success) {
    throw new Error(
      `Failed to acquire source parent: ${parentResult.error_msg}`
    );
  }
  const parentFd = parentResult.fd;

  try {
    // TODO: Full implementation requires C++ openRelative with identity tracking.
    // The C++ openRelative requires a flags argument; RESOLVE_NO_SYMLINKS rejects
    // symlinks at the leaf level, but a full no-follow source open requires
    // additional logic at the C++ level.
    const openFlags = 0; // O_RDONLY
    const openResult = native.openRelative(parentFd, leafName, openFlags);

    if (!openResult.success) {
      throw new Error(
        `Failed to open source: ${openResult.error_msg} (${openResult.errcode})`
      );
    }

    // Close the source fd immediately — we only needed it to verify the source.
    native.closeFd(openResult.fd);

    return {
      _brand: Symbol("SourceHandle"),
      identity: {
        device: openResult.identity?.device ?? 0,
        inode: openResult.identity?.inode ?? 0,
        type: (openResult.identity?.type ?? "regular") as FileIdentity["type"],
        size: openResult.identity?.size,
      },
      mainLeaf: leafName,
    } as SourceHandle;
  } finally {
    // Close parent fd
    native.closeFd(parentFd);
  }
}

/**
 * Acquire an exclusive lease on a destination.
 *
 * TODO: Requires C++ implementation of descriptor-relative lease tracking.
 */
export async function acquireLease(
  _parent: ParentHandle,
  _leafName: string,
  _scope: LeaseScope,
  authorization: Authorization
): Promise<LeaseHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }

  // Validate authorization
  if (authorization.kind === "EXPECTED_PRESENT") {
    throw new Error(
      "EXPECTED_PRESENT authorization requires C++ implementation of force-replace lease"
    );
  }
  if (authorization.kind === "UNSAFE_FINAL") {
    throw new Error("UNSAFE_FINAL authorization is not permitted");
  }

  throw new Error(
    "acquireLease requires C++ implementation of descriptor-relative lease tracking"
  );
}

/**
 * Create a temporary file under a held lease.
 *
 * TODO: Requires C++ implementation of descriptor-relative temp creation.
 */
export async function createFileTemp(
  _parent: ParentHandle,
  _lease: LeaseHandle,
  _prefix: string
): Promise<TempHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error(
    "createFileTemp requires C++ implementation of descriptor-relative temp tracking"
  );
}

/**
 * Create a stage directory under a held lease.
 *
 * TODO: Requires C++ implementation.
 */
export async function createDirectoryStage(
  _parent: ParentHandle,
  _lease: LeaseHandle,
  _stageLeaf: string
): Promise<StageHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error(
    "createDirectoryStage requires C++ implementation"
  );
}

/**
 * Create a child file inside a stage directory.
 *
 * TODO: Requires C++ implementation.
 */
export async function createStageChild(
  _stage: StageHandle,
  leafName: string
): Promise<StageChildHandle> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }

  // Validate leaf
  if (
    !leafName ||
    leafName.includes("\0") ||
    leafName.includes("/") ||
    leafName.includes("\\") ||
    leafName === "." ||
    leafName === ".."
  ) {
    throw new Error("Invalid leaf name");
  }

  throw new Error("createStageChild requires C++ implementation");
}

/**
 * Write data to a stage child.
 *
 * TODO: Requires C++ implementation.
 */
export async function writeStageChild(
  _child: StageChildHandle,
  _data: Uint8Array
): Promise<number> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("writeStageChild requires C++ implementation");
}

/**
 * Flush a stage child to disk.
 *
 * TODO: Requires C++ implementation.
 */
export async function flushStageChild(_child: StageChildHandle): Promise<void> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("flushStageChild requires C++ implementation");
}

/**
 * Close a stage child and return its identity.
 *
 * TODO: Requires C++ implementation.
 */
export async function closeStageChild(
  _child: StageChildHandle
): Promise<StageChildIdentity> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("closeStageChild requires C++ implementation");
}

/**
 * Verify a stage directory contains exactly the expected children.
 *
 * TODO: Requires C++ implementation.
 */
export async function verifyDirectoryStage(
  _stage: StageHandle,
  _ownedChildren: ReadonlyArray<{
    handle: StageChildHandle;
    expectedIdentity: StageChildIdentity;
  }>
): Promise<StageVerified> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("verifyDirectoryStage requires C++ implementation");
}

/**
 * Recheck source and destination identities.
 *
 * TODO: Requires C++ implementation.
 */
export async function recheckSourceOutputIdentity(
  _source: SourceHandle,
  _parent: ParentHandle,
  _leafName: string,
  _lease: LeaseHandle
): Promise<IdentityCheck> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("recheckSourceOutputIdentity requires C++ implementation");
}

/**
 * Publish a temp file with atomic no-clobber semantics.
 * Uses atomicRename from the C++ module with RENAME_NOREPLACE.
 *
 * TODO: Requires C++ implementation of descriptor-relative publishFile.
 */
export async function publishFile(
  _lease: LeaseHandle,
  _temp: TempHandle,
  _leafName: string,
  _authorization: { kind: "ABSENT" }
): Promise<PublishResult> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("publishFile requires C++ implementation of descriptor-relative staging");
}

/**
 * Publish a stage directory with atomic no-clobber semantics.
 *
 * TODO: Requires C++ implementation.
 */
export async function publishDirectory(
  _lease: LeaseHandle,
  _stage: StageHandle,
  _leafName: string
): Promise<PublishResult> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("publishDirectory requires C++ implementation");
}

/**
 * Release a lease.
 *
 * TODO: Requires C++ implementation.
 */
export async function releaseLease(_lease: LeaseHandle): Promise<CleanupResult> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("releaseLease requires C++ implementation");
}

/**
 * Cleanup a handle (generic cleanup).
 *
 * TODO: Requires C++ implementation.
 */
export async function cleanup(
  _handle: ParentHandle | SourceHandle | TempHandle | StageHandle | StageChildHandle
): Promise<CleanupResult> {
  const native = loadNativeModuleSync();
  if (!native) {
    throw new Error("Native module not loaded");
  }
  throw new Error("cleanup requires C++ implementation");
}

// =============================================================================
// Utility functions
// =============================================================================

/**
 * Convert a NativeCapabilityManifest to the legacy SecureDestinationCapabilityManifest format.
 */
export function toLegacyManifest(
  manifest: NativeCapabilityManifest
): {
  platform: string;
  arch: string;
  nodeAbi: string;
  secureDestination: boolean;
  supportedPrimitives: string[];
  requiredFlags: string[];
  moduleSha256?: string;
} {
  return {
    platform: manifest.platform,
    arch: manifest.arch,
    nodeAbi: manifest.nodeAbi,
    secureDestination: manifest.supported, // Map the canonical "supported" key
    supportedPrimitives: [...manifest.supportedPrimitives],
    requiredFlags: [...manifest.requiredFlags],
    moduleSha256: manifest.moduleSha256,
  };
}
