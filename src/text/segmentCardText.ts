/**
 * Conservative text segmentation for card descriptions.
 *
 * Implements conservative segmentation rules for ygo.card-source/1:
 * - Exact markers first (pendulum/monster effect markers)
 * - Frame-based rules for Normal monster flavor text
 * - Material line detection for Extra Deck/Ritual monsters
 * - UNSPLIT fallback for ambiguous cases
 *
 * The converter MUST NOT:
 * - Split effects merely at periods
 * - Infer costs, targets, conditions, or resolution timing
 * - Translate PSCT punctuation (colon/semicolon have semantic meaning)
 * - Classify "if" versus "when" trigger types
 * - Infer once-per-turn scope
 * - Create executable operation names
 *
 * @module text/segmentCardText
 */

import type { TextSlice } from "./types.js";

/**
 * Segmentation status.
 */
export type SegmentationStatus =
  | "EXACT_MARKERS"   // Text split using exact string markers
  | "FRAME_RULE"      // Text split using frame-based rules
  | "PARTIAL"         // Some classification achieved but not complete
  | "UNSPLIT";        // No reliable segmentation possible

/**
 * Segmentation result with named sections and unclassified segments.
 */
export interface SegmentationResult {
  /** Material line (e.g., "Materials: Sylvan..." or "Must first be Special Summoned...") */
  material: TextSlice | null;
  /** Pendulum effect text (between pendulum and monster markers) */
  pendulumEffect: TextSlice | null;
  /** Monster effect text (after monster marker) */
  monsterEffect: TextSlice | null;
  /** Spell/Trap effect text */
  spellTrapEffect: TextSlice | null;
  /** Flavor text for Normal monsters */
  flavor: TextSlice | null;
  /** Unclassified text segments */
  unclassified: readonly TextSlice[];
  /** Segmentation confidence level */
  segmentation: SegmentationStatus;
}

/**
 * Pendulum effect marker string (exact match required).
 */
export const PENDULUM_MARKER = "[ Pendulum Effect ]";

/**
 * Monster effect marker string (exact match required).
 */
export const MONSTER_EFFECT_MARKER = "[ Monster Effect ]";

/**
 * Material line patterns (case-insensitive).
 * These detect dedicated material lines, not effect text containing these words.
 */
const MATERIAL_PATTERNS: RegExp[] = [
  /^\s*materials?\s*:/im,
  /^\s*material\s*:?\s*$/im,
  /\/\s*tribute\s+怪兽/i,
  /^★/m,
];

/**
 * Text kinds for sourceSpans.
 */
export const TEXT_KIND = {
  MATERIAL: "material",
  PENDULUM_EFFECT: "pendulum_effect",
  MONSTER_EFFECT: "monster_effect",
  SPELL_TRAP_EFFECT: "spell_trap_effect",
  FLAVOR: "flavor",
  UNCLASSIFIED: "unclassified",
} as const;

/**
 * Segment card text conservatively.
 *
 * @param _rawDescription Raw description text from CDB (may be null) - preserved for future use
 * @param normalized Normalized description text
 * @param cardKind Card kind (MONSTER, SPELL, TRAP, TOKEN, UNKNOWN)
 * @param traits Card type traits
 * @returns Segmentation result with named sections
 */
export function segmentCardText(
  _rawDescription: string | null,
  normalized: string | null,
  cardKind: string,
  traits: string[],
): SegmentationResult {
  // Handle null description
  if (normalized === null) {
    return {
      material: null,
      pendulumEffect: null,
      monsterEffect: null,
      spellTrapEffect: null,
      flavor: null,
      unclassified: [],
      segmentation: "UNSPLIT",
    };
  }

  // Try exact marker segmentation first (pendulum/monster cards)
  if (normalized.includes(PENDULUM_MARKER) || normalized.includes(MONSTER_EFFECT_MARKER)) {
    return segmentByExactMarkers(normalized, cardKind, traits);
  }

  // Apply frame-based rules for monsters
  if (cardKind === "MONSTER") {
    const frameResult = segmentByFrameRules(normalized, cardKind, traits);
    if (frameResult.segmentation !== "UNSPLIT") {
      return frameResult;
    }
  }

  // Spell/Trap: whole text is effect text
  if (cardKind === "SPELL" || cardKind === "TRAP") {
    return {
      material: null,
      pendulumEffect: null,
      monsterEffect: null,
      spellTrapEffect: createSlice(normalized, 0, normalized.length, TEXT_KIND.SPELL_TRAP_EFFECT),
      flavor: null,
      unclassified: [],
      segmentation: "PARTIAL",
    };
  }

  // TOKEN or UNKNOWN: whole text is unclassified
  return {
    material: null,
    pendulumEffect: null,
    monsterEffect: null,
    spellTrapEffect: null,
    flavor: null,
    unclassified: [
      createSlice(normalized, 0, normalized.length, TEXT_KIND.UNCLASSIFIED),
    ],
    segmentation: "UNSPLIT",
  };
}

/**
 * Segment text using exact string markers.
 */
function segmentByExactMarkers(
  normalized: string,
  cardKind: string,
  traits: string[],
): SegmentationResult {
  let segmentation: SegmentationStatus = "EXACT_MARKERS";
  let material: TextSlice | null = null;
  let pendulumEffect: TextSlice | null = null;
  let monsterEffect: TextSlice | null = null;
  let flavor: TextSlice | null = null;
  const unclassified: TextSlice[] = [];

  // Check for pendulum marker
  const pendulumIdx = normalized.indexOf(PENDULUM_MARKER);
  const hasPendulum = pendulumIdx !== -1;

  // Check for monster marker
  const monsterIdx = normalized.indexOf(MONSTER_EFFECT_MARKER);
  const hasMonster = monsterIdx !== -1;

  if (hasPendulum) {
    // Extract pendulum effect
    const pendulumStart = pendulumIdx + PENDULUM_MARKER.length;
    let pendulumEnd: number;

    if (hasMonster) {
      pendulumEnd = monsterIdx;
    } else {
      // No monster marker - find material line or use rest
      const materialMatch = findMaterialLine(normalized, pendulumStart);
      if (materialMatch) {
        pendulumEnd = materialMatch.start;
        material = materialMatch;
      } else {
        pendulumEnd = normalized.length;
      }
    }

    if (pendulumEnd > pendulumStart) {
      const pendulumText = normalized.substring(pendulumStart, pendulumEnd);
      const trimmed = pendulumText.trim();
      if (trimmed.length > 0) {
        // Trimmed content starts at pendulumStart (leading whitespace removed)
        // Trimmed content ends at pendulumStart + trimmed.length
        pendulumEffect = createSlice(normalized, pendulumStart, pendulumStart + trimmed.length, TEXT_KIND.PENDULUM_EFFECT);
      }
    }

    // Extract monster effect (if pendulum marker exists, monster marker is after it)
    if (hasMonster) {
      const monsterStart = monsterIdx + MONSTER_EFFECT_MARKER.length;
      const monsterText = normalized.substring(monsterStart);
      const trimmed = monsterText.trim();
      if (trimmed.length > 0) {
        monsterEffect = createSlice(normalized, monsterStart, monsterStart + trimmed.length, TEXT_KIND.MONSTER_EFFECT);
      }
    }
  } else if (hasMonster) {
    // Monster marker only (no pendulum)
    const monsterStart = monsterIdx + MONSTER_EFFECT_MARKER.length;
    const monsterText = normalized.substring(monsterStart);
    const trimmed = monsterText.trim();
    if (trimmed.length > 0) {
      monsterEffect = createSlice(normalized, monsterStart, monsterStart + trimmed.length, TEXT_KIND.MONSTER_EFFECT);
    }
  }

  // For Normal monsters, check for flavor text
  if (cardKind === "MONSTER" && traits.includes("NORMAL")) {
    // Normal monsters with only one paragraph after monster marker = likely flavor
    const effectText = monsterEffect?.text ?? "";
    const lines = effectText.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length <= 2 && effectText.length < 100 && monsterEffect) {
      // Short text after monster marker suggests flavor text
      const effectSlice = monsterEffect;
      flavor = createSlice(normalized, effectSlice.start, effectSlice.end, TEXT_KIND.FLAVOR);
      monsterEffect = null;
    }
  }

  // Build unclassified from any gaps
  const gaps = findGaps(normalized, [material, pendulumEffect, monsterEffect, flavor].filter((s): s is TextSlice => s !== null));
  unclassified.push(...gaps);

  return {
    material,
    pendulumEffect,
    monsterEffect,
    spellTrapEffect: null,
    flavor,
    unclassified,
    segmentation,
  };
}

/**
 * Segment text using frame-based rules.
 */
function segmentByFrameRules(
  normalized: string,
  cardKind: string,
  traits: string[],
): SegmentationResult {
  // Check for material line
  const materialMatch = findMaterialLine(normalized, 0);

  // For Normal monsters, the effect text is often flavor
  if (cardKind === "MONSTER" && traits.includes("NORMAL")) {
    const effectText = materialMatch
      ? normalized.substring(materialMatch.end).trim()
      : normalized.trim();

    // Short single-paragraph effect = likely flavor text
    const lines = effectText.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 2 && effectText.length < 100) {
      return {
        material: materialMatch,
        pendulumEffect: null,
        monsterEffect: null,
        spellTrapEffect: null,
        flavor: materialMatch
          ? createSlice(normalized, materialMatch.end, normalized.length, TEXT_KIND.FLAVOR)
          : createSlice(normalized, 0, normalized.length, TEXT_KIND.FLAVOR),
        unclassified: [],
        segmentation: "FRAME_RULE",
      };
    }
  }

  // For non-normal monsters with material, try to classify effect text
  if (materialMatch) {
    const effectStart = materialMatch.end;
    const effectEnd = normalized.length;
    const effectText = normalized.substring(effectStart, effectEnd).trim();

    if (effectText.length > 0) {
      return {
        material: materialMatch,
        pendulumEffect: null,
        monsterEffect: createSlice(normalized, effectStart, effectEnd, TEXT_KIND.MONSTER_EFFECT),
        spellTrapEffect: null,
        flavor: null,
        unclassified: [],
        segmentation: "FRAME_RULE",
      };
    }
  }

  // Could not segment using frame rules
  return {
    material: null,
    pendulumEffect: null,
    monsterEffect: null,
    spellTrapEffect: null,
    flavor: null,
    unclassified: [createSlice(normalized, 0, normalized.length, TEXT_KIND.UNCLASSIFIED)],
    segmentation: "UNSPLIT",
  };
}

/**
 * Find a material line in the text.
 */
function findMaterialLine(
  normalized: string,
  startIndex: number,
): TextSlice | null {
  for (const pattern of MATERIAL_PATTERNS) {
    const match = normalized.substring(startIndex).match(pattern);
    if (match) {
      const matchStart = startIndex + (match.index ?? 0);
      const matchEnd = matchStart + match[0].length;

      // Find the end of this line
      const lineEnd = normalized.indexOf("\n", matchEnd);
      const textEnd = lineEnd === -1 ? normalized.length : lineEnd;

      return createSlice(normalized, matchStart, textEnd, TEXT_KIND.MATERIAL);
    }
  }
  return null;
}

/**
 * Find gaps between known slices.
 */
function findGaps(normalized: string, slices: TextSlice[]): TextSlice[] {
  const gaps: TextSlice[] = [];
  let lastEnd = 0;

  // Sort slices by start position
  const sorted = [...slices].sort((a, b) => a.start - b.start);

  for (const slice of sorted) {
    if (slice.start > lastEnd) {
      // Gap between last slice and this one
      const gapText = normalized.substring(lastEnd, slice.start).trim();
      if (gapText.length > 0) {
        gaps.push(createSlice(normalized, lastEnd, slice.start, TEXT_KIND.UNCLASSIFIED));
      }
    }
    lastEnd = Math.max(lastEnd, slice.end);
  }

  // Check for trailing gap
  if (lastEnd < normalized.length) {
    const trailingText = normalized.substring(lastEnd).trim();
    if (trailingText.length > 0) {
      gaps.push(createSlice(normalized, lastEnd, normalized.length, TEXT_KIND.UNCLASSIFIED));
    }
  }

  return gaps;
}

/**
 * Create a TextSlice from offsets into normalized text.
 */
function createSlice(
  normalized: string,
  start: number,
  end: number,
  kind: string,
): TextSlice {
  const text = normalized.substring(start, end);
  return {
    text,
    start,
    end,
    kind,
    basis: "normalized",
  };
}

/**
 * Get all source spans from a segmentation result.
 * Returns an ordered list of all text slices.
 */
export function getSourceSpans(result: SegmentationResult): readonly TextSlice[] {
  const spans: TextSlice[] = [];

  // Add named sections in order
  if (result.material) spans.push(result.material);
  if (result.pendulumEffect) spans.push(result.pendulumEffect);
  if (result.monsterEffect) spans.push(result.monsterEffect);
  if (result.spellTrapEffect) spans.push(result.spellTrapEffect);
  if (result.flavor) spans.push(result.flavor);

  // Add unclassified
  spans.push(...result.unclassified);

  return spans;
}

/**
 * Build the sections object for source profile output.
 */
export function buildTextSections(
  result: SegmentationResult,
): {
  material: TextSlice | null;
  pendulumEffect: TextSlice | null;
  monsterEffect: TextSlice | null;
  spellTrapEffect: TextSlice | null;
  flavor: TextSlice | null;
  unclassified: readonly TextSlice[];
  segmentation: SegmentationStatus;
} {
  return {
    material: result.material,
    pendulumEffect: result.pendulumEffect,
    monsterEffect: result.monsterEffect,
    spellTrapEffect: result.spellTrapEffect,
    flavor: result.flavor,
    unclassified: result.unclassified,
    segmentation: result.segmentation,
  };
}
