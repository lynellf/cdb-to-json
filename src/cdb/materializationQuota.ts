/**
 * Read-only admission bound for private SQLite materialization.
 *
 * The bound is computed before a copied database is opened writable. It is
 * intentionally conservative: an unknown or malformed SQLite/WAL format is
 * rejected instead of being assigned an observed-size estimate.
 */

import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { endianness } from "node:os";

const SQLITE_HEADER_BYTES = 100;
const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;
const DATABASE_HEADER_BYTES = 100;
const JOURNAL_HEADER_BYTES = 28;
const TEMP_HEADER_BYTES = 100;
const SHM_BASE_BYTES = 32 * 1024;
const SHM_INDEX_PAGE_BYTES = 32 * 1024;
const SHM_PAGES_PER_INDEX = 4096;
const WAL_MAX_VERSION = 3_007_000;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ZERO_HASH = 0n;

export type MaterializationQuotaErrorCode =
  | "CDB_OPEN_FAILED"
  | "RESOURCE_LIMIT_EXCEEDED";

export class MaterializationQuotaError extends Error {
  readonly code: MaterializationQuotaErrorCode;

  constructor(message: string, code: MaterializationQuotaErrorCode = "CDB_OPEN_FAILED") {
    super(message);
    this.name = "MaterializationQuotaError";
    this.code = code;
  }
}

export interface MaterializationQuotaBound {
  pageSize: number;
  mainPageCount: number;
  walFrameCount: number;
  maxPageNumber: number;
  materializedMainBytes: number;
  rollbackJournalBytes: number;
  walBytes: number;
  shmBytes: number;
  temporaryBytes: number;
  totalBytes: number;
}

export interface MaterializationQuotaOptions {
  /** Bytes already charged for the copied source bundle. */
  snapshotBytes?: number;
  /** Maximum snapshot counter remaining for this materialization. */
  maxSnapshotBytes?: number;
  /** Maximum aggregate staging counter remaining for this materialization. */
  maxStagingBytes?: number;
}

export interface MaterializationQuotaReservation {
  readonly bound: MaterializationQuotaBound;
  readonly reservedBytes: number;
  readonly released: boolean;
  release(): void;
}

interface WalSummary {
  frameCount: number;
  maxPageNumber: bigint;
}

function failFormat(message: string): never {
  throw new MaterializationQuotaError(message, "CDB_OPEN_FAILED");
}

function checkedNumber(value: bigint, label: string): number {
  if (value < ZERO_HASH || value > MAX_SAFE_BIGINT) {
    failFormat(`${label} overflows the checked materialization quota arithmetic`);
  }
  return Number(value);
}

function checkedAdd(left: bigint, right: bigint, label: string): bigint {
  const result = left + right;
  if (result > MAX_SAFE_BIGINT) {
    failFormat(`${label} overflows the checked materialization quota arithmetic`);
  }
  return result;
}

function checkedMultiply(left: bigint, right: bigint, label: string): bigint {
  const result = left * right;
  if (result > MAX_SAFE_BIGINT) {
    failFormat(`${label} overflows the checked materialization quota arithmetic`);
  }
  return result;
}

function readFullyAt(fd: number, buffer: Buffer, position: number): void {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(fd, buffer, offset, buffer.length - offset, position + offset) as number;
    if (bytesRead === 0) {
      failFormat(`short read while inspecting a private SQLite file at byte ${position + offset}`);
    }
    offset += bytesRead;
  }
}

function readMainHeader(path: string): { header: Buffer; fileSize: number; pageCount: bigint } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    failFormat(`cannot read SQLite header at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size < SQLITE_HEADER_BYTES) {
      failFormat(`SQLite main image is not a complete regular file: ${path}`);
    }
    const header = Buffer.alloc(SQLITE_HEADER_BYTES);
    readFullyAt(fd, header, 0);
    const pageSizeValue = header.readUInt16BE(16);
    const pageSize = pageSizeValue === 0 ? 65_536 : pageSizeValue;
    if (
      ![512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].includes(pageSize) ||
      header[20] >= pageSize
    ) {
      failFormat(`unsupported SQLite page size or reserved space in ${path}`);
    }
    if (header.subarray(0, 16).toString("latin1") !== "SQLite format 3\0") {
      failFormat(`invalid SQLite file header in ${path}`);
    }
    const pageCount = BigInt(header.readUInt32BE(28));
    if (pageCount === ZERO_HASH) {
      failFormat(`SQLite main image has no committed pages: ${path}`);
    }
    const expectedBytes = checkedMultiply(pageCount, BigInt(pageSize), "SQLite main image size");
    if (expectedBytes > stats.size) {
      failFormat(`SQLite main image is truncated: ${path}`);
    }
    return { header, fileSize: stats.size, pageCount };
  } finally {
    closeSync(fd);
  }
}

function checksumWords(
  bytes: Buffer,
  bigEndianWords: boolean,
  seed: readonly [number, number],
): [number, number] {
  if (bytes.length === 0 || bytes.length % 8 !== 0) {
    failFormat("WAL checksum input is not an aligned word sequence");
  }
  let first = seed[0] >>> 0;
  let second = seed[1] >>> 0;
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const word1 = bigEndianWords
      ? bytes.readUInt32BE(offset)
      : bytes.readUInt32LE(offset);
    const word2 = bigEndianWords
      ? bytes.readUInt32BE(offset + 4)
      : bytes.readUInt32LE(offset + 4);
    first = (first + word1 + second) >>> 0;
    second = (second + word2 + first) >>> 0;
  }
  return [first, second];
}

function readWalSummary(path: string | null, pageSize: number): WalSummary {
  if (path === null || !existsSync(path)) {
    return { frameCount: 0, maxPageNumber: ZERO_HASH };
  }

  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    failFormat(`cannot read WAL header at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      failFormat(`SQLite WAL is not a regular file: ${path}`);
    }
    if (stats.size === 0) {
      return { frameCount: 0, maxPageNumber: ZERO_HASH };
    }
    if (stats.size < WAL_HEADER_BYTES) {
      failFormat(`SQLite WAL is truncated: ${path}`);
    }

    const header = Buffer.alloc(WAL_HEADER_BYTES);
    readFullyAt(fd, header, 0);
    const magic = header.readUInt32BE(0);
    if ((magic & 0xfffffffe) !== 0x377f0682) {
      failFormat(`invalid SQLite WAL magic in ${path}`);
    }
    if (header.readUInt32BE(4) !== WAL_MAX_VERSION) {
      failFormat(`unsupported SQLite WAL version in ${path}`);
    }
    if (header.readUInt32BE(8) !== pageSize) {
      failFormat(`SQLite WAL page size does not match the main image in ${path}`);
    }

    const useNativeWordOrder = (magic & 1) === (endianness() === "BE" ? 1 : 0);
    const bigEndianWords = !useNativeWordOrder;
    const headerChecksum = checksumWords(
      header.subarray(0, WAL_HEADER_BYTES - 8),
      bigEndianWords,
      [0, 0],
    );
    if (
      headerChecksum[0] !== header.readUInt32BE(24) ||
      headerChecksum[1] !== header.readUInt32BE(28)
    ) {
      failFormat(`invalid SQLite WAL header checksum in ${path}`);
    }

    const frameSize = WAL_FRAME_HEADER_BYTES + pageSize;
    const payloadBytes = stats.size - WAL_HEADER_BYTES;
    if (payloadBytes % frameSize !== 0) {
      failFormat(`SQLite WAL has a partial frame in ${path}`);
    }
    const frameCount = payloadBytes / frameSize;
    if (!Number.isSafeInteger(frameCount)) {
      failFormat(`SQLite WAL frame count is too large in ${path}`);
    }

    const frame = Buffer.alloc(frameSize);
    let previousChecksum: [number, number] = headerChecksum;
    let maxPageNumber = ZERO_HASH;
    const salt = header.subarray(16, 24);
    for (let index = 0; index < frameCount; index += 1) {
      readFullyAt(fd, frame, WAL_HEADER_BYTES + index * frameSize);
      const pageNumber = BigInt(frame.readUInt32BE(0));
      if (pageNumber === ZERO_HASH) {
        failFormat(`SQLite WAL contains a zero page number in ${path}`);
      }
      if (!frame.subarray(8, 16).equals(salt)) {
        failFormat(`SQLite WAL frame salt mismatch in ${path}`);
      }
      const frameChecksum = checksumWords(
        frame.subarray(0, 8),
        bigEndianWords,
        previousChecksum,
      );
      previousChecksum = checksumWords(
        frame.subarray(WAL_FRAME_HEADER_BYTES),
        bigEndianWords,
        frameChecksum,
      );
      if (
        previousChecksum[0] !== frame.readUInt32BE(16) ||
        previousChecksum[1] !== frame.readUInt32BE(20)
      ) {
        failFormat(`invalid SQLite WAL frame checksum in ${path}`);
      }
      const committedPageCount = BigInt(frame.readUInt32BE(4));
      if (pageNumber > maxPageNumber) maxPageNumber = pageNumber;
      if (committedPageCount > maxPageNumber) maxPageNumber = committedPageCount;
    }
    return { frameCount, maxPageNumber };
  } finally {
    closeSync(fd);
  }
}

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return value === ZERO_HASH ? ZERO_HASH : (value + divisor - 1n) / divisor;
}

export function computeMaterializationQuota(
  mainPath: string,
  walPath: string | null,
  _shmPath: string | null,
): MaterializationQuotaBound {
  const { header, fileSize, pageCount } = readMainHeader(mainPath);
  const pageSize = header.readUInt16BE(16) || 65_536;
  const wal = readWalSummary(walPath, pageSize);
  const maxPageNumber = pageCount > wal.maxPageNumber ? pageCount : wal.maxPageNumber;
  const walFrameBound =
    BigInt(wal.frameCount) > maxPageNumber ? BigInt(wal.frameCount) : maxPageNumber;
  const page = BigInt(pageSize);

  const materializedMainBytes = checkedAdd(
    checkedMultiply(maxPageNumber, page, "materialized main bound"),
    BigInt(DATABASE_HEADER_BYTES),
    "materialized main bound",
  );
  const rollbackJournalBytes = checkedAdd(
    checkedAdd(
      checkedMultiply(maxPageNumber, page, "rollback journal bound"),
      BigInt(JOURNAL_HEADER_BYTES),
      "rollback journal bound",
    ),
    page,
    "rollback journal bound",
  );
  const walBytes = checkedAdd(
    checkedMultiply(
      walFrameBound,
      BigInt(pageSize + WAL_FRAME_HEADER_BYTES),
      "WAL bound",
    ),
    BigInt(WAL_HEADER_BYTES),
    "WAL bound",
  );
  const shmIndexPages = ceilDivide(BigInt(maxPageNumber), BigInt(SHM_PAGES_PER_INDEX));
  const shmBytes = checkedAdd(
    BigInt(SHM_BASE_BYTES),
    checkedMultiply(shmIndexPages, BigInt(SHM_INDEX_PAGE_BYTES), "SHM bound"),
    "SHM bound",
  );
  const temporaryBytes = checkedAdd(
    checkedMultiply(maxPageNumber, page, "temporary SQLite bound"),
    BigInt(TEMP_HEADER_BYTES),
    "temporary SQLite bound",
  );

  const totalBytes = [
    materializedMainBytes,
    rollbackJournalBytes,
    walBytes,
    shmBytes,
    temporaryBytes,
  ].reduce((total, value) => checkedAdd(total, value, "materialization quota"), 0n);

  // fileSize is intentionally read above and retained as a format sanity
  // check; the quota is based on page metadata, not the observed file size.
  if (fileSize < pageSize) {
    failFormat(`SQLite main image is smaller than one page: ${mainPath}`);
  }

  return {
    pageSize,
    mainPageCount: checkedNumber(pageCount, "main page count"),
    walFrameCount: wal.frameCount,
    maxPageNumber: checkedNumber(maxPageNumber, "maximum page number"),
    materializedMainBytes: checkedNumber(materializedMainBytes, "materialized main bound"),
    rollbackJournalBytes: checkedNumber(rollbackJournalBytes, "rollback journal bound"),
    walBytes: checkedNumber(walBytes, "WAL bound"),
    shmBytes: checkedNumber(shmBytes, "SHM bound"),
    temporaryBytes: checkedNumber(temporaryBytes, "temporary SQLite bound"),
    totalBytes: checkedNumber(totalBytes, "materialization quota"),
  };
}

export function admitMaterializationQuota(
  mainPath: string,
  walPath: string | null,
  shmPath: string | null,
  options: MaterializationQuotaOptions = {},
): MaterializationQuotaReservation {
  const bound = computeMaterializationQuota(mainPath, walPath, shmPath);
  const snapshotBytes = options.snapshotBytes ?? 0;
  if (!Number.isSafeInteger(snapshotBytes) || snapshotBytes < 0) {
    throw new MaterializationQuotaError("snapshotBytes is not a checked non-negative integer");
  }

  if (shmPath !== null && existsSync(shmPath)) {
    const shmStats = lstatSync(shmPath);
    if (!shmStats.isFile()) {
      failFormat(`SQLite SHM member is not a regular file: ${shmPath}`);
    }
  }

  const required = BigInt(snapshotBytes) + BigInt(bound.totalBytes);
  for (const [name, limit] of [
    ["maxSnapshotBytes", options.maxSnapshotBytes],
    ["maxStagingBytes", options.maxStagingBytes],
  ] as const) {
    if (limit === undefined) continue;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new MaterializationQuotaError(`${name} is not a checked non-negative integer`);
    }
    if (required > BigInt(limit)) {
      throw new MaterializationQuotaError(
        `materialization quota (${required}) exceeds ${name} (${limit})`,
        "RESOURCE_LIMIT_EXCEEDED",
      );
    }
  }

  let released = false;
  return {
    bound,
    reservedBytes: bound.totalBytes,
    get released() {
      return released;
    },
    release() {
      released = true;
    },
  };
}
