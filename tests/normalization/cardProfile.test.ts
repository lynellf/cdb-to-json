/**
 * Tests for card profile mapping.
 *
 * Verifies that normalized cards are correctly transformed to cdb.card/2 format.
 */

import { describe, it, expect, vi } from "vitest";
import { mapCardToProfile, type CardProfileOutput } from "../../dist/profiles/cardProfile.js";
import type { NormalizedCard } from "../../dist/normalization/normalizeCard.js";
import type { TypeDecodeResult } from "../../dist/registry/cardTypes.v1.js";
import type { AttributeDecodeResult } from "../../dist/registry/attributes.v1.js";
import type { MonsterTypeDecodeResult } from "../../dist/registry/monsterTypes.v1.js";
import type { ProgressionDecodeResult } from "../../dist/registry/progression.v1.js";
import type { StatDecodeResult } from "../../dist/registry/stats.v1.js";
import type { LinkMarkerDecodeResult } from "../../dist/registry/linkMarkers.v1.js";
import type { SetcodeDecodeResult } from "../../dist/registry/setcodes.v1.js";
import type { AvailabilityDecodeResult } from "../../dist/registry/availability.v1.js";
import type { CategoryDecodeResult } from "../../dist/registry/categories.v1.js";
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";

// Helper to create a minimal normalized card for testing
function createNormalizedCard(overrides: Partial<NormalizedCard> = {}): NormalizedCard {
  const defaultCard: NormalizedCard = {
    id: "12345",
    name: "Dark Magician",
    description: "The ultimate wizard.",
    auxiliaryStrings: [],
    type: {
      cardKind: "MONSTER",
      traits: ["NORMAL"],
      rawValue: 0x1,
      unknownBits: 0,
      registry: "cdb-normalization/1",
    },
    attribute: {
      attributes: ["DARK"],
      primary: "DARK",
      rawValue: 0x10,
      unknownBits: 0,
    },
    monsterType: {
      monsterTypes: ["SPELLCASTER"],
      primary: "SPELLCASTER",
      rawValue: 0x2,
      unknownBits: 0,
    },
    progression: {
      level: 7,
      rank: null,
      linkRating: null,
      pendulum: null,
      field: 0x1,
      rawValue: 7,
      unknownBits: 0,
    },
    attack: { value: 2500, isNull: false, rawValue: 2500 },
    defense: { value: 2100, isNull: false, rawValue: 2100 },
    linkMarkers: null,
    setcodes: {
      setcodes: [],
      rawValue: 0,
      registry: "cdb-normalization/1",
    },
    availability: {
      codes: [],
      unknownBits: 0,
      rawValue: 0,
    },
    category: {
      codes: [],
      unknownBits: 0,
      rawValue: 0,
    },
    alias: null,
    source: {
      databasePath: "/test/cards.cdb",
      dataOrdinal: 1,
      textOrdinal: 1,
    },
  };

  return { ...defaultCard, ...overrides };
}

describe("Card Profile Mapping", () => {
  describe("schema identifier", () => {
    it("outputs cdb.card/2 schema", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.schema).toBe("cdb.card/2");
    });
  });

  describe("card kind handling", () => {
    it("maps normal monster", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "MONSTER",
          traits: ["NORMAL"],
          rawValue: 0x1,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.cardKind).toBe("MONSTER");
      expect(result.monster).not.toBeNull();
      expect(result.spell).toBeNull();
      expect(result.trap).toBeNull();
    });

    it("maps effect monster", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "MONSTER",
          traits: ["EFFECT"],
          rawValue: 0x2,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("EFFECT");
    });

    it("maps spell card", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "SPELL",
          traits: ["NORMAL"],
          rawValue: 0x40,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
        attribute: null,
        monsterType: null,
        progression: {
          level: null,
          rank: null,
          linkRating: null,
          pendulum: null,
          field: 0,
          rawValue: 0,
          unknownBits: 0,
        },
        attack: { value: null, isNull: true, rawValue: -2 },
        defense: { value: null, isNull: true, rawValue: -2 },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.cardKind).toBe("SPELL");
      expect(result.monster).toBeNull();
      expect(result.spell).not.toBeNull();
      expect(result.trap).toBeNull();
    });

    it("maps trap card", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "TRAP",
          traits: ["NORMAL"],
          rawValue: 0x10000000,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
        attribute: null,
        monsterType: null,
        progression: {
          level: null,
          rank: null,
          linkRating: null,
          pendulum: null,
          field: 0,
          rawValue: 0,
          unknownBits: 0,
        },
        attack: { value: null, isNull: true, rawValue: -2 },
        defense: { value: null, isNull: true, rawValue: -2 },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.cardKind).toBe("TRAP");
      expect(result.monster).toBeNull();
      expect(result.spell).toBeNull();
      expect(result.trap).not.toBeNull();
    });

    it("maps unknown kind", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "UNKNOWN",
          traits: [],
          rawValue: 0,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.cardKind).toBe("UNKNOWN");
    });
  });

  describe("identity mapping", () => {
    it("includes external ID", () => {
      const card = createNormalizedCard({ id: "999" });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.identity.externalIds).toHaveLength(1);
      expect(result.identity.externalIds[0].namespace).toBe("cdb");
      expect(result.identity.externalIds[0].value).toBe("999");
    });

    it("maps alias", () => {
      const card = createNormalizedCard({ alias: "12345" });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.identity.aliasOf).toBe("12345");
    });

    it("preserves null alias", () => {
      const card = createNormalizedCard({ alias: null });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.identity.aliasOf).toBeNull();
    });
  });

  describe("source information", () => {
    it("includes EDOPRO_CDB source kind", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123def456",
        databaseFileName: "cards.cdb",
      });

      expect(result.source.kind).toBe("EDOPRO_CDB");
    });

    it("includes database SHA-256", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123def456",
        databaseFileName: "cards.cdb",
      });

      expect(result.source.databaseSha256).toBe("abc123def456");
    });

    it("includes database filename", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "my-cards.cdb",
      });

      expect(result.source.databaseFileName).toBe("my-cards.cdb");
    });

    it("includes row ID", () => {
      const card = createNormalizedCard({ id: "98765" });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.source.rowId).toBe("98765");
    });

    it("includes normalization registry", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.source.normalizationRegistry).toBe("cdb-normalization/1");
    });
  });

  describe("monster section mapping", () => {
    it("maps level", () => {
      const card = createNormalizedCard({
        progression: {
          level: 7,
          rank: null,
          linkRating: null,
          pendulum: null,
          field: 0x1,
          rawValue: 7,
          unknownBits: 0,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.level).toBe(7);
    });

    it("maps rank for xyz monsters", () => {
      const card = createNormalizedCard({
        progression: {
          level: null,
          rank: 4,
          linkRating: null,
          pendulum: null,
          field: 0x2,
          rawValue: 4 + 0x1000,
          unknownBits: 0,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.rank).toBe(4);
      expect(result.monster!.level).toBeNull();
    });

    it("maps link rating for link monsters", () => {
      const card = createNormalizedCard({
        progression: {
          level: null,
          rank: null,
          linkRating: 3,
          pendulum: null,
          field: 0x3,
          rawValue: 3 + 0x2000,
          unknownBits: 0,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.linkRating).toBe(3);
      // Defense may still be set from the raw defense value
      // The key is that linkRating is populated
    });

    it("maps attribute", () => {
      const card = createNormalizedCard({
        attribute: {
          attributes: ["DARK"],
          primary: "DARK",
          rawValue: 0x10,
          unknownBits: 0,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.attribute).toBe("DARK");
    });

    it("maps attack and defense", () => {
      const card = createNormalizedCard({
        attack: { value: 2400, isNull: false, rawValue: 2400 },
        defense: { value: 2100, isNull: false, rawValue: 2100 },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.attack).toBe(2400);
      expect(result.monster!.defense).toBe(2100);
    });

    it("maps link arrows for link monsters", () => {
      const card = createNormalizedCard({
        linkMarkers: {
          markers: ["TOP_LEFT", "TOP", "TOP_RIGHT"],
          count: 3,
          rawValue: 0x21,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.monster!.linkArrows).toContain("TOP_LEFT");
      expect(result.monster!.linkArrows).toContain("TOP");
      expect(result.monster!.linkArrows).toContain("TOP_RIGHT");
    });
  });

  describe("text section mapping", () => {
    it("maps raw description", () => {
      const card = createNormalizedCard({
        description: "This is the card effect.",
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.text.raw).toBe("This is the card effect.");
    });

    it("maps null description", () => {
      const card = createNormalizedCard({
        description: null,
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.text.raw).toBeNull();
    });

    it("maps auxiliary strings", () => {
      const card = createNormalizedCard({
        auxiliaryStrings: [
          { index: 0, value: "First string" },
          { index: 1, value: null },
          { index: 2, value: "Third string" },
        ],
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.simulator.auxiliaryStrings).toHaveLength(3);
      expect(result.simulator.auxiliaryStrings[0].value).toBe("First string");
      expect(result.simulator.auxiliaryStrings[1].value).toBeNull();
    });
  });

  describe("archetypes mapping", () => {
    it("maps resolved setcodes with registry", () => {
      const card = createNormalizedCard({
        setcodes: {
          setcodes: [{ code: 0x1234 }],
          rawValue: 0x1234,
          registry: "cdb-normalization/1",
        },
      });
      const registry = new Map([[0x1234, "Dark Magician"]]);
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
        setcodeRegistry: registry,
      });

      expect(result.archetypes.codes).toContain(0x1234);
      expect(result.archetypes.resolved).toContain("Dark Magician");
      expect(result.archetypes.unresolved).not.toContain(0x1234);
    });

    it("keeps unresolved setcodes when registry not provided", () => {
      const card = createNormalizedCard({
        setcodes: {
          setcodes: [{ code: 0x1234 }],
          rawValue: 0x1234,
          registry: "cdb-normalization/1",
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.archetypes.codes).toContain(0x1234);
      expect(result.archetypes.resolved).not.toContain("Dark Magician");
      expect(result.archetypes.unresolved).toContain(0x1234);
    });

    it("maps multiple setcodes", () => {
      const card = createNormalizedCard({
        setcodes: {
          setcodes: [
            { code: 0x1234 },
            { code: 0x5678 },
          ],
          rawValue: 0x1234 | (0x5678 << 16),
          registry: "cdb-normalization/1",
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.archetypes.codes).toContain(0x1234);
      expect(result.archetypes.codes).toContain(0x5678);
    });
  });

  describe("simulator section mapping", () => {
    it("maps availability codes", () => {
      const card = createNormalizedCard({
        availability: {
          codes: ["OCG", "TCG"],
          unknownBits: 0,
          rawValue: 0x3,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.simulator.availability.codes).toContain("OCG");
      expect(result.simulator.availability.codes).toContain("TCG");
    });

    it("maps availability unknown bits", () => {
      const card = createNormalizedCard({
        availability: {
          codes: ["OCG"],
          unknownBits: 0x10,
          rawValue: 0x13,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.simulator.availability.unknownBits).toBe("0x10");
    });

    it("maps category codes", () => {
      const card = createNormalizedCard({
        category: {
          codes: ["PRINTED", "DSL"],
          unknownBits: 0,
          rawValue: 0x3,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.simulator.categoryFlags.codes).toContain("PRINTED");
      expect(result.simulator.categoryFlags.codes).toContain("DSL");
    });
  });

  describe("diagnostics handling", () => {
    it("includes provided diagnostics", () => {
      const card = createNormalizedCard();
      const diagnostics = [
        { code: "TEST_001", severity: "warning", message: "Test warning" },
      ];
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
        diagnostics,
      });

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe("TEST_001");
    });

    it("handles empty diagnostics", () => {
      const card = createNormalizedCard();
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("type line building", () => {
    it("builds type line for normal monster", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "MONSTER",
          traits: ["NORMAL"],
          rawValue: 0x1,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
        monsterType: {
          monsterTypes: ["SPELLCASTER"],
          primary: "SPELLCASTER",
          rawValue: 0x2,
          unknownBits: 0,
        },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.typeLine).not.toBeNull();
      expect(result.typeLine!.monsterType).toBe("SPELLCASTER");
    });

    it("returns null type line for non-monster", () => {
      const card = createNormalizedCard({
        type: {
          cardKind: "SPELL",
          traits: ["NORMAL"],
          rawValue: 0x40,
          unknownBits: 0,
          registry: "cdb-normalization/1",
        },
        attribute: null,
        monsterType: null,
        progression: {
          level: null,
          rank: null,
          linkRating: null,
          pendulum: null,
          field: 0,
          rawValue: 0,
          unknownBits: 0,
        },
        attack: { value: null, isNull: true, rawValue: -2 },
        defense: { value: null, isNull: true, rawValue: -2 },
      });
      const result = mapCardToProfile(card, {
        locale: "en",
        sourceNamespace: "cdb",
        databaseSha256: "abc123",
        databaseFileName: "cards.cdb",
      });

      expect(result.typeLine).toBeNull();
    });
  });
});
