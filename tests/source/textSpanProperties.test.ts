/**
 * Text span properties tests for the source profile.
 *
 * Tests per P5-AC1 and INV-008:
 * - Every TextSlice requires text, start, end, kind, and basis: "normalized"
 * - Offsets are UTF-16 code-unit positions into text.normalized
 * - Spans round-trip: normalized.slice(start, end) === text
 * - The frozen text.sections/text.sourceSpans shape is enforced
 */

import { describe, expect, it } from "vitest";
import {
  normalizeText,
  segmentCardText,
  buildTextSections,
  getSourceSpans,
  TEXT_KIND,
} from "../../src/text/index.js";

// ---------------------------------------------------------------------------
// TextSlice property requirements
// ---------------------------------------------------------------------------

describe("TextSlice property requirements (INV-008)", () => {
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

  it("every slice text equals normalized.slice(start, end)", () => {
    const normalized = "Effect text with some content.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    const spans = getSourceSpans(result);
    for (const span of spans) {
      const extracted = normalized.slice(span.start, span.end);
      expect(extracted).toBe(span.text);
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

  it("every slice basis is 'normalized'", () => {
    const normalized = "Effect text.";
    const result = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);

    const spans = getSourceSpans(result);
    for (const span of spans) {
      expect(span.basis).toBe("normalized");
    }
  });
});

// ---------------------------------------------------------------------------
// text.sections shape
// ---------------------------------------------------------------------------

describe("text.sections shape (INV-008)", () => {
  it("sections object has all required fields", () => {
    const normalized = "Effect text.";
    const segmentation = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);
    const sections = buildTextSections(segmentation);

    expect(sections).toHaveProperty("material");
    expect(sections).toHaveProperty("pendulumEffect");
    expect(sections).toHaveProperty("monsterEffect");
    expect(sections).toHaveProperty("spellTrapEffect");
    expect(sections).toHaveProperty("flavor");
    expect(sections).toHaveProperty("unclassified");
    expect(sections).toHaveProperty("segmentation");
  });

  it("segmentation status is valid", () => {
    const statuses = ["EXACT_MARKERS", "FRAME_RULE", "PARTIAL", "UNSPLIT"];

    const cases = [
      { text: "Effect text.", kind: "MONSTER", traits: ["EFFECT"] },
      { text: "Spell effect.", kind: "SPELL", traits: [] },
      { text: "Ambiguous effect.", kind: "MONSTER", traits: ["EFFECT"] },
    ];

    for (const { text, kind, traits } of cases) {
      const result = segmentCardText(null, text, kind, traits);
      expect(statuses).toContain(result.segmentation);
    }
  });

  it("null description has empty sections", () => {
    const result = segmentCardText(null, null, "MONSTER", []);
    const sections = buildTextSections(result);

    expect(sections.material).toBeNull();
    expect(sections.pendulumEffect).toBeNull();
    expect(sections.monsterEffect).toBeNull();
    expect(sections.spellTrapEffect).toBeNull();
    expect(sections.flavor).toBeNull();
    expect(sections.unclassified).toHaveLength(0);
    expect(sections.segmentation).toBe("UNSPLIT");
  });
});

// ---------------------------------------------------------------------------
// UTF-16 offset encoding
// ---------------------------------------------------------------------------

describe("UTF-16 code-unit offset encoding (INV-008)", () => {
  it("offsets match JavaScript string indexing (BMP)", () => {
    const normalized = "Hello World";
    expect(normalized.charAt(6)).toBe("W");

    const result = segmentCardText(null, normalized, "MONSTER", ["NORMAL"]);
    const span = result.flavor || result.unclassified[0];

    expect(span.start).toBe(0);
    expect(span.end).toBe(normalized.length);
  });

  it("handles astral Unicode (surrogate pairs)", () => {
    // U+1F600 = 😀 (2 UTF-16 code units)
    const normalized = "Hello 😀 World";
    // "Hello " = 6, "😀" = 2, " World" = 6

    const result = segmentCardText(null, normalized, "MONSTER", ["NORMAL"]);
    const span = result.flavor || result.unclassified[0];

    expect(span.text).toBe(normalized);
    expect(span.end).toBe(14); // 6 + 2 + 6 = 14 UTF-16 code units
  });

  it("handles combining characters", () => {
    // e + combining acute accent = é
    const normalized = "café"; // NFC form: U+00E9
    const result = segmentCardText(null, normalized, "MONSTER", ["NORMAL"]);
    const span = result.flavor || result.unclassified[0];

    expect(span.text).toBe(normalized);
    expect(span.end).toBe(4); // 4 UTF-16 code units
  });

  it("CRLF is normalized before offset calculation", () => {
    const raw = "Line 1\r\nLine 2";
    const { normalized } = normalizeText(raw);

    const result = segmentCardText(raw, normalized, "MONSTER", ["EFFECT"]);
    const spans = getSourceSpans(result);

    // Each span's offsets are into the normalized text
    for (const span of spans) {
      const extracted = normalized!.slice(span.start, span.end);
      expect(extracted).toBe(span.text);
    }
  });
});

// ---------------------------------------------------------------------------
// round-trip verification
// ---------------------------------------------------------------------------

describe("span round-trip verification (P5-AC1)", () => {
  it("sourceSpans contains all sections", () => {
    const normalized = "Effect text.";
    const segmentation = segmentCardText(null, normalized, "MONSTER", ["EFFECT"]);
    const sourceSpans = getSourceSpans(segmentation);
    const sections = buildTextSections(segmentation);

    // Count named sections
    const namedCount = [
      sections.material,
      sections.pendulumEffect,
      sections.monsterEffect,
      sections.flavor,
    ].filter((s) => s !== null).length;

    // sourceSpans should contain all named sections plus unclassified
    expect(sourceSpans.length).toBe(namedCount + sections.unclassified.length);
  });

  it("each sourceSpan round-trips through normalized", () => {
    const testCases = [
      "Short text.",
      "Effect with content.",
      "A longer effect text that spans multiple words.",
    ];

    for (const text of testCases) {
      const { normalized } = normalizeText(text);
      const result = segmentCardText(text, normalized, "MONSTER", ["EFFECT"]);
      const spans = getSourceSpans(result);

      for (const span of spans) {
        const extracted = normalized!.slice(span.start, span.end);
        expect(extracted).toBe(span.text);
      }
    }
  });
});
