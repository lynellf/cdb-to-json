/**
 * Conservative text segmentation for card descriptions.
 *
 * Implements conservative segmentation rules:
 * - Exact markers first
 * - Conservative frame rules
 * - Source spans
 * - UNSPLIT fallback
 *
 * The converter MUST NOT:
 * - split effects merely at periods
 * - infer costs, targets, conditions, or resolution
 * - translate colon/semicolon punctuation
 * - classify if versus when triggers
 * - infer once-per-turn scope
 * - create executable operation names
 */

/**
 * Text slice with source position information.
 */
export interface TextSlice {
  text: string;
  start: number;
  end: number;
  basis: string;
}

/**
 * Segmentation result.
 */
export interface SegmentationResult {
  material: TextSlice | null;
  pendulumEffect: TextSlice | null;
  monsterEffect: TextSlice | null;
  spellTrapEffect: TextSlice | null;
  flavor: TextSlice | null;
  unclassified: readonly TextSlice[];
  segmentation: "EXACT_MARKERS" | "FRAME_RULE" | "UNSPLIT" | "PARTIAL";
}

/**
 * Pendulum effect marker.
 */
export const PENDULUM_MARKER = "[ Pendulum Effect ]";

/**
 * Monster effect marker.
 */
export const MONSTER_EFFECT_MARKER = "[ Monster Effect ]";

/**
 * Material marker pattern.
 */
export const MATERIAL_PATTERNS = [
  /\/\s*material\s*:/i,
  /materials?\s*:/i,
  /\/\s*tribute\s+怪兽/i, // Chinese
  /^★/m, // Star marker for materials
];

/**
 * Segment card text conservatively.
 *
 * Currently a stub that returns UNSPLIT.
 * Full implementation requires:
 * - Exact marker detection for pendulum/monster sections
 * - Frame-based flavor detection for normal monsters
 * - Material line detection for eligible Extra Deck/Ritual frames
 */
export function segmentCardText(
  description: string | null,
  _cardKind: string,
  _traits: string[],
): SegmentationResult {
  if (description === null) {
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

  // For now, just return the full description with UNSPLIT
  // Full implementation would:
  // 1. Check for exact pendulum/monster markers
  // 2. Apply frame-based rules
  // 3. Detect material lines
  return {
    material: null,
    pendulumEffect: null,
    monsterEffect: null,
    spellTrapEffect: null,
    flavor: null,
    unclassified: [
      {
        text: description,
        start: 0,
        end: description.length,
        basis: "raw",
      },
    ],
    segmentation: "UNSPLIT",
  };
}

/**
 * Check if text contains a pendulum effect marker.
 */
export function hasPendulumMarker(description: string): boolean {
  return description.includes(PENDULUM_MARKER);
}

/**
 * Check if text contains a monster effect marker.
 */
export function hasMonsterEffectMarker(description: string): boolean {
  return description.includes(MONSTER_EFFECT_MARKER);
}

/**
 * Extract pendulum and monster sections by exact markers.
 */
export function extractSectionsByMarkers(
  description: string,
): { pendulumEffect: string | null; monsterEffect: string | null } {
  const parts = description.split(PENDULUM_MARKER);

  if (parts.length === 2) {
    // Found pendulum marker
    return {
      pendulumEffect: parts[1].split(MONSTER_EFFECT_MARKER)[0].trim() || null,
      monsterEffect: parts[1].includes(MONSTER_EFFECT_MARKER)
        ? parts[1].split(MONSTER_EFFECT_MARKER)[1].trim() || null
        : null,
    };
  }

  // Check for monster effect marker without pendulum
  const monsterParts = description.split(MONSTER_EFFECT_MARKER);
  if (monsterParts.length === 2) {
    return {
      pendulumEffect: null,
      monsterEffect: monsterParts[1].trim() || null,
    };
  }

  return {
    pendulumEffect: null,
    monsterEffect: null,
  };
}

/**
 * Check if description appears to be a normal monster flavor text.
 */
export function isLikelyFlavorText(
  description: string,
  cardKind: string,
  traits: string[],
): boolean {
  // Normal monsters typically have short descriptions
  // that are just flavor text
  if (cardKind !== "MONSTER") {
    return false;
  }

  if (!traits.includes("NORMAL")) {
    return false;
  }

  // Short description suggests flavor text
  // (This is a heuristic, not definitive)
  return description.length < 100;
}
