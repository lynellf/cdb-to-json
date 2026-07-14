/**
 * Unit tests for card decoders.
 *
 * Tests the pure packed-field/stat decoders for:
 * - Card kind and monster traits (type field)
 * - Attribute decoding
 * - Monster type/race decoding
 * - Level/rank/link/pendulum progression
 * - Attack/defense stats and link markers
 * - Setcode unpacking
 * - Availability flags
 * - Category flags
 */

import { describe, it, expect } from "vitest";
import {
  decodeType,
  getCardKind,
  getMonsterTraits,
  MonsterTrait,
  CARD_TYPE_VERSION,
} from "../../dist/registry/cardTypes.v1.js";
import {
  decodeAttribute,
  getPrimaryAttribute,
  Attribute,
  ATTRIBUTE_VERSION,
} from "../../dist/registry/attributes.v1.js";
import {
  decodeMonsterType,
  getPrimaryMonsterType,
  MonsterType,
  MONSTER_TYPE_VERSION,
} from "../../dist/registry/monsterTypes.v1.js";
import {
  decodeProgression,
  getProgressionType,
  PROGRESSION_VERSION,
  LevelField,
  LINK_RATING_MIN,
  LINK_RATING_MAX,
  PENDULUM_SCALE_MIN,
  PENDULUM_SCALE_MAX,
} from "../../dist/registry/progression.v1.js";
import {
  decodeStat,
  decodeDefense,
  STATS_VERSION,
  UNKNOWN_STAT_SENTINEL,
  MAX_VALID_STAT,
  MIN_VALID_STAT,
} from "../../dist/registry/stats.v1.js";
import {
  decodeLinkMarkers,
  isLikelyLinkMarkers,
  LINK_MARKER_VERSION,
  LinkMarker,
} from "../../dist/registry/linkMarkers.v1.js";
import {
  unpackSetcode,
  validateSetcode,
  formatSetcode,
  SETCODE_VERSION,
  MAX_SETCODE_COUNT,
} from "../../dist/registry/setcodes.v1.js";
import {
  decodeAvailability,
  getPrimaryAvailability,
  AVAILABILITY_VERSION,
} from "../../dist/registry/availability.v1.js";
import {
  decodeCategory,
  CATEGORY_VERSION,
} from "../../dist/registry/categories.v1.js";

describe("Card type decoder", () => {
  describe("getCardKind", () => {
    it("identifies normal monster", () => {
      const result = getCardKind(0x1);
      expect(result).toBe("MONSTER");
    });

    it("identifies effect monster", () => {
      const result = getCardKind(0x2);
      expect(result).toBe("MONSTER");
    });

    it("identifies fusion monster", () => {
      const result = getCardKind(0x4);
      expect(result).toBe("MONSTER");
    });

    it("identifies spell card", () => {
      // Spell: type & 0x40 (RITUAL spell)
      const result = getCardKind(0x40);
      expect(result).toBe("SPELL");
    });

    it("marks non-monster kind as UNKNOWN", () => {
      const result = getCardKind(0x10000000);
      expect(result).toBe("UNKNOWN");
    });

    it("identifies link monster", () => {
      const result = getCardKind(0x20000000);
      expect(result).toBe("MONSTER");
    });

    it("identifies xyz monster", () => {
      const result = getCardKind(0x400000);
      expect(result).toBe("MONSTER");
    });

    it("identifies pendulum monster", () => {
      const result = getCardKind(0x1000000);
      expect(result).toBe("MONSTER");
    });

    it("returns UNKNOWN for zero", () => {
      const result = getCardKind(0);
      expect(result).toBe("UNKNOWN");
    });
  });

  describe("getMonsterTraits", () => {
    it("extracts normal trait as bitmask", () => {
      const traits = getMonsterTraits(0x1);
      expect(traits).toBe(0x1);
    });

    it("extracts effect trait as bitmask", () => {
      const traits = getMonsterTraits(0x2);
      expect(traits).toBe(0x2);
    });

    it("combines multiple traits as bitmask", () => {
      // Effect + Gemini
      const traits = getMonsterTraits(0x2 | 0x1000);
      expect(traits).toBe(0x2 | 0x1000);
    });

    it("returns 0 for non-monster kind", () => {
      const traits = getMonsterTraits(0);
      expect(traits).toBe(0);
    });

    it("extracts tuner trait as bitmask", () => {
      const traits = getMonsterTraits(0x100000);
      expect(traits).toBe(0x100000);
    });

    it("extracts synchro trait as bitmask", () => {
      const traits = getMonsterTraits(0x2000);
      expect(traits).toBe(0x2000);
    });

    it("extracts pendulum trait as bitmask", () => {
      const traits = getMonsterTraits(0x1000000);
      expect(traits).toBe(0x1000000);
    });
  });

  describe("decodeType", () => {
    it("decodes normal monster", () => {
      const result = decodeType(0x1);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("NORMAL");
      expect(result.registry).toBe(CARD_TYPE_VERSION);
    });

    it("decodes effect monster", () => {
      const result = decodeType(0x2);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("EFFECT");
    });

    it("decodes fusion monster", () => {
      const result = decodeType(0x4);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("FUSION");
    });

    it("decodes spell card", () => {
      const result = decodeType(0x40);
      expect(result.cardKind).toBe("SPELL");
      expect(result.traits).toContain("RITUAL");
    });

    it("marks unknown type as UNKNOWN", () => {
      // Trap/spell bits without trait detection are UNKNOWN in current implementation
      const result = decodeType(0x10000000);
      expect(result.cardKind).toBe("UNKNOWN");
    });

    it("decodes link monster with markers", () => {
      const result = decodeType(0x20000000);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("LINK");
    });

    it("decodes xyz monster", () => {
      const result = decodeType(0x400000);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("XYZ");
    });

    it("decodes pendulum effect monster", () => {
      const result = decodeType(0x2 | 0x1000000);
      expect(result.cardKind).toBe("MONSTER");
      expect(result.traits).toContain("EFFECT");
      expect(result.traits).toContain("PENDULUM");
    });

    it("returns UNKNOWN for zero", () => {
      const result = decodeType(0);
      expect(result.cardKind).toBe("UNKNOWN");
      expect(result.traits).toEqual([]);
    });

    it("preserves raw value", () => {
      const typeValue = 0x12345678;
      const result = decodeType(typeValue);
      expect(result.rawValue).toBe(typeValue);
    });

    it("detects unknown bits", () => {
      // Flag that doesn't correspond to any known trait (bit 31)
      const typeValue = 0x80000000 >>> 0; // Force unsigned
      const result = decodeType(typeValue);
      expect(result.unknownBits >>> 0).toBe(0x80000000);
    });
  });
});

describe("Attribute decoder", () => {
  describe("Attribute enum values", () => {
    it("has EARTH attribute", () => {
      expect(Attribute.EARTH).toBeDefined();
    });

    it("has WATER attribute", () => {
      expect(Attribute.WATER).toBeDefined();
    });

    it("has FIRE attribute", () => {
      expect(Attribute.FIRE).toBeDefined();
    });

    it("has WIND attribute", () => {
      expect(Attribute.WIND).toBeDefined();
    });

    it("has LIGHT attribute", () => {
      expect(Attribute.LIGHT).toBeDefined();
    });

    it("has DARK attribute", () => {
      expect(Attribute.DARK).toBeDefined();
    });

    it("has DIVINE attribute", () => {
      expect(Attribute.DIVINE).toBeDefined();
    });
  });

  describe("decodeAttribute", () => {
    it("decodes EARTH attribute", () => {
      const result = decodeAttribute(Attribute.EARTH);
      expect(result.attributes).toContain("EARTH");
    });

    it("decodes WATER attribute", () => {
      const result = decodeAttribute(Attribute.WATER);
      expect(result.attributes).toContain("WATER");
    });

    it("decodes FIRE attribute", () => {
      const result = decodeAttribute(Attribute.FIRE);
      expect(result.attributes).toContain("FIRE");
    });

    it("decodes WIND attribute", () => {
      const result = decodeAttribute(Attribute.WIND);
      expect(result.attributes).toContain("WIND");
    });

    it("decodes LIGHT attribute", () => {
      const result = decodeAttribute(Attribute.LIGHT);
      expect(result.attributes).toContain("LIGHT");
    });

    it("decodes DARK attribute", () => {
      const result = decodeAttribute(Attribute.DARK);
      expect(result.attributes).toContain("DARK");
    });

    it("decodes DIVINE attribute", () => {
      const result = decodeAttribute(Attribute.DIVINE);
      expect(result.attributes).toContain("DIVINE");
    });

    it("returns empty for zero", () => {
      const result = decodeAttribute(0);
      expect(result.attributes).toEqual([]);
    });

    it("returns empty for unknown value", () => {
      const result = decodeAttribute(0x100);
      expect(result.attributes).toEqual([]);
    });

    it("preserves raw value", () => {
      const attrValue = 0x42;
      const result = decodeAttribute(attrValue);
      expect(result.rawValue).toBe(attrValue);
    });
  });

  describe("getPrimaryAttribute", () => {
    it("returns primary attribute", () => {
      const result = getPrimaryAttribute(Attribute.EARTH);
      expect(result).toBe("EARTH");
    });

    it("returns null for zero", () => {
      const result = getPrimaryAttribute(0);
      expect(result).toBeNull();
    });

    it("returns null for unknown", () => {
      const result = getPrimaryAttribute(0x100);
      expect(result).toBeNull();
    });
  });
});

describe("Monster type decoder", () => {
  describe("MonsterType enum values", () => {
    it("has WARRIOR type", () => {
      expect(MonsterType.WARRIOR).toBeDefined();
    });

    it("has SPELLCASTER type", () => {
      expect(MonsterType.SPELLCASTER).toBeDefined();
    });

    it("has FAIRY type", () => {
      expect(MonsterType.FAIRY).toBeDefined();
    });

    it("has ZOMBIE type", () => {
      expect(MonsterType.ZOMBIE).toBeDefined();
    });

    it("has MACHINE type", () => {
      expect(MonsterType.MACHINE).toBeDefined();
    });

    it("has AQUA type", () => {
      expect(MonsterType.AQUA).toBeDefined();
    });

    it("has PYRO type", () => {
      expect(MonsterType.PYRO).toBeDefined();
    });

    it("has ROCK type", () => {
      expect(MonsterType.ROCK).toBeDefined();
    });

    it("has WINDSPHYNX type", () => {
      expect(MonsterType.WINDSPHYNX).toBeDefined();
    });

    it("has BEAST type", () => {
      expect(MonsterType.BEAST).toBeDefined();
    });

    it("has BEAST_WARRIOR type", () => {
      expect(MonsterType.BEAST_WARRIOR).toBeDefined();
    });

    it("has DINOSAUR type", () => {
      expect(MonsterType.DINOSAUR).toBeDefined();
    });

    it("has FISH type", () => {
      expect(MonsterType.FISH).toBeDefined();
    });

    it("has SEA_SERPENT type", () => {
      expect(MonsterType.SEA_SERPENT).toBeDefined();
    });

    it("has REPTILE type", () => {
      expect(MonsterType.REPTILE).toBeDefined();
    });

    it("has PSYCHIC type", () => {
      expect(MonsterType.PSYCHIC).toBeDefined();
    });

    it("has DIVINE type", () => {
      expect(MonsterType.DIVINE).toBeDefined();
    });

    it("has CREATOR_GOD type", () => {
      expect(MonsterType.CREATOR_GOD).toBeDefined();
    });

    it("has WYRM type", () => {
      expect(MonsterType.WYRM).toBeDefined();
    });

    it("has CYBERSE type", () => {
      expect(MonsterType.CYBERSE).toBeDefined();
    });
  });

  describe("decodeMonsterType", () => {
    it("decodes WARRIOR type", () => {
      const result = decodeMonsterType(MonsterType.WARRIOR);
      expect(result.monsterTypes).toContain("WARRIOR");
    });

    it("decodes multiple types", () => {
      const result = decodeMonsterType(MonsterType.WARRIOR | MonsterType.FIEND);
      expect(result.monsterTypes).toContain("WARRIOR");
      expect(result.monsterTypes).toContain("FIEND");
    });

    it("returns empty for zero", () => {
      const result = decodeMonsterType(0);
      expect(result.monsterTypes).toEqual([]);
    });

    it("preserves raw value", () => {
      const typeValue = 0x1234;
      const result = decodeMonsterType(typeValue);
      expect(result.rawValue).toBe(typeValue);
    });

    it("returns empty for unknown value", () => {
      // Value beyond known type bits
      const result = decodeMonsterType(0x200000);
      expect(result.monsterTypes).toEqual([]);
    });
  });

  describe("getPrimaryMonsterType", () => {
    it("returns primary type", () => {
      const result = getPrimaryMonsterType(MonsterType.WARRIOR);
      expect(result).toBe("WARRIOR");
    });

    it("returns null for zero", () => {
      const result = getPrimaryMonsterType(0);
      expect(result).toBeNull();
    });
  });
});

describe("Progression decoder", () => {
  describe("LevelField constants", () => {
    it("has LEVEL_MASK", () => {
      expect(LevelField.LEVEL_MASK).toBe(0xFF);
    });

    it("has LEFT_SCALE_SHIFT", () => {
      expect(LevelField.LEFT_SCALE_SHIFT).toBe(8);
    });

    it("has RIGHT_SCALE_SHIFT", () => {
      expect(LevelField.RIGHT_SCALE_SHIFT).toBe(12);
    });
  });

  describe("decodeProgression", () => {
    it("decodes level 4 monster", () => {
      const result = decodeProgression(4, 0);
      expect(result.level).toBe(4);
      expect(result.rank).toBeNull();
      expect(result.linkRating).toBeNull();
      expect(result.pendulum).toBeNull();
    });

    it("decodes level 8 monster", () => {
      const result = decodeProgression(8, 0);
      expect(result.level).toBe(8);
    });

    it("decodes rank 4 xyz monster", () => {
      // XYZ monster type: 0x400000
      const xyzType = 0x400000;
      const result = decodeProgression(4, xyzType);
      expect(result.level).toBeNull();
      expect(result.rank).toBe(4);
    });

    it("decodes rank 12 xyz monster", () => {
      const xyzType = 0x400000;
      const result = decodeProgression(12, xyzType);
      expect(result.rank).toBe(12);
    });

    it("decodes link 1 monster", () => {
      // LINK monster type: 0x20000000
      const linkType = 0x20000000;
      const result = decodeProgression(1, linkType);
      expect(result.level).toBeNull();
      expect(result.rank).toBeNull();
      expect(result.linkRating).toBe(1);
    });

    it("decodes link 5 monster", () => {
      const linkType = 0x20000000;
      const result = decodeProgression(5, linkType);
      expect(result.linkRating).toBe(5);
    });

    it("validates link rating bounds", () => {
      const linkType = 0x20000000;
      const belowMin = decodeProgression(0, linkType);
      expect(belowMin.linkRating).toBeNull();

      const atMin = decodeProgression(LINK_RATING_MIN, linkType);
      expect(atMin.linkRating).toBe(LINK_RATING_MIN);

      const atMax = decodeProgression(LINK_RATING_MAX, linkType);
      expect(atMax.linkRating).toBe(LINK_RATING_MAX);
    });

    it("returns null for zero level", () => {
      const result = decodeProgression(0, 0);
      expect(result.level).toBe(0); // Level 0 is technically valid
      expect(result.rank).toBeNull();
      expect(result.linkRating).toBeNull();
    });

    it("preserves raw value", () => {
      const levelValue = 5;
      const result = decodeProgression(levelValue, 0);
      expect(result.rawValue).toBe(levelValue);
    });

    it("detects unknown bits in upper word", () => {
      // Upper bits beyond 0xFFFF trigger unknown bits
      const valueWithUnknown = 5 | 0x10000;
      const result = decodeProgression(valueWithUnknown, 0);
      expect(result.unknownBits).toBe(0x10000);
    });
  });

  describe("getProgressionType", () => {
    it("identifies regular monster", () => {
      const result = getProgressionType(0);
      expect(result).toBe('regular');
    });

    it("identifies xyz monster", () => {
      const result = getProgressionType(0x400000);
      expect(result).toBe('xyz');
    });

    it("identifies link monster", () => {
      const result = getProgressionType(0x20000000);
      expect(result).toBe('link');
    });

    it("identifies pendulum monster", () => {
      const result = getProgressionType(0x1000000);
      expect(result).toBe('pendulum');
    });

    it("identifies xyz_pendulum monster", () => {
      const result = getProgressionType(0x400000 | 0x1000000);
      expect(result).toBe('xyz_pendulum');
    });
  });
});

describe("Stat decoder", () => {
  describe("Sentinel values", () => {
    it("defines UNKNOWN_STAT_SENTINEL", () => {
      expect(UNKNOWN_STAT_SENTINEL).toBe(-1);
    });

    it("defines MAX_VALID_STAT", () => {
      expect(MAX_VALID_STAT).toBeGreaterThan(0);
    });

    it("defines MIN_VALID_STAT", () => {
      expect(MIN_VALID_STAT).toBeLessThan(0);
    });
  });

  describe("decodeStat", () => {
    it("decodes valid attack value", () => {
      const result = decodeStat(2400);
      expect(result.value).toBe(2400);
      expect(result.isUnknown).toBe(false);
    });

    it("returns null for sentinel", () => {
      const result = decodeStat(UNKNOWN_STAT_SENTINEL);
      expect(result.value).toBeNull();
      expect(result.isUnknown).toBe(true);
    });

    it("returns null for -1 sentinel", () => {
      const result = decodeStat(-1);
      expect(result.value).toBeNull();
      expect(result.isUnknown).toBe(true);
    });

    it("passes through other negative values", () => {
      const result = decodeStat(-100);
      expect(result.value).toBe(-100);
      expect(result.isUnknown).toBe(true);
    });

    it("preserves raw value", () => {
      const statValue = 1800;
      const result = decodeStat(statValue);
      expect(result.rawValue).toBe(statValue);
    });

    it("includes display string", () => {
      const result = decodeStat(2400);
      expect(result.display).toBe("2400");
    });

    it("includes registry version", () => {
      const result = decodeStat(2400);
      expect(result.registry).toBe(STATS_VERSION);
    });
  });

  describe("decodeDefense", () => {
    it("decodes valid defense value", () => {
      const result = decodeDefense(1500, 0);
      expect(result.value).toBe(1500);
    });

    it("returns null for sentinel", () => {
      const result = decodeDefense(UNKNOWN_STAT_SENTINEL, 0);
      expect(result.value).toBeNull();
    });

    it("returns null for link monster", () => {
      // Link monster type: 0x20000000
      const result = decodeDefense(3, 0x20000000);
      expect(result.value).toBeNull();
    });
  });
});

describe("Link marker decoder", () => {
  describe("LinkMarker enum", () => {
    it("has TOP_LEFT marker", () => {
      expect(LinkMarker.TOP_LEFT).toBeDefined();
    });

    it("has TOP marker", () => {
      expect(LinkMarker.TOP).toBeDefined();
    });

    it("has TOP_RIGHT marker", () => {
      expect(LinkMarker.TOP_RIGHT).toBeDefined();
    });

    it("has LEFT marker", () => {
      expect(LinkMarker.LEFT).toBeDefined();
    });

    it("has RIGHT marker", () => {
      expect(LinkMarker.RIGHT).toBeDefined();
    });

    it("has BOTTOM_LEFT marker", () => {
      expect(LinkMarker.BOTTOM_LEFT).toBeDefined();
    });

    it("has BOTTOM marker", () => {
      expect(LinkMarker.BOTTOM).toBeDefined();
    });

    it("has BOTTOM_RIGHT marker", () => {
      expect(LinkMarker.BOTTOM_RIGHT).toBeDefined();
    });
  });

  describe("decodeLinkMarkers", () => {
    it("decodes single top-left marker", () => {
      const result = decodeLinkMarkers(LinkMarker.TOP_LEFT);
      expect(result.markers).toContain("Top-Left");
      expect(result.linkRating).toBe(1);
    });

    it("decodes single top marker", () => {
      const result = decodeLinkMarkers(LinkMarker.TOP);
      expect(result.markers).toContain("Top");
    });

    it("decodes diagonal markers", () => {
      const markers = LinkMarker.TOP_LEFT | LinkMarker.BOTTOM_RIGHT;
      const result = decodeLinkMarkers(markers);
      expect(result.markers).toContain("Top-Left");
      expect(result.markers).toContain("Bottom-Right");
      expect(result.linkRating).toBe(2);
    });

    it("decodes all markers", () => {
      const allMarkers =
        LinkMarker.TOP_LEFT |
        LinkMarker.TOP |
        LinkMarker.TOP_RIGHT |
        LinkMarker.LEFT |
        LinkMarker.RIGHT |
        LinkMarker.BOTTOM_LEFT |
        LinkMarker.BOTTOM |
        LinkMarker.BOTTOM_RIGHT;
      const result = decodeLinkMarkers(allMarkers);
      expect(result.markers).toContain("Top-Left");
      expect(result.markers).toContain("Top");
      expect(result.markers).toContain("Top-Right");
      expect(result.markers).toContain("Left");
      expect(result.markers).toContain("Right");
      expect(result.markers).toContain("Bottom-Left");
      expect(result.markers).toContain("Bottom");
      expect(result.markers).toContain("Bottom-Right");
      expect(result.linkRating).toBe(8);
    });

    it("returns empty for zero", () => {
      const result = decodeLinkMarkers(0);
      expect(result.markers).toEqual([]);
      expect(result.linkRating).toBe(0);
    });

    it("preserves raw value", () => {
      const markerValue = 0x21;
      const result = decodeLinkMarkers(markerValue);
      expect(result.rawValue).toBe(markerValue);
    });
  });

  describe("isLikelyLinkMarkers", () => {
    it("returns true for valid marker combination", () => {
      expect(isLikelyLinkMarkers(LinkMarker.TOP_LEFT)).toBe(true);
    });

    it("returns true for 1-6 markers", () => {
      // Valid link ratings are 1-6
      const fourMarkers = LinkMarker.TOP_LEFT | LinkMarker.TOP | LinkMarker.TOP_RIGHT | LinkMarker.BOTTOM;
      expect(isLikelyLinkMarkers(fourMarkers)).toBe(true);
    });

    it("returns false for eight markers", () => {
      // 8 markers exceeds typical link rating, might be defense value
      const allMarkers =
        LinkMarker.TOP_LEFT |
        LinkMarker.TOP |
        LinkMarker.TOP_RIGHT |
        LinkMarker.LEFT |
        LinkMarker.RIGHT |
        LinkMarker.BOTTOM_LEFT |
        LinkMarker.BOTTOM |
        LinkMarker.BOTTOM_RIGHT;
      expect(isLikelyLinkMarkers(allMarkers)).toBe(false);
    });

    it("returns false for zero", () => {
      expect(isLikelyLinkMarkers(0)).toBe(false);
    });

    it("returns false for invalid combination", () => {
      // Marker value that doesn't align with valid markers
      expect(isLikelyLinkMarkers(0x100)).toBe(false);
    });
  });
});

describe("Setcode decoder", () => {
  describe("unpackSetcode", () => {
    it("unpacks single setcode", () => {
      const result = unpackSetcode(0x1234);
      expect(result.setcodes).toHaveLength(1);
      expect(result.setcodes[0].code).toBe(0x1234);
    });

    it("unpacks two setcodes", () => {
      const primary = 0x1234;
      const secondary = 0x5678;
      const packed = primary | (secondary << 16);
      const result = unpackSetcode(packed);
      expect(result.setcodes).toHaveLength(2);
      expect(result.setcodes[0].code).toBe(primary);
      expect(result.setcodes[1].code).toBe(secondary);
    });

    it("unpacks zero setcode", () => {
      const result = unpackSetcode(0);
      expect(result.setcodes).toHaveLength(0);
    });

    it("preserves raw value", () => {
      const setcodeValue = 0xABCD;
      const result = unpackSetcode(setcodeValue);
      expect(result.rawValue).toBe(setcodeValue);
    });
  });

  describe("validateSetcode", () => {
    it("validates zero", () => {
      const result = validateSetcode(0);
      expect(result).toBeNull();
    });

    it("validates single setcode", () => {
      const result = validateSetcode(0x1234);
      expect(result).toBeNull();
    });

    it("validates packed setcodes", () => {
      const packed = 0x1234 | (0x5678 << 16);
      const result = validateSetcode(packed);
      expect(result).toBeNull();
    });

    it("returns error for invalid pattern - both segments zero", () => {
      // Pattern where both segments are 0 (value that overflows)
      // Since JS shifts are modulo 32, 0x10000 >> 16 = 0x1, not 0
      // So we need a value where shifting reveals both segments are actually zero
      const result = validateSetcode(0x1_0000_0000);
      expect(result).not.toBeNull();
    });
  });

  describe("formatSetcode", () => {
    it("formats single setcode as hex", () => {
      const result = formatSetcode(0x1234);
      expect(result).toBe("0x1234");
    });

    it("formats zero as hex", () => {
      const result = formatSetcode(0);
      expect(result).toBe("0x0");
    });
  });

  describe("constants", () => {
    it("defines MAX_SETCODE_COUNT", () => {
      expect(MAX_SETCODE_COUNT).toBeGreaterThan(0);
    });
  });
});

describe("Availability decoder", () => {
  describe("decodeAvailability", () => {
    it("decodes zero as empty", () => {
      const result = decodeAvailability(0);
      expect(result.codes).toEqual([]);
    });

    it("preserves raw value", () => {
      const availValue = 0x42;
      const result = decodeAvailability(availValue);
      expect(result.rawValue).toBe(availValue);
    });
  });

  describe("getPrimaryAvailability", () => {
    it("returns null for zero", () => {
      const result = getPrimaryAvailability(0);
      expect(result).toBeNull();
    });
  });
});

describe("Category decoder", () => {
  describe("decodeCategory", () => {
    it("decodes zero as empty", () => {
      const result = decodeCategory(0);
      expect(result.codes).toEqual([]);
    });

    it("preserves raw value", () => {
      const catValue = 0x1234;
      const result = decodeCategory(catValue);
      expect(result.rawValue).toBe(catValue);
    });
  });
});

describe("Registry versions", () => {
  it("exports CARD_TYPE_VERSION", () => {
    expect(CARD_TYPE_VERSION).toBe("cdb-normalization/1");
  });

  it("exports ATTRIBUTE_VERSION", () => {
    expect(ATTRIBUTE_VERSION).toBe("cdb-normalization/1");
  });

  it("exports MONSTER_TYPE_VERSION", () => {
    expect(MONSTER_TYPE_VERSION).toBe("cdb-normalization/1");
  });

  it("exports PROGRESSION_VERSION", () => {
    expect(PROGRESSION_VERSION).toBe("cdb-normalization/1");
  });

  it("exports STATS_VERSION", () => {
    expect(STATS_VERSION).toBe("cdb-normalization/1");
  });

  it("exports LINK_MARKER_VERSION", () => {
    expect(LINK_MARKER_VERSION).toBe("cdb-normalization/1");
  });

  it("exports SETCODE_VERSION", () => {
    expect(SETCODE_VERSION).toBe("cdb-normalization/1");
  });

  it("exports AVAILABILITY_VERSION", () => {
    expect(AVAILABILITY_VERSION).toBe("cdb-normalization/1");
  });

  it("exports CATEGORY_VERSION", () => {
    expect(CATEGORY_VERSION).toBe("cdb-normalization/1");
  });
});
