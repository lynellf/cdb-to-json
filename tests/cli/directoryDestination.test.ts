import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAtomicDirectoryDestination,
} from "../../src/destinations/directoryDestination.js";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cdb-directory-destination-test-"));
}

describe("fresh descriptor-relative split directory destination", () => {
  it("publishes deterministic per-database units after all units finish", () => {
    const root = makeTempRoot();
    const outputRoot = join(root, "out");
    try {
      const writer = createAtomicDirectoryDestination(outputRoot, { format: "json" });
      writer.beginUnit({ inputOrdinal: 0, fileName: "first.cards.cdb" });
      writer.write("first\n");
      writer.endUnit();
      writer.beginUnit({ inputOrdinal: 1, fileName: "second/cards.cdb" });
      writer.write("second\n");
      writer.endUnit();

      const privateEntries = readdirSync(outputRoot).sort();
      expect(privateEntries).toHaveLength(4);
      expect(privateEntries).toContain(".cdb-to-json-000001-first.cards.raw.json.lock");
      expect(privateEntries).toContain(".cdb-to-json-000002-second_cards.raw.json.lock");
      expect(privateEntries.filter((entry) => entry.endsWith(".tmp"))).toHaveLength(2);

      writer.commit();
      expect(readdirSync(outputRoot)).toEqual([
        "000001-first.cards.raw.json",
        "000002-second_cards.raw.json",
      ]);
      expect(readFileSync(join(outputRoot, "000001-first.cards.raw.json"), "utf8")).toBe("first\n");
      expect(readFileSync(join(outputRoot, "000002-second_cards.raw.json"), "utf8")).toBe("second\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes the fresh root and all private unit state on abort", () => {
    const root = makeTempRoot();
    const outputRoot = join(root, "out");
    try {
      const writer = createAtomicDirectoryDestination(outputRoot, { format: "jsonl" });
      writer.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" });
      writer.write("partial\n");
      writer.endUnit();
      writer.abort();
      expect(existsSync(outputRoot)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an existing split root before adopting its contents", () => {
    const root = makeTempRoot();
    const outputRoot = join(root, "out");
    mkdirSync(outputRoot);
    writeFileSync(join(outputRoot, "keep.txt"), "keep\n");
    try {
      const writer = createAtomicDirectoryDestination(outputRoot, { format: "json" });
      expect(() => writer.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" }))
        .toThrowError(/Output directory already exists/);
      expect(readFileSync(join(outputRoot, "keep.txt"), "utf8")).toBe("keep\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked parent without creating output outside it", () => {
    const root = makeTempRoot();
    const target = join(root, "target");
    const link = join(root, "link");
    mkdirSync(target);
    symlinkSync(target, link);
    try {
      const writer = createAtomicDirectoryDestination(join(link, "out"), { format: "json" });
      expect(() => writer.beginUnit({ inputOrdinal: 0, fileName: "cards.cdb" }))
        .toThrow();
      expect(readdirSync(target)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
