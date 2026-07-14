import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeMaterializationQuota,
  MaterializationQuotaError,
} from "../../src/cdb/materializationQuota.js";
import {
  cleanupMaterializeDir,
  materializeSnapshot,
} from "../../src/cdb/materializeSnapshot.js";
import { DiagnosticCollector } from "../../src/diagnostics/collector.js";
import { DiagnosticCode } from "../../src/diagnostics/codes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cdb-materialization-quota-"));
  temporaryRoots.push(root);
  return root;
}

function makeDatabase(root: string): string {
  const path = join(root, "source.cdb");
  const db = new Database(path);
  db.exec("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO sample VALUES (?, ?)").run(1, "under-bound");
  db.close();
  return path;
}

describe("pre-write materialization quota", () => {
  it("admits a valid database and bounds the materialized output", () => {
    const root = makeRoot();
    const mainPath = makeDatabase(root);
    const bound = computeMaterializationQuota(mainPath, null, null);

    expect(bound.pageSize).toBeGreaterThanOrEqual(512);
    expect(bound.mainPageCount).toBeGreaterThan(0);
    expect(bound.totalBytes).toBeGreaterThan(bound.materializedMainBytes);

    const materializedPath = materializeSnapshot(
      root,
      mainPath,
      null,
      null,
      root,
      {
        snapshotBytes: 0,
        maxSnapshotBytes: bound.totalBytes,
        maxStagingBytes: bound.totalBytes,
      },
    );

    expect(statSync(materializedPath).size).toBeLessThanOrEqual(bound.materializedMainBytes);
    cleanupMaterializeDir(dirname(materializedPath));
  });

  it("rejects an over-bound input before creating a writable materialization", () => {
    const root = makeRoot();
    const mainPath = makeDatabase(root);
    const bound = computeMaterializationQuota(mainPath, null, null);
    const diagnostics = new DiagnosticCollector();

    expect(() =>
      materializeSnapshot(root, mainPath, null, null, root, {
        snapshotBytes: 0,
        maxSnapshotBytes: bound.totalBytes - 1,
        maxStagingBytes: bound.totalBytes - 1,
        diagnostics,
      }),
    ).toThrow(MaterializationQuotaError);

    expect(readdirSync(root).some((name) => name.startsWith("cdb-materialize-"))).toBe(false);
    expect(
      diagnostics.getErrors().some(
        (diagnostic) => diagnostic.code === DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
      ),
    ).toBe(true);
  });

  it("rejects a sparse high-page image from the bound, without opening SQLite writable", () => {
    const root = makeRoot();
    const mainPath = join(root, "sparse.cdb");
    const pageSize = 4096;
    const pageCount = 100_000;
    const header = Buffer.alloc(100);
    header.write("SQLite format 3\0", 0, "ascii");
    header.writeUInt16BE(pageSize, 16);
    header[18] = 1;
    header[19] = 1;
    header[20] = 0;
    header.writeUInt32BE(pageCount, 28);
    writeFileSync(mainPath, header);
    truncateSync(mainPath, pageSize * pageCount);

    const bound = computeMaterializationQuota(mainPath, null, null);
    expect(bound.materializedMainBytes).toBeGreaterThan(400_000_000);

    expect(() =>
      materializeSnapshot(root, mainPath, null, null, root, {
        snapshotBytes: 100,
        maxSnapshotBytes: 1_000_000,
        maxStagingBytes: 1_000_000,
      }),
    ).toThrow(/quota|limit/i);
    expect(readdirSync(root).some((name) => name.startsWith("cdb-materialize-"))).toBe(false);
  });

  it("fails closed on malformed WAL metadata", () => {
    const root = makeRoot();
    const mainPath = makeDatabase(root);
    const walPath = join(root, "source.cdb-wal");
    const invalidWal = Buffer.alloc(32);
    invalidWal.writeUInt32BE(0xdeadbeef, 0);
    writeFileSync(walPath, invalidWal);

    expect(() => computeMaterializationQuota(mainPath, walPath, null)).toThrow(
      MaterializationQuotaError,
    );
  });
});
