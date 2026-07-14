/**
 * Text processing types for the source profile.
 *
 * @module text/types
 */

/**
 * A text slice with source position information.
 *
 * Offsets are UTF-16 code-unit positions into text.normalized.
 * The text field must equal normalized.slice(start, end).
 */
export interface TextSlice {
  /**
   * Copied text content extracted from text.normalized using start/end offsets.
   */
  text: string;

  /**
   * Inclusive start offset in UTF-16 code units from the beginning of text.normalized.
   */
  start: number;

  /**
   * Exclusive end offset in UTF-16 code units from the beginning of text.normalized.
   */
  end: number;

  /**
   * Semantic classification of this text segment.
   * Examples: material, pendulum_effect, monster_effect, spell_trap_effect, flavor, unclassified
   */
  kind: string;

  /**
   * Basis for the offsets: always "normalized" (offsets are into text.normalized).
   */
  basis: "normalized";
}

/**
 * Text section kinds.
 */
export const TEXT_KIND = {
  MATERIAL: "material",
  PENDULUM_EFFECT: "pendulum_effect",
  MONSTER_EFFECT: "monster_effect",
  SPELL_TRAP_EFFECT: "spell_trap_effect",
  FLAVOR: "flavor",
  UNCLASSIFIED: "unclassified",
} as const;

export type TextKind = (typeof TEXT_KIND)[keyof typeof TEXT_KIND];
