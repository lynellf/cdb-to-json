import { afterEach, describe, expect, it } from "vitest";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  readSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { acquireSourceHandle } from "../../src/cdb/sourceHandle.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function readFd(fd: number): string {
  const size = Number(fstatSync(fd).size);
  const bytes = Buffer.alloc(size);
  readSync(fd, bytes, 0, size, 0);
  return bytes.toString();
}

describe("held source parent descriptors", () => {
  it.each([
    ["absolute", (path: string) => path],
    ["relative", (path: string) => relative(process.cwd(), path)],
  ] as const)("keep %s input bound to the original parent", async (label, formatPath) => {
    const root = mkdtempSync(
      join(label === "relative" ? process.cwd() : tmpdir(), "cdb-source-parent-"),
    );
    temporaryRoots.push(root);
    const originalParent = join(root, "parent");
    const movedParent = join(root, "parent-moved");
    mkdirSync(originalParent);

    const source = join(originalParent, "source.cdb");
    writeFileSync(source, Buffer.from("original-main"));
    writeFileSync(`${source}-wal`, Buffer.from("original-wal"));
    writeFileSync(`${source}-shm`, Buffer.from("original-shm"));

    const handle = acquireSourceHandle(formatPath(source));
    try {
      renameSync(originalParent, movedParent);
      mkdirSync(originalParent);
      writeFileSync(join(originalParent, "source.cdb"), Buffer.from("replacement-main"));
      writeFileSync(join(originalParent, "source.cdb-wal"), Buffer.from("replacement-wal"));
      writeFileSync(join(originalParent, "source.cdb-shm"), Buffer.from("replacement-shm"));

      expect(readFd(handle.mainFd)).toBe("original-main");
      for (const [suffix, expected] of [
        ["-wal", "original-wal"],
        ["-shm", "original-shm"],
      ] as const) {
        const result = await handle.openMember(suffix);
        expect(result).not.toBeNull();
        if (!result) continue;
        expect(readFd(result.fd)).toBe(expected);
        closeSync(result.fd);
      }
    } finally {
      await handle.close();
    }
  });
});
