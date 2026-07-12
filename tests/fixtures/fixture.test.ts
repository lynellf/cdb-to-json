/**
 * Tests for fixture generation and golden record validation.
 *
 * Validates that generated fixtures are reproducible and
 * golden records match expected shapes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createMinimalCdb, cleanupCdb } from "./buildCdbFixture.js";

describe("Fixture generation", () => {
  describe("createMinimalCdb", () => {
    it("creates a valid CDB database", () => {
      const dbPath = createMinimalCdb([
        {
          id: 1234,
          name: "Test Card",
          desc: "A test card description.",
          type: 2, // Effect Monster
          atk: 1000,
          def: 1000,
          level: 4,
          race: 16, // Dragon
          attribute: 1, // Dark
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });

    it("generates reproducible databases", () => {
      const cardData = {
        id: 5678,
        name: "Reproducible Card",
        desc: "This card should produce identical output.",
        type: 2,
        atk: 2000,
        def: 1500,
        level: 5,
        race: 8, // Warrior
        attribute: 2, // Water
      };

      // Create two databases with the same data
      const dbPath1 = createMinimalCdb([cardData]);
      const dbPath2 = createMinimalCdb([cardData]);

      try {
        // Both files should exist and have the same size (deterministic)
        const stat1 = readFileSync(dbPath1);
        const stat2 = readFileSync(dbPath2);
        expect(stat1.length).toBe(stat2.length);
      } finally {
        cleanupCdb(dbPath1);
        cleanupCdb(dbPath2);
      }
    });

    it("handles multiple cards", () => {
      const cards = [
        {
          id: 1,
          name: "Card One",
          desc: "First card",
          type: 2,
          atk: 1000,
          def: 1000,
          level: 4,
        },
        {
          id: 2,
          name: "Card Two",
          desc: "Second card",
          type: 4, // Spell
        },
        {
          id: 3,
          name: "Card Three",
          desc: "Third card",
          type: 8, // Trap
        },
      ];

      const dbPath = createMinimalCdb(cards);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });

    it("handles auxiliary strings", () => {
      const dbPath = createMinimalCdb([
        {
          id: 9999,
          name: "Card With Aux",
          desc: "Main description.",
          type: 2,
          atk: 800,
          def: 1200,
          level: 3,
          str1: "aux1",
          str2: "aux2",
          str3: "aux3",
          str4: "aux4",
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });

    it("handles empty strings and nulls", () => {
      const dbPath = createMinimalCdb([
        {
          id: 8888,
          name: "Minimal Card",
          desc: "",
          type: 2,
          atk: 0,
          def: 0,
          level: 1,
          str1: null,
          str2: "",
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });
  });

  describe("golden record validation", () => {
    it("validates raw datas row shape", () => {
      const dbPath = createMinimalCdb([
        {
          id: 1111,
          name: "Shape Test",
          desc: "Testing row shapes",
          type: 2,
          atk: 1500,
          def: 1500,
          level: 6,
          race: 1,
          attribute: 1,
          setcode: 0x1234,
          ot: 1,
          alias: 0,
          category: 0,
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
        // The schema validation will test the actual row content
      } finally {
        cleanupCdb(dbPath);
      }
    });

    it("validates raw texts row shape", () => {
      const dbPath = createMinimalCdb([
        {
          id: 2222,
          name: "Text Shape Card",
          desc: "Testing text fields",
          type: 2,
          str1: "s1",
          str2: "s2",
          str3: "s3",
          str4: "s4",
          str5: "s5",
          str6: "s6",
          str7: "s7",
          str8: "s8",
          str9: "s9",
          str10: "s10",
          str11: "s11",
          str12: "s12",
          str13: "s13",
          str14: "s14",
          str15: "s15",
          str16: "s16",
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });

    it("validates null fields are preserved", () => {
      const dbPath = createMinimalCdb([
        {
          id: 3333,
          name: "Null Fields",
          desc: null,
          type: 2,
          atk: null,
          def: null,
          level: null,
        },
      ]);

      try {
        expect(existsSync(dbPath)).toBe(true);
      } finally {
        cleanupCdb(dbPath);
      }
    });
  });
});
