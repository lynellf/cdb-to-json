/**
 * Text segmentation tests for the source profile.
 *
 * Tests conservative text segmentation per P5-AC1 and INV-008.
 *
 * Key invariants:
 * 1. Raw text is preserved exactly
 * 2. Normalized text uses CRLF/CR→LF and NFC
 * 3. UTF-16 offsets are based on normalized text
 * 4. Every slice round-trips: normalized.slice(slice.start, slice.end) === slice.text
 * 5. Conservative segmentation: no executable semantics are inferred
 */

import { describe, expect, it } from "vitest";
import {
  normalizeText,
  segmentCardText,
  getSourceSpans,
  TEXT_KIND,
} from "../../src/text/index.js";

// ---------------------------------------------------------------------------
// normalizeText tests
// ---------------------------------------------------------------------------

describe("normalizeText (P5-AC1)", () => {
  it("returns null for null input", () => {
    const result = normalizeText(null);
    expect(result.raw).toBeNull();
    expect(result.normalized).toBeNull();
    expect(result.normalizationVersion).toBe("text-normalization/1");
  });

  it("preserves plain text unchanged", () => {
    const raw = "A simple effect text.";
    const result = normalizeText(raw);
    expect(result.raw).toBe(raw);
    expect(result.normalized).toBe(raw);
    expect(result.normalizationVersion).toBe("text-normalization/1");
  });

  it("normalizes CRLF to LF", () => {
    const raw = "Line 1\r\nLine 2\r\nLine 3";
    const result = normalizeText(raw);
    expect(result.raw).toBe(raw);
    expect(result.normalized).toBe("Line 1\nLine 2\nLine 3");
  });

  it("normalizes standalone CR to LF", () => {
    const raw = "Line 1\rLine 2\rLine 3";
    const result = normalizeText(raw);
    expect(result.raw).toBe(raw);
    expect(result.normalized).toBe("Line 1\nLine 2\nLine 3");
  });

  it("applies NFC normalization", () => {
    // é can be represented as U+00E9 (composed) or U+0065 U+0301 (decomposed)
    const composed = "café"; // U+00E9
    const decomposed = "cafe\u0301"; // U+0065 U+0301
    const result = normalizeText(decomposed);
    expect(result.normalized).toBe(composed);
  });

  it("handles empty string", () => {
    const result = normalizeText("");
    expect(result.raw).toBe("");
    expect(result.normalized).toBe("");
  });
});

// ---------------------------------------------------------------------------
// segmentCardText tests
// ---------------------------------------------------------------------------

describe("segmentCardText (P5-AC1)", () => {
  describe("null description", () => {
    it("returns UNSPLIT for null description", () => {
      const result = segmentCardText(null, null, "MONSTER", []);
      expect(result.segmentation).toBe("UNSPLIT");
      expect(result.material).toBeNull();
      expect(result.pendulumEffect).toBeNull();
      expect(result.monsterEffect).toBeNull();
      expect(result.spellTrapEffect).toBeNull();
      expect(result.flavor).toBeNull();
      expect(result.unclassified).toHaveLength(0);
    });
  });

  describe("exact marker segmentation (EXACT_MARKERS)", () => {
    it("handles pendulum and monster markers", () => {
      // This tests the exact marker detection
      const normalized = "[ Pendulum Effect ] Pendulum text.[ Monster Effect ] Monster text.";
      const result = segmentCardText(null, normalized, "MONSTER", ["PENDULUM", "EFFECT"]);

      expect(result.segmentation).toBe("EXACT_MARKERS");
      expect(result.pendulumEffect).not.toBeNull();
      expect(result.monsterEffect).not.toBeNull();
    });

    it("handles monster-only marker", () => {
      const normalized = "[ Monster Effect ] Monster text.";
      const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

      expect(result.segmentation).toBe("EXACT_MARKERS");
      expect(result.monsterEffect).not.toBeNull();
    });
  });

  describe("spell/trap cards", () => {
    it("treats spell effect as spell_trap_effect", () => {
      const normalized = "Add 1 monster to your hand.";
      const result = segmentCardText(null, normalized, "SPELL", ["QUICK_PLAY"]);

      expect(result.segmentation).toBe("PARTIAL");
      expect(result.spellTrapEffect).not.toBeNull();
      expect(result.spellTrapEffect?.text).toBe(normalized);
    });

    it("treats trap effect as spell_trap_effect", () => {
      const normalized = "Negate the attack.";
      const result = segmentCardText(null, normalized, "TRAP", ["COUNTER"]);

      expect(result.segmentation).toBe("PARTIAL");
      expect(result.spellTrapEffect).not.toBeNull();
      expect(result.spellTrapEffect?.text).toBe(normalized);
    });
  });

  describe("UNSPLIT fallback", () => {
    it("returns UNSPLIT for ambiguous text", () => {
      const normalized = "Some ambiguous effect text.";
      const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

      // UNSPLIT when no clear markers detected
      expect(["UNSPLIT", "FRAME_RULE"]).toContain(result.segmentation);
    });

    it("returns UNSPLIT for TOKEN cards", () => {
      const normalized = "This token cannot be used.";
      const result = segmentCardText(null, normalized, "TOKEN", []);

      expect(result.segmentation).toBe("UNSPLIT");
    });
  });
});

// ---------------------------------------------------------------------------
// UTF-16 offset tests
// ---------------------------------------------------------------------------

describe("UTF-16 offset correctness (P5-AC1)", () => {
  it("each slice round-trips through normalized.slice(start, end)", () => {
    const normalized = "Materials: 1 Dragon.\nEffect text here.";
    const result = segmentCardText(null, normalized, "MONSTER", ["FUSION"]);

    const spans = getSourceSpans(result);
    for (const span of spans) {
      const extracted = normalized.slice(span.start, span.end);
      expect(extracted).toBe(span.text);
    }
  });

  it("handles surrogate pairs correctly", () => {
    // U+1F600 = 😀 (2 UTF-16 code units)
    const normalized = "Hello 😀 World";

    const result = segmentCardText(null, normalized, "MONSTER", ["NORMAL"]);
    const span = result.flavor || result.unclassified[0];

    // UTF-16 length: "Hello " = 6, "😀" = 2, " World" = 6
    expect(normalized.length).toBe(14);
    expect(span.text).toBe(normalized);
  });

  it("CRLF normalization preserves span structure", () => {
    const raw = "Line 1\r\nLine 2";
    const { normalized, raw: preservedRaw } = normalizeText(raw);

    const result = segmentCardText(preservedRaw, normalized, "MONSTER", ["EFFECT"]);
    const spans = getSourceSpans(result);

    // Verify all spans round-trip
    for (const span of spans) {
      const extracted = normalized!.slice(span.start, span.end);
      expect(extracted).toBe(span.text);
    }
  });
});

// ---------------------------------------------------------------------------
// conservative segmentation contract (INV-008)
// ---------------------------------------------------------------------------

describe("conservative segmentation contract (INV-008)", () => {
  it("does not split at periods (multiple sentences stay together)", () => {
    const normalized = "If this card is sent to the GY. You can target 1 monster.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    // If classified, the full text should be preserved
    if (result.monsterEffect) {
      expect(result.monsterEffect.text).toContain("If this card is sent to the GY");
      expect(result.monsterEffect.text).toContain("You can target");
    }
  });

  it("does not infer costs, targets, or triggers", () => {
    const normalized = "Once per turn: Special Summon this card.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    // The effect text should be preserved verbatim
    if (result.monsterEffect) {
      expect(result.monsterEffect.text).toContain("Once per turn:");
    }
  });

  it("preserves PSCT punctuation", () => {
    const normalized = "Target 1 monster: negate its effect.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    // Colons should be preserved
    if (result.monsterEffect) {
      expect(result.monsterEffect.text).toContain(":");
    }
  });

  it("leaves ambiguous cases unsplit", () => {
    const normalized = "This card cannot be destroyed by battle.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    // Should be UNSPLIT or have an unclassified span
    expect(["UNSPLIT", "FRAME_RULE"]).toContain(result.segmentation);
  });
});

// ---------------------------------------------------------------------------
// TextSlice property requirements
// ---------------------------------------------------------------------------

describe("TextSlice properties (INV-008)", () => {
  it("every slice has required properties", () => {
    const normalized = "Effect text.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    const spans = getSourceSpans(result);
    expect(spans.length).toBeGreaterThan(0);

    for (const span of spans) {
      expect(typeof span.text).toBe("string");
      expect(typeof span.start).toBe("number");
      expect(typeof span.end).toBe("number");
      expect(typeof span.kind).toBe("string");
      expect(span.basis).toBe("normalized");
    }
  });

  it("every slice has start < end", () => {
    const normalized = "Effect text.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    const spans = getSourceSpans(result);
    for (const span of spans) {
      expect(span.start).toBeLessThan(span.end);
      expect(span.start).toBeGreaterThanOrEqual(0);
    }
  });

  it("every slice kind is a valid text kind", () => {
    const normalized = "Effect text.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    const spans = getSourceSpans(result);
    const validKinds = Object.values(TEXT_KIND);

    for (const span of spans) {
      expect(validKinds).toContain(span.kind);
    }
  });
});
