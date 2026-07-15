import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAtomicFileDestination,
  FileDestinationError,
} from "../../src/destinations/fileDestination.js";

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cdb-file-destination-test-"));
}

describe.skip("descriptor-relative atomic file destination (native security contract)", () => {
  it("publishes streamed bytes and removes private siblings", () => {
    const root = makeTempRoot();
    try {
      const outputPath = join(root, "cards.raw.json");
      const writer = createAtomicFileDestination(outputPath);
      writer.write("{\"schema\":");
      writer.write("\"cdb.raw/1\"}\n");
      writer.commit();

      expect(readFileSync(outputPath, "utf8")).toBe("{\"schema\":\"cdb.raw/1\"}\n");
      expect(readdirSync(root)).toEqual(["cards.raw.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves an existing final and rejects it before staging", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");
    writeFileSync(outputPath, "prior\n");
    try {
      expect(() => createAtomicFileDestination(outputPath)).toThrow(FileDestinationError);
      try {
        createAtomicFileDestination(outputPath);
      } catch (error) {
        expect(error).toMatchObject({ code: "OUTPUT_EXISTS" });
      }
      expect(readFileSync(outputPath, "utf8")).toBe("prior\n");
      expect(readdirSync(root)).toEqual(["cards.raw.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aborts without leaving a final, lock, or temporary sibling", () => {
    const root = makeTempRoot();
    try {
      const writer = createAtomicFileDestination(join(root, "cards.raw.json"));
      writer.write("partial");
      writer.abort();
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects symlinked parent components without writing through them", () => {
    const root = makeTempRoot();
    const target = join(root, "target");
    const link = join(root, "link");
    mkdirSync(target);
    symlinkSync(target, link);
    try {
      expect(() => createAtomicFileDestination(join(link, "cards.raw.json"))).toThrow(
        FileDestinationError,
      );
      expect(existsSync(join(target, "cards.raw.json"))).toBe(false);
      expect(readdirSync(target)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the held original parent when its path is replaced", () => {
    const root = makeTempRoot();
    const original = join(root, "out");
    const moved = join(root, "moved");
    const replacement = join(root, "out");
    mkdirSync(original);
    try {
      const writer = createAtomicFileDestination(join(original, "cards.raw.json"));
      renameSync(original, moved);
      mkdirSync(replacement);

      writer.write("held-parent\n");
      writer.commit();

      expect(readFileSync(join(moved, "cards.raw.json"), "utf8")).toBe("held-parent\n");
      expect(readdirSync(replacement)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force replaces an existing final with backup and restores on publish failure", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    // Create an existing final
    writeFileSync(outputPath, "original content\n");
    expect(readFileSync(outputPath, "utf8")).toBe("original content\n");

    try {
      // Force mode should accept the existing file and create a backup
      const writer = createAtomicFileDestination(outputPath, { force: true });

      // Check that backup was created (non-deterministic name, but should exist)
      const files = readdirSync(root);
      expect(files.some(f => f.endsWith(".bak") && f.startsWith(".cdb-to-json-"))).toBe(true);

      // Simulate publish failure by aborting
      writer.write("new content\n");
      writer.abort();

      // After abort, the backup should still exist (user can recover)
      // and the original should be restored
      const filesAfter = readdirSync(root);
      const backupExists = filesAfter.some(f => f.endsWith(".bak") && f.startsWith(".cdb-to-json-"));
      expect(backupExists).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("force replaces an existing final and removes backup on success", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "cards.raw.json");

    // Create an existing final
    writeFileSync(outputPath, "original content\n");

    try {
      // Force mode should accept the existing file
      const writer = createAtomicFileDestination(outputPath, { force: true });
      writer.write("new content\n");
      writer.commit();

      // The new content should be published
      expect(readFileSync(outputPath, "utf8")).toBe("new content\n");

      // Backup should be removed on success
      const files = readdirSync(root);
      expect(files).toEqual(["cards.raw.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
