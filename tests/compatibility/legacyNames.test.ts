/**
 * Tests for legacy filename handling.
 *
 * Validates:
 * - Direct-child candidates whose names contain ".cdb"
 * - Old first-dot basename derivation
 * - Basename ignore
 * - Derived-basename collisions
 */

import { describe, it, expect } from "vitest";
import { legacyContainsCdb, legacyBasename } from "../../dist/discovery/pathPolicy.js";

describe("Legacy Names", () => {
  describe("legacyContainsCdb", () => {
    it("matches files containing .cdb anywhere", () => {
      expect(legacyContainsCdb("cards.cdb")).toBe(true);
      expect(legacyContainsCdb("my.cards.cdb")).toBe(true);
      expect(legacyContainsCdb("cards.cdb.backup")).toBe(true);
      expect(legacyContainsCdb("nocdbhere")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(legacyContainsCdb("CARDS.CDB")).toBe(true);
      expect(legacyContainsCdb("Cards.Cdb")).toBe(true);
    });

    it("matches partial .cdb in name", () => {
      // Legacy rule matches any name containing .cdb
      expect(legacyContainsCdb("something.cdbfile")).toBe(true);
      expect(legacyContainsCdb("archive.cdb.tar")).toBe(true);
    });
  });

  describe("legacyBasename", () => {
    it("derives basename from first dot", () => {
      expect(legacyBasename("cards.cdb")).toBe("cards");
      expect(legacyBasename("my.deck.cdb")).toBe("my");
      expect(legacyBasename("cards")).toBe("cards"); // No dot
      expect(legacyBasename(".hidden.cdb")).toBe(""); // Empty first segment
    });

    it("handles multiple dots", () => {
      expect(legacyBasename("deck.v1.cdb")).toBe("deck");
      expect(legacyBasename("a.b.c.d.cdb")).toBe("a");
    });
  });

  describe("derived basename collisions", () => {
    it("detects collision between files that would derive same basename", () => {
      const files = [
        "cards.cdb",
        "cards.cdb.old",
      ];

      // Both would derive "cards" as basename
      const basenames = files.map((f) => ({
        file: f,
        basename: legacyBasename(f),
        matches: legacyContainsCdb(f),
      }));

      expect(basenames.every((b) => b.matches)).toBe(true);

      // Find duplicates
      const nameCount = new Map<string, number>();
      for (const b of basenames) {
        nameCount.set(b.basename, (nameCount.get(b.basename) || 0) + 1);
      }

      // Should have collision on "cards"
      expect(nameCount.get("cards")).toBe(2);
    });

    it("no collision between distinct basenames", () => {
      const files = [
        "deck1.cdb",
        "deck2.cdb",
        "deck3.cdb",
      ];

      const basenames = files.map(legacyBasename);
      const uniqueNames = new Set(basenames);

      expect(uniqueNames.size).toBe(3);
    });

    it("sorted basenames are deterministic", () => {
      const files = ["zzz.cdb", "aaa.cdb", "mmm.cdb"];
      const sortedFiles = [...files].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
      const sortedBasenames = sortedFiles.map(legacyBasename);

      expect(sortedBasenames).toEqual(["aaa", "mmm", "zzz"]);
    });
  });

  describe("ignore list matching", () => {
    it("matches ignore against basename", () => {
      const ignore = ["skip", "ignore"];
      const files = [
        { name: "keep.cdb", ignored: ignore.includes(legacyBasename("keep.cdb")) },
        { name: "skip.cdb", ignored: ignore.includes(legacyBasename("skip.cdb")) },
        { name: "ignore.cdb", ignored: ignore.includes(legacyBasename("ignore.cdb")) },
      ];

      expect(files[0].ignored).toBe(false);
      expect(files[1].ignored).toBe(true);
      expect(files[2].ignored).toBe(true);
    });

    it("matches ignore against full filename", () => {
      const ignore = ["cards.cdb.old"];

      expect(ignore.includes("cards.cdb.old")).toBe(true);
      expect(ignore.includes("cards.cdb")).toBe(false);
    });
  });
});
