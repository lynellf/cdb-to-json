import { afterEach, describe, expect, it } from "vitest";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  readSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireSourceHandle } from "../../src/cdb/sourceHandle.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cdb-source-members-"));
  temporaryRoots.push(root);
  return root;
}

describe("descriptor-safe source member acquisition", () => {
  it("rejects a symlinked main member instead of reading the target", () => {
    const root = makeRoot();
    const target = join(root, "target.cdb");
    const source = join(root, "source.cdb");
    writeFileSync(target, Buffer.from("target-main"));
    symlinkSync(target, source);

    expect(() => acquireSourceHandle(source)).toThrow();
  });

  it("rejects a symlinked WAL or SHM member", async () => {
    const root = makeRoot();
    const source = join(root, "source.cdb");
    writeFileSync(source, Buffer.from("main"));

    const handle = acquireSourceHandle(source);
    try {
      for (const suffix of ["-wal", "-shm"] as const) {
        const target = join(root, `replacement${suffix}`);
        writeFileSync(target, Buffer.from(`target${suffix}`));
        symlinkSync(target, `${source}${suffix}`);

        await expect(handle.openMember(suffix)).rejects.toThrow();
        rmSync(`${source}${suffix}`, { force: true });
      }
    } finally {
      await handle.close();
    }
  });

  it("holds each present member through its descriptor", async () => {
    const root = makeRoot();
    const source = join(root, "source.cdb");
    writeFileSync(source, Buffer.from("main-member"));
    writeFileSync(`${source}-wal`, Buffer.from("wal-member"));
    writeFileSync(`${source}-shm`, Buffer.from("shm-member"));

    const handle = acquireSourceHandle(source);
    try {
      for (const [suffix, expected] of [
        ["-wal", "wal-member"],
        ["-shm", "shm-member"],
      ] as const) {
        const result = await handle.openMember(suffix);
        expect(result).not.toBeNull();
        if (!result) continue;

        const size = Number(fstatSync(result.fd).size);
        const bytes = Buffer.alloc(size);
        readSync(result.fd, bytes, 0, size, 0);
        expect(bytes.toString()).toBe(expected);
        closeSync(result.fd);
      }
    } finally {
      await handle.close();
    }
  });
});
