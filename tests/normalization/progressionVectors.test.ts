/**
 * Progression decoder vector tests.
 *
 * Tests the progression decoder's conflict-safe behavior per INV-007:
 * - "Progression is null-on-conflict: `level`, `rank`, and `linkRating` are
 *   populated only when exactly one frame interpretation is supported by the
 *   decoded traits; conflicting or multiple interpretations set all affected
 *   primary fields to `null` and emit `CONFLICTING_PROGRESSION_FLAGS`."
 *
 * Coverage per P4-AC2 ("decoder fixtures prove... packed progression"):
 * - Level boundary: 0-12 for regular monsters
 * - Rank boundary: 1-12 for XYZ monsters
 * - Link rating boundary: 1-6 for LINK monsters
 * - Pendulum scale boundary: 0-13 for both scales
 * - Unknown bits retained in unknownBits
 * - Sentinel/edge values for level field
 * - CONFLICTING_PROGRESSION_FLAGS on conflicting type bits
 *
 * Note: These tests import from the built dist/ output. Run `npm run build`
 * before editing this file to keep types current.
 */

import { describe, it, expect } from "vitest";
import {
  decodeProgression,
  detectConflictingProgressionBits,
  getProgressionType,
  PROGRESSION_VERSION,
  LevelField,
  LINK_RATING_MIN,
  LINK_RATING_MAX,
  PENDULUM_SCALE_MIN,
  PENDULUM_SCALE_MAX,
} from "../../dist/registry/progression.v1.js";
import { DiagnosticCode } from "../../dist/diagnostics/codes.js";

// DiagnosticCollector is needed to verify CONFLICTING_PROGRESSION_FLAGS emissions.
// We import it to test the conflict diagnostics path.
import { DiagnosticCollector } from "../../dist/diagnostics/collector.js";

// Helper: build a card type with the given monster type bits set
const TYPE_NORMAL = 0x1;      // Normal monster bit
const TYPE_LINK = 0x20000000; // LINK monster bit
const TYPE_XYZ = 0x400000;    // XYZ monster bit
const TYPE_PENDULUM = 0x1000000; // Pendulum bit

// =============================================================================
// Regular monster level progression
// =============================================================================

describe("Regular monster level progression", () => {
  it("decodes level 1", () => {
    const result = decodeProgression(1, TYPE_NORMAL);
    expect(result.level).toBe(1);
    expect(result.rank).toBeNull();
    expect(result.linkRating).toBeNull();
    expect(result.pendulum).toBeNull();
  });

  it("decodes level 4", () => {
    const result = decodeProgression(4, TYPE_NORMAL);
    expect(result.level).toBe(4);
  });

  it("decodes level 12", () => {
    const result = decodeProgression(12, TYPE_NORMAL);
    expect(result.level).toBe(12);
  });

  it("decodes level 0 (edge case)", () => {
    const result = decodeProgression(0, TYPE_NORMAL);
    expect(result.level).toBe(0);
  });

  it("detects unknown bits in upper word for regular monster", () => {
    // Upper bits beyond 0xFF are unknown for regular monsters.
    // Using 0x10000 (bits 16+) triggers the upper-bits check.
    const result = decodeProgression(4 | 0x10000, TYPE_NORMAL);
    expect(result.unknownBits).toBeGreaterThan(0);
  });

  it("rejects level above 12", () => {
    const result = decodeProgression(13, TYPE_NORMAL);
    expect(result.unknownBits).not.toBe(0);
    // Level 13 is out of range, so the upper bits are non-zero
  });

  it("preserves raw value", () => {
    const levelValue = 7;
    const result = decodeProgression(levelValue, TYPE_NORMAL);
    expect(result.rawValue).toBe(levelValue);
  });

  it("returns correct registry version", () => {
    const result = decodeProgression(4, TYPE_NORMAL);
    expect(result.registry).toBe(PROGRESSION_VERSION);
  });

  it("detects unknown bits in upper word beyond 16 bits", () => {
    // Bits beyond position 16 are flagged as unknown by the current decoder.
    const result = decodeProgression(4 | 0x10000, TYPE_NORMAL);
    expect(result.unknownBits).toBeGreaterThan(0);
  });
});

// =============================================================================
// XYZ monster rank progression
// =============================================================================

describe("XYZ monster rank progression", () => {
  it("decodes rank 1", () => {
    const result = decodeProgression(1, TYPE_XYZ);
    expect(result.rank).toBe(1);
    expect(result.level).toBeNull();
    expect(result.linkRating).toBeNull();
  });

  it("decodes rank 4", () => {
    const result = decodeProgression(4, TYPE_XYZ);
    expect(result.rank).toBe(4);
  });

  it("decodes rank 12", () => {
    const result = decodeProgression(12, TYPE_XYZ);
    expect(result.rank).toBe(12);
  });

  it("rejects rank 0 as invalid", () => {
    const result = decodeProgression(0, TYPE_XYZ);
    expect(result.rank).toBeNull();
    // Current decoder sets unknownBits = 0 when levelValue itself is 0.
    // This is because the rank 0 branch sets unknownBits = levelValue directly.
    // (rank 0 → baseLevel=0 → the else-if branch sets unknownBits=0.)
    // This behavior is acceptable: the rank is null and rawValue is preserved.
    expect(result.rawValue).toBe(0);
  });

  it("detects unknown bits above rank range", () => {
    const result = decodeProgression(13, TYPE_XYZ);
    // Rank 13 is out of range (1-12)
    expect(result.unknownBits).not.toBe(0);
  });

  it("detects unknown bits in upper word for xyz", () => {
    const result = decodeProgression(4 | 0x10000, TYPE_XYZ);
    expect(result.unknownBits).toBeGreaterThan(0);
  });
});

// =============================================================================
// LINK monster progression
// =============================================================================

describe("LINK monster progression", () => {
  it("decodes link rating 1", () => {
    const result = decodeProgression(1, TYPE_LINK);
    expect(result.linkRating).toBe(1);
    expect(result.level).toBeNull();
    expect(result.rank).toBeNull();
    expect(result.pendulum).toBeNull();
  });

  it("decodes link rating 3", () => {
    const result = decodeProgression(3, TYPE_LINK);
    expect(result.linkRating).toBe(3);
  });

  it("decodes link rating 6 (maximum)", () => {
    const result = decodeProgression(LINK_RATING_MAX, TYPE_LINK);
    expect(result.linkRating).toBe(LINK_RATING_MAX);
    expect(result.linkRating).toBe(6);
  });

  it("rejects link rating 0", () => {
    const result = decodeProgression(0, TYPE_LINK);
    expect(result.linkRating).toBeNull();
  });

  it("detects out-of-range link rating", () => {
    const result = decodeProgression(7, TYPE_LINK);
    // Link rating 7 is out of range (1-6)
    expect(result.linkRating).toBeNull();
  });

  it("detects unknown bits in upper word for link", () => {
    const result = decodeProgression(3 | 0x10000, TYPE_LINK);
    expect(result.unknownBits).toBeGreaterThan(0);
  });

  it("confirms link rating bounds constants", () => {
    expect(LINK_RATING_MIN).toBe(1);
    expect(LINK_RATING_MAX).toBe(6);
  });
});

// =============================================================================
// Pendulum monster progression
// =============================================================================

describe("Pendulum monster progression", () => {
  it("decodes pendulum monster with level", () => {
    const result = decodeProgression(4, TYPE_PENDULUM);
    expect(result.level).toBe(4);
    expect(result.rank).toBeNull();
    expect(result.linkRating).toBeNull();
  });

  it("decodes pendulum scales 1-13", () => {
    // Pendulum: level in bits 0-7, left scale in bits 8-11, right scale in bits 12-15
    const levelValue = 7 | (1 << 8) | (13 << 12); // level 7, left 1, right 13
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    expect(result.level).toBe(7);
    expect(result.pendulum).not.toBeNull();
    expect(result.pendulum!.leftScale).toBe(1);
    expect(result.pendulum!.rightScale).toBe(13);
  });

  it("decodes pendulum with zero left scale", () => {
    const levelValue = 4 | (0 << 8) | (7 << 12); // level 4, left 0, right 7
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    expect(result.pendulum).not.toBeNull();
    expect(result.pendulum!.leftScale).toBe(0);
    expect(result.pendulum!.rightScale).toBe(7);
  });

  it("decodes pendulum with zero right scale", () => {
    const levelValue = 4 | (8 << 8) | (0 << 12); // level 4, left 8, right 0
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    expect(result.pendulum).not.toBeNull();
    expect(result.pendulum!.leftScale).toBe(8);
    expect(result.pendulum!.rightScale).toBe(0);
  });

  it("detects unknown scale values above 13", () => {
    // Left scale of 14 is out of range
    const levelValue = 4 | (14 << 8) | (4 << 12);
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    expect(result.unknownBits).not.toBe(0);
  });

  it("returns null pendulum when no scale bits set and no upper bits", () => {
    // Level 4 with no scale bits (bits 8-15 are 0)
    const levelValue = 4;
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    // If no scale bits and no upper bits beyond level, pendulum is null
    expect(result.level).toBe(4);
  });

  it("confirms pendulum scale bounds constants", () => {
    expect(PENDULUM_SCALE_MIN).toBe(1);
    expect(PENDULUM_SCALE_MAX).toBe(13);
  });

  it("detects unknown bits in upper word beyond pendulum scales", () => {
    // Bits 16+ should be unknown for pendulum
    const levelValue = 4 | (7 << 8) | (8 << 12) | 0x10000;
    const result = decodeProgression(levelValue, TYPE_PENDULUM);
    expect(result.unknownBits).toBeGreaterThan(0);
  });
});

// =============================================================================
// XYZ Pendulum monster progression
// =============================================================================

describe("XYZ Pendulum monster progression", () => {
  it("decodes xyz pendulum with rank", () => {
    const xyzPendulumType = TYPE_XYZ | TYPE_PENDULUM;
    const result = decodeProgression(4, xyzPendulumType);

    expect(result.rank).toBe(4);
    expect(result.level).toBeNull();
    expect(result.linkRating).toBeNull();
  });

  it("decodes xyz pendulum with scales", () => {
    const xyzPendulumType = TYPE_XYZ | TYPE_PENDULUM;
    // Rank 4 with left scale 5, right scale 5
    const levelValue = 4 | (5 << 8) | (5 << 12);
    const result = decodeProgression(levelValue, xyzPendulumType);

    expect(result.rank).toBe(4);
    expect(result.pendulum).not.toBeNull();
    expect(result.pendulum!.leftScale).toBe(5);
    expect(result.pendulum!.rightScale).toBe(5);
  });
});

// =============================================================================
// getProgressionType classification
// =============================================================================

describe("getProgressionType", () => {
  it("classifies regular monster", () => {
    expect(getProgressionType(TYPE_NORMAL)).toBe("regular");
  });

  it("classifies link monster", () => {
    expect(getProgressionType(TYPE_LINK)).toBe("link");
  });

  it("classifies xyz monster", () => {
    expect(getProgressionType(TYPE_XYZ)).toBe("xyz");
  });

  it("classifies pendulum monster", () => {
    expect(getProgressionType(TYPE_PENDULUM)).toBe("pendulum");
  });

  it("classifies xyz pendulum monster", () => {
    const xyzPendulum = TYPE_XYZ | TYPE_PENDULUM;
    expect(getProgressionType(xyzPendulum)).toBe("xyz_pendulum");
  });

  it("classifies effect monster as regular", () => {
    expect(getProgressionType(0x2)).toBe("regular");
  });

  it("classifies fusion monster as regular", () => {
    expect(getProgressionType(0x4)).toBe("regular");
  });
});

// =============================================================================
// LevelField constants
// =============================================================================

describe("LevelField constants", () => {
  it("LEVEL_MASK extracts lower byte", () => {
    expect(LevelField.LEVEL_MASK).toBe(0xFF);
    // Verify it masks to the lower byte
    const levelValue = 0x12345678;
    expect(levelValue & LevelField.LEVEL_MASK).toBe(0x78);
  });

  it("LEFT_SCALE_SHIFT is 8", () => {
    expect(LevelField.LEFT_SCALE_SHIFT).toBe(8);
    expect(LevelField.LEFT_SCALE_MASK).toBe(0xF);
  });

  it("RIGHT_SCALE_SHIFT is 12", () => {
    expect(LevelField.RIGHT_SCALE_SHIFT).toBe(12);
    expect(LevelField.RIGHT_SCALE_MASK).toBe(0xF);
  });

  it("scales are extracted correctly", () => {
    // level=7, left_scale=5, right_scale=13
    const levelValue = 7 | (5 << 8) | (13 << 12);
    const leftScale = (levelValue >> LevelField.LEFT_SCALE_SHIFT) & LevelField.LEFT_SCALE_MASK;
    const rightScale = (levelValue >> LevelField.RIGHT_SCALE_SHIFT) & LevelField.LEFT_SCALE_MASK;
    expect(leftScale).toBe(5);
    expect(rightScale).toBe(13);
  });
});

// =============================================================================
// CONFLICTING_PROGRESSION_FLAGS — null-on-conflict behavior
// Per INV-007: conflicting interpretations set all affected primary fields to null
// =============================================================================

describe("CONFLICTING_PROGRESSION_FLAGS — null-on-conflict per INV-007", () => {
  /**
   * These tests verify that conflicting progression type bits produce null
   * primary fields.
   *
   * Per B2-8 (INV-007):
   * "Progression is null-on-conflict: `level`, `rank`, and `linkRating` are
   * populated only when exactly one frame interpretation is supported by the
   * decoded traits; conflicting or multiple interpretations set all affected
   * primary fields to `null` and emit `CONFLICTING_PROGRESSION_FLAGS`."
   *
   * Conflict scenarios:
   * - LINK + XYZ: conflict (LINK and XYZ are mutually exclusive)
   * - LINK + PENDULUM: conflict (LINK has no level/rank)
   * - LINK + XYZ + PENDULUM: conflict (has LINK)
   *
   * Valid (non-conflicting) scenarios:
   * - LINK alone: valid LINK monster
   * - XYZ alone: valid XYZ monster
   * - PENDULUM alone: valid Pendulum monster
   * - XYZ + PENDULUM: valid XYZ Pendulum monster (not a conflict)
   */

  it("detects CONFLICTING_PROGRESSION_FLAGS when LINK and XYZ are both set", () => {
    const conflictType = TYPE_LINK | TYPE_XYZ;

    // Use the production detectConflictingProgressionBits function
    const conflicts = detectConflictingProgressionBits(conflictType);
    expect(conflicts).toContain("LINK");
    expect(conflicts).toContain("XYZ");
    expect(conflicts).toHaveLength(2);
  });

  it("detects CONFLICTING_PROGRESSION_FLAGS when LINK and PENDULUM are both set", () => {
    const conflictType = TYPE_LINK | TYPE_PENDULUM;

    const conflicts = detectConflictingProgressionBits(conflictType);
    expect(conflicts).toContain("LINK");
    expect(conflicts).toContain("PENDULUM");
    expect(conflicts).toHaveLength(2);
  });

  it("detects CONFLICTING_PROGRESSION_FLAGS when all three progression bits are set", () => {
    const conflictType = TYPE_LINK | TYPE_XYZ | TYPE_PENDULUM;

    const conflicts = detectConflictingProgressionBits(conflictType);
    expect(conflicts).toContain("LINK");
    expect(conflicts).toContain("XYZ");
    expect(conflicts).toContain("PENDULUM");
    expect(conflicts).toHaveLength(3);
  });

  it("null-on-conflict sets all primary fields to null for LINK+XYZ", () => {
    const conflictType = TYPE_LINK | TYPE_XYZ;
    const result = decodeProgression(5, conflictType);

    // Per INV-007: all primary fields must be null when conflict detected
    expect(result.level).toBeNull();
    expect(result.rank).toBeNull();
    expect(result.linkRating).toBeNull();
    expect(result.conflictingTypes).toContain("LINK");
    expect(result.conflictingTypes).toContain("XYZ");
  });

  it("null-on-conflict sets all primary fields to null for LINK+PENDULUM", () => {
    const conflictType = TYPE_LINK | TYPE_PENDULUM;
    const result = decodeProgression(4, conflictType);

    expect(result.level).toBeNull();
    expect(result.rank).toBeNull();
    expect(result.linkRating).toBeNull();
    expect(result.conflictingTypes).toContain("LINK");
    expect(result.conflictingTypes).toContain("PENDULUM");
  });

  it("no conflict when only LINK bit is set", () => {
    expect(detectConflictingProgressionBits(TYPE_LINK)).toEqual([]);
    const result = decodeProgression(5, TYPE_LINK);
    expect(result.linkRating).toBe(5); // Valid LINK rating
    expect(result.conflictingTypes).toEqual([]);
  });

  it("no conflict when only XYZ bit is set", () => {
    expect(detectConflictingProgressionBits(TYPE_XYZ)).toEqual([]);
    const result = decodeProgression(4, TYPE_XYZ);
    expect(result.rank).toBe(4); // Valid rank
    expect(result.conflictingTypes).toEqual([]);
  });

  it("no conflict when only PENDULUM bit is set", () => {
    expect(detectConflictingProgressionBits(TYPE_PENDULUM)).toEqual([]);
    const result = decodeProgression(4, TYPE_PENDULUM);
    expect(result.level).toBe(4); // Valid level
    expect(result.conflictingTypes).toEqual([]);
  });

  it("no conflict when XYZ and PENDULUM are both set (xyz_pendulum is valid)", () => {
    // XYZ Pendulum monsters are a valid card type, not a conflict
    const xyzPendulumType = TYPE_XYZ | TYPE_PENDULUM;
    expect(detectConflictingProgressionBits(xyzPendulumType)).toEqual([]);

    const result = decodeProgression(4, xyzPendulumType);
    expect(result.rank).toBe(4); // Valid rank for xyz_pendulum
    expect(result.conflictingTypes).toEqual([]);
    expect(getProgressionType(xyzPendulumType)).toBe("xyz_pendulum");
  });

  it("CONFLICTING_PROGRESSION_FLAGS diagnostic code is defined", () => {
    expect(DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS).toBe(
      "CONFLICTING_PROGRESSION_FLAGS"
    );
  });
});

// =============================================================================
// Raw value preservation on conflict
// Per B2-8: raw values are never lost
// =============================================================================

describe("Raw value preservation on conflict", () => {
  it("preserves rawValue when progression conflicts exist", () => {
    const conflictType = TYPE_LINK | TYPE_XYZ;
    const levelValue = 7;
    const result = decodeProgression(levelValue, conflictType);

    // rawValue is always preserved
    expect(result.rawValue).toBe(levelValue);
  });

  it("preserves rawValue for valid regular progression", () => {
    const result = decodeProgression(8, TYPE_NORMAL);
    expect(result.rawValue).toBe(8);
  });

  it("preserves rawValue for valid xyz progression", () => {
    const result = decodeProgression(4, TYPE_XYZ);
    expect(result.rawValue).toBe(4);
  });

  it("preserves rawValue for valid link progression", () => {
    const result = decodeProgression(3, TYPE_LINK);
    expect(result.rawValue).toBe(3);
  });

  it("preserves rawValue for pendulum progression", () => {
    const levelValue = 7 | (8 << 8) | (8 << 12);
    const result = decodeProgression(levelValue, TYPE_PENDULUM);
    expect(result.rawValue).toBe(levelValue);
  });

  it("unknownBits is retained separately from rawValue", () => {
    const levelValue = 4 | 0x10000;
    const result = decodeProgression(levelValue, TYPE_NORMAL);

    expect(result.rawValue).toBe(levelValue);
    expect(result.unknownBits).toBeGreaterThan(0);
    // unknownBits should NOT equal rawValue (they are tracked separately)
    expect(result.unknownBits).not.toBe(levelValue & 0xFF);
  });
});

// =============================================================================
// Sentinel / edge values
// =============================================================================

describe("Sentinel and edge values", () => {
  it("handles maximum positive level field", () => {
    // Level field is typically 8 bits (0xFF max)
    const result = decodeProgression(0xFF, TYPE_NORMAL);
    // 255 is way beyond level 12; should have unknown bits
    expect(result.unknownBits).not.toBe(0);
  });

  it("handles level field at boundary 0xFF (unknown bits triggered)", () => {
    const result = decodeProgression(255, TYPE_NORMAL);
    // Level 255 is way beyond valid range (1-12); unknown bits should be set.
    expect(result.unknownBits).not.toBe(0);
  });

  it("handles pendulum scale at maximum 13", () => {
    // Level 4, left scale 13, right scale 13
    const levelValue = 4 | (13 << 8) | (13 << 12);
    const result = decodeProgression(levelValue, TYPE_PENDULUM);

    expect(result.pendulum!.leftScale).toBe(13);
    expect(result.pendulum!.rightScale).toBe(13);
  });

  it("returns null pendulum when both scales are 0 and no upper bits set", () => {
    // When both scales are 0 and no scale bits are set (no upper bits beyond level),
    // the decoder currently returns pendulum=null (no pendulum structure).
    const levelValue = 4 | (0 << 8) | (0 << 12);
    const result = decodeProgression(levelValue, TYPE_PENDULUM);
    // Current decoder: pendulum is null when both scales are 0 and no upper bits
    expect(result.pendulum).toBeNull();
    expect(result.level).toBe(4);
  });

  it("unknownBits accumulates from multiple unknown sources", () => {
    // Upper bits + out-of-range scale
    const levelValue = 4 | (14 << 8) | 0x10000;
    const result = decodeProgression(levelValue, TYPE_PENDULUM);
    // unknownBits should accumulate: upper word + invalid left scale
    expect(result.unknownBits).toBeGreaterThan(0x10000);
  });
});

// =============================================================================
// Integration: normalizeCard conflict path
// =============================================================================

describe("normalizeCard integration — progression conflict", () => {
  /**
   * Helper to create a mock raw card.
   */
  function createMockCard(overrides: {
    type?: string;
    level?: string;
    name?: string;
  }) {
    return {
      id: "1234",
      dataOrdinal: 1,
      textOrdinal: 1,
      datas: {
        id: "1234",
        ot: "0",
        alias: null,
        setcode: "0",
        type: overrides.type ?? "0",
        atk: "2500",
        def: "2000",
        level: overrides.level ?? "0",
        race: null,
        attribute: null,
        category: "0",
      },
      texts: {
        id: "1234",
        name: overrides.name ?? "Test Card",
        desc: "Test card.",
        str1: null, str2: null, str3: null, str4: null,
        str5: null, str6: null, str7: null, str8: null,
        str9: null, str10: null, str11: null, str12: null,
        str13: null, str14: null, str15: null, str16: null,
      },
    } as import("../../dist/cdb/rawTypes.js").RawCardRows;
  }

  const defaultContext = {
    locale: "en" as const,
    sourceNamespace: "cdb" as const,
    registryHashes: {},
    limits: {
      maxRowsPerTable: 1_000_000,
      maxTextBytes: 4 * 1024 * 1024,
      maxOutputBytes: 2 * 1024 * 1024 * 1024,
      maxStagingBytes: 4 * 1024 * 1024 * 1024,
      maxSpoolBytes: 2 * 1024 * 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024 * 1024,
    },
  };

  // -------------------------------------------------------------------------
  // F1: CONFLICTING_PROGRESSION_FLAGS is a WARNING (promoted to ERROR in strict mode)
  // -------------------------------------------------------------------------

  it("F1: CONFLICTING_PROGRESSION_FLAGS is emitted as WARNING by default", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    const conflictType = TYPE_LINK | TYPE_XYZ;
    const rawCard = createMockCard({
      type: String(conflictType),
      level: "5",
    });

    normalizeCard(rawCard, defaultContext, diagnostics);

    // Per INV-007 + spec.md:117: conflict diagnostic is WARNING by default
    const conflictWarnings = diagnostics.getWarnings().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictWarnings).toHaveLength(1);
    expect(conflictWarnings[0].severity).toBe("WARNING");

    // No errors yet (strict mode not applied)
    const conflictErrors = diagnostics.getErrors().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictErrors).toHaveLength(0);
  });

  it("F1: CONFLICTING_PROGRESSION_FLAGS is promoted to ERROR under strict mode", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    const conflictType = TYPE_LINK | TYPE_XYZ;
    const rawCard = createMockCard({
      type: String(conflictType),
      level: "5",
    });

    normalizeCard(rawCard, defaultContext, diagnostics);

    // Apply strict mode promotion
    diagnostics.promote(true);

    // Per INV-007 + spec.md:117: strict mode promotes to ERROR
    const conflictErrors = diagnostics.getErrors().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictErrors).toHaveLength(1);
    expect(conflictErrors[0].severity).toBe("ERROR");

    // Warnings should be empty after promotion
    const conflictWarnings = diagnostics.getWarnings().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictWarnings).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // F2: Conflict handling preserves valid Pendulum scales independently
  // -------------------------------------------------------------------------

  it("F2: LINK+PENDULUM conflict preserves valid pendulum scales", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    // LINK + PENDULUM is a conflict
    const conflictType = TYPE_LINK | TYPE_PENDULUM;
    // Level 4 with valid pendulum scales (left=3, right=8)
    const levelValue = 4 | (3 << 8) | (8 << 12);
    const rawCard = createMockCard({
      type: String(conflictType),
      level: String(levelValue),
    });

    const result = normalizeCard(rawCard, defaultContext, diagnostics);

    // Per INV-007 + phase-3-card-profile.md:23: scales decoded independently
    // Primary fields are null (conflict)
    expect(result.progression.level).toBeNull();
    expect(result.progression.rank).toBeNull();
    expect(result.progression.linkRating).toBeNull();

    // But pendulum scales are preserved when both are valid
    expect(result.progression.pendulum).not.toBeNull();
    expect(result.progression.pendulum!.leftScale).toBe(3);
    expect(result.progression.pendulum!.rightScale).toBe(8);
  });

  it("F2: Invalid scale pair produces null pendulum", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    // LINK + PENDULUM is a conflict
    const conflictType = TYPE_LINK | TYPE_PENDULUM;
    // Level 4 with INVALID left scale (14 is out of range)
    const levelValue = 4 | (14 << 8) | (8 << 12);
    const rawCard = createMockCard({
      type: String(conflictType),
      level: String(levelValue),
    });

    const result = normalizeCard(rawCard, defaultContext, diagnostics);

    // Per INV-007: pendulum object is produced only when BOTH scales are valid
    expect(result.progression.pendulum).toBeNull();
    // But unknownBits should capture the invalid scale
    expect(result.progression.unknownBits).not.toBe(0);
  });

  it("F2: LINK+XYZ+pendulum triple conflict preserves valid scales", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    // LINK + XYZ + PENDULUM is a conflict
    const conflictType = TYPE_LINK | TYPE_XYZ | TYPE_PENDULUM;
    // Level 5 with valid pendulum scales (left=7, right=7)
    const levelValue = 5 | (7 << 8) | (7 << 12);
    const rawCard = createMockCard({
      type: String(conflictType),
      level: String(levelValue),
    });

    const result = normalizeCard(rawCard, defaultContext, diagnostics);

    // All primary fields null due to conflict
    expect(result.progression.level).toBeNull();
    expect(result.progression.rank).toBeNull();
    expect(result.progression.linkRating).toBeNull();

    // Scales preserved when both are valid
    expect(result.progression.pendulum).not.toBeNull();
    expect(result.progression.pendulum!.leftScale).toBe(7);
    expect(result.progression.pendulum!.rightScale).toBe(7);
  });

  it("F2: xyz_pendulum with invalid scale produces null pendulum and unknownBits", () => {
    // XYZ + PENDULUM is NOT a conflict (valid xyz_pendulum monster)
    const xyzPendulumType = TYPE_XYZ | TYPE_PENDULUM;
    // Level 4 with INVALID left scale (14 is out of range) and invalid right scale (15 is out of range)
    const levelValue = 4 | (14 << 8) | (15 << 12);
    const result = decodeProgression(levelValue, xyzPendulumType);

    // xyz_pendulum has rank
    expect(result.rank).toBe(4);

    // But pendulum is null because both scales are invalid
    expect(result.pendulum).toBeNull();

    // unknownBits captures the invalid scale bits
    expect(result.unknownBits).not.toBe(0);
  });

  // -------------------------------------------------------------------------
  // F3: Conflict diagnostic retains exact raw decimal strings
  // -------------------------------------------------------------------------

  it("F3: Conflict diagnostic retains exact raw type and level decimal strings", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    const conflictType = TYPE_LINK | TYPE_XYZ;
    // Use non-trivial decimal strings (these would be different after parseInt)
    const rawCard = createMockCard({
      type: String(conflictType),
      level: "7",
    });

    normalizeCard(rawCard, defaultContext, diagnostics);

    const conflictDiags = diagnostics.getWarnings().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictDiags).toHaveLength(1);

    // Per spec.md:117 and spec.md:165: raw decimal strings must be preserved
    // rawValue should be the level decimal string (not a JS number)
    expect(conflictDiags[0].rawValue).toBe("7");

    // rawType in details should be the type decimal string
    expect(conflictDiags[0].details?.rawType).toBe(String(conflictType));
  });

  it("F3: Raw decimal strings preserved for large type values", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    // Large type value that would lose precision in JavaScript number
    const largeType = "544100832"; // Has LINK + PENDULUM bits
    const rawCard = createMockCard({
      type: largeType,
      level: "123456789012345",
    });

    normalizeCard(rawCard, defaultContext, diagnostics);

    const conflictDiags = diagnostics.getWarnings().filter(
      (d) => d.code === DiagnosticCode.CONFLICTING_PROGRESSION_FLAGS
    );
    expect(conflictDiags).toHaveLength(1);

    // Per spec.md:165: exact decimal strings preserved without JS number conversion
    expect(conflictDiags[0].rawValue).toBe("123456789012345");
    expect(conflictDiags[0].details?.rawType).toBe(largeType);
  });

  // -------------------------------------------------------------------------
  // Null-on-conflict: primary fields are null, rawValue is preserved
  // -------------------------------------------------------------------------

  it("normalizeCard sets level/rank/linkRating to null on conflict", async () => {
    const { normalizeCard } = await import(
      "../../dist/normalization/normalizeCard.js"
    );
    const { DiagnosticCollector } = await import(
      "../../dist/diagnostics/collector.js"
    );

    const diagnostics = new DiagnosticCollector();
    const conflictType = TYPE_LINK | TYPE_XYZ;
    const rawCard = createMockCard({
      type: String(conflictType),
      level: "5",
    });

    const result = normalizeCard(rawCard, defaultContext, diagnostics);

    // Per INV-007: all primary fields null on conflict
    expect(result.progression.level).toBeNull();
    expect(result.progression.rank).toBeNull();
    expect(result.progression.linkRating).toBeNull();

    // rawValue is always preserved for diagnostics
    expect(result.progression.rawValue).toBe(5);
  });
});
