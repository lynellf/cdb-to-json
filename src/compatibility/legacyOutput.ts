/**
 * Hardened legacy output boundary.
 *
 * Legacy output is the one compatibility exception that may replace an
 * existing final. It still uses the native descriptor-relative matrix:
 * held no-follow parent traversal, exclusive lock/temp leaves, no-replace
 * rename, identity-checked force replacement, and descriptor cleanup.
 */

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { probeNativeCapability } from "../destinations/nativeAdapter.js";
import {
  atomicRenameDescriptor,
  mkdirRelativeDescriptor,
  openRelativeDescriptor,
  unlinkRelativeDescriptor,
} from "../destinations/nativeAdapter.js";

const O_CLOEXEC = 0x80000; // Linux O_CLOEXEC; Node does not expose it in fs.constants.
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | O_CLOEXEC;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC;
const TEMP_FLAGS =
  constants.O_RDWR |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW |
  O_CLOEXEC;

interface DescriptorIdentity {
  device: number;
  inode: number;
  size: number;
  digest: string;
}

interface NativeResult {
  success: boolean;
  errcode: number;
  error_msg: string;
}

/** Legacy output configuration. */
export interface LegacyOutputOptions {
  diagnostics?: DiagnosticCollector;
  verbose?: boolean;
  /** Test seam for capability vectors; production uses the native probe. */
  capabilityProbe?: () => Promise<boolean>;
  /** Test seam for deterministic parent/final race vectors. */
  beforePublish?: () => void | Promise<void>;
}

/** Result of a legacy write operation. */
export interface LegacyWriteResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

function validateLeaf(leaf: string): void {
  if (
    leaf.length === 0 ||
    leaf === "." ||
    leaf === ".." ||
    leaf.includes("\0") ||
    leaf.includes("/") ||
    leaf.includes("\\")
  ) {
    throw new Error(`Invalid legacy output leaf: ${leaf}`);
  }
}

function nativeError(result: NativeResult, context: string): NodeJS.ErrnoException {
  const error = new Error(
    `${context}: ${result.error_msg || "native operation failed"} (${result.errcode})`,
  ) as NodeJS.ErrnoException;
  if (result.errcode === 2) error.code = "ENOENT";
  if (result.errcode === 17) error.code = "EEXIST";
  if (result.errcode === 20) error.code = "ENOTDIR";
  if (result.errcode === 40) error.code = "ELOOP";
  return error;
}

function hashDescriptor(fd: number, size: number): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(size, 1)));
  let offset = 0;
  while (offset < size) {
    const requested = Math.min(buffer.length, size - offset);
    const bytesRead = readSync(fd, buffer, 0, requested, offset) as number;
    if (bytesRead === 0) throw new Error("Unexpected end of legacy output descriptor");
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest("hex");
}

function captureIdentity(fd: number): DescriptorIdentity {
  const stats = fstatSync(fd);
  if (!stats.isFile()) throw new Error("Legacy output final is not a regular file");
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    digest: hashDescriptor(fd, stats.size),
  };
}

function sameIdentity(left: DescriptorIdentity, right: DescriptorIdentity): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.digest === right.digest
  );
}

function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fd, content, offset, content.length - offset, null);
    if (written === 0) throw new Error("Legacy output descriptor made no progress");
    offset += written;
  }
}

function openDirectoryTree(outputDir: string): number {
  const absolute = resolve(outputDir);
  const components = absolute.split("/").filter((component) => component.length > 0);
  let currentFd = openSync("/", DIRECTORY_FLAGS);

  try {
    for (const component of components) {
      validateLeaf(component);
      let opened = openRelativeDescriptor(currentFd, component, DIRECTORY_FLAGS);
      if (!opened.success) {
        if (opened.errcode !== 2) throw nativeError(opened, `open output directory component ${component}`);
        const created = mkdirRelativeDescriptor(currentFd, component, 0o755);
        if (!created.success && created.errcode !== 17) {
          throw nativeError(created, `create output directory component ${component}`);
        }
        opened = openRelativeDescriptor(currentFd, component, DIRECTORY_FLAGS);
      }
      if (!opened.success) throw nativeError(opened, `open output directory component ${component}`);
      const nextFd = opened.fd;
      closeSync(currentFd);
      currentFd = nextFd;
    }
    return currentFd;
  } catch (error) {
    try { closeSync(currentFd); } catch { /* best effort */ }
    throw error;
  }
}

function removeRelative(parentFd: number, leaf: string): void {
  const result = unlinkRelativeDescriptor(parentFd, leaf);
  if (!result.success && result.errcode !== 2) {
    throw nativeError(result, `remove legacy private leaf ${leaf}`);
  }
}

function renameNoReplace(parentFd: number, oldLeaf: string, newLeaf: string): void {
  const result = atomicRenameDescriptor(parentFd, oldLeaf, parentFd, newLeaf);
  if (!result.success) throw nativeError(result, `publish legacy leaf ${oldLeaf} -> ${newLeaf}`);
}

function inspectFinal(parentFd: number, finalLeaf: string): DescriptorIdentity | null {
  const opened = openRelativeDescriptor(parentFd, finalLeaf, READ_FLAGS);
  if (!opened.success) {
    if (opened.errcode === 2) return null;
    throw nativeError(opened, `inspect legacy final ${finalLeaf}`);
  }
  try {
    return captureIdentity(opened.fd);
  } finally {
    closeSync(opened.fd);
  }
}

/**
 * Write a legacy output file using the descriptor-relative compatibility ABI.
 */
export async function writeLegacyFile(
  outputDir: string,
  basenameStr: string,
  content: string,
  options: LegacyOutputOptions = {},
): Promise<LegacyWriteResult> {
  const outputPath = join(outputDir, `${basenameStr}.json`);
  const diagnostics = options.diagnostics;
  let parentFd: number | null = null;
  let lockFd: number | null = null;
  let tempFd: number | null = null;
  let tempExists = false;
  let backupExists = false;
  let backupLeaf = "";
  const tempLeaf = `.cdb-legacy-${randomUUID()}.tmp`;
  let lockLeaf = "";

  const fail = (error: unknown): LegacyWriteResult => {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics?.error(
      DiagnosticCode.OUTPUT_WRITE_FAILED,
      `Failed to write legacy output: ${message}`,
      { details: { outputDir, basename: basenameStr } },
    );
    return { success: false, outputPath, error: message };
  };

  try {
    validateLeaf(basenameStr);
    lockLeaf = `.cdb-legacy-${basenameStr}.lock`;
    const supported = options.capabilityProbe
      ? await options.capabilityProbe()
      : (await probeNativeCapability()).supported;
    if (!supported) {
      const error = new Error("Legacy output requires the native secure-destination capability");
      diagnostics?.error(
        DiagnosticCode.UNSAFE_DESTINATION_FILESYSTEM,
        error.message,
        { details: { outputDir, basename: basenameStr } },
      );
      return { success: false, outputPath, error: error.message };
    }

    parentFd = openDirectoryTree(outputDir);

    const lock = openRelativeDescriptor(parentFd, lockLeaf, TEMP_FLAGS, 0o600);
    if (!lock.success) throw nativeError(lock, "acquire legacy output lock");
    lockFd = lock.fd;

    const finalLeaf = `${basenameStr}.json`;
    const priorFinal = inspectFinal(parentFd, finalLeaf);

    const temp = openRelativeDescriptor(parentFd, tempLeaf, TEMP_FLAGS, 0o600);
    if (!temp.success) throw nativeError(temp, "create legacy output temporary");
    tempFd = temp.fd;
    tempExists = true;
    writeAll(tempFd, Buffer.from(content, "utf8"));
    fsyncSync(tempFd);
    const stagedIdentity = captureIdentity(tempFd);

    await options.beforePublish?.();

    if (priorFinal !== null) {
      backupLeaf = `.cdb-legacy-${randomUUID()}.bak`;
      renameNoReplace(parentFd, finalLeaf, backupLeaf);
      backupExists = true;

      const backupOpened = openRelativeDescriptor(parentFd, backupLeaf, READ_FLAGS);
      if (!backupOpened.success) throw nativeError(backupOpened, "open legacy backup");
      let backupIdentity: DescriptorIdentity;
      try {
        backupIdentity = captureIdentity(backupOpened.fd);
      } finally {
        closeSync(backupOpened.fd);
      }
      if (!sameIdentity(priorFinal, backupIdentity)) {
        try {
          renameNoReplace(parentFd, backupLeaf, finalLeaf);
          backupExists = false;
        } catch {
          // Retain the backup rather than clobbering an externally-created final.
        }
        throw new Error("Legacy final changed before replacement; refusing to clobber it");
      }
    }

    renameNoReplace(parentFd, tempLeaf, finalLeaf);
    tempExists = false;
    fsyncSync(parentFd);
    closeSync(tempFd);
    tempFd = null;

    const committed = inspectFinal(parentFd, finalLeaf);
    if (committed === null || !sameIdentity(stagedIdentity, committed)) {
      throw new Error("Legacy final identity did not match the staged bytes after publication");
    }

    if (backupExists) {
      removeRelative(parentFd, backupLeaf);
      backupExists = false;
      fsyncSync(parentFd);
    }

    return { success: true, outputPath };
  } catch (error) {
    // If force replacement moved a prior final aside, restore it only through
    // no-replace rename. Never overwrite a final that appeared externally.
    if (parentFd !== null && backupExists) {
      try {
        renameNoReplace(parentFd, backupLeaf, `${basenameStr}.json`);
        backupExists = false;
      } catch {
        // Keep the backup as recovery state when restoration is unsafe.
      }
    }
    return fail(error);
  } finally {
    if (tempFd !== null) {
      try { closeSync(tempFd); } catch { /* best effort */ }
    }
    if (parentFd !== null) {
      if (tempExists) {
        try { removeRelative(parentFd, tempLeaf); } catch { /* best effort */ }
      }
      try { removeRelative(parentFd, lockLeaf); } catch { /* best effort */ }
      try { closeSync(parentFd); } catch { /* best effort */ }
    }
    if (lockFd !== null) {
      try { closeSync(lockFd); } catch { /* best effort */ }
    }
  }
}

/** Check whether a legacy output is an existing regular file. */
export async function legacyOutputExists(
  outputDir: string,
  basenameStr: string,
): Promise<boolean> {
  try {
    return lstatSync(join(outputDir, `${basenameStr}.json`)).isFile();
  } catch {
    return false;
  }
}
