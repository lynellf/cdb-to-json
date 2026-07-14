/**
 * Text processing module for source profile.
 *
 * Provides conservative text normalization and segmentation for card descriptions.
 *
 * @module text
 */

// Normalization
export { normalizeText, utf16OffsetToUtf8ByteOffset, utf16Length, type NormalizationResult } from "./normalizeText.js";

// Segmentation
export {
  segmentCardText,
  getSourceSpans,
  buildTextSections,
  PENDULUM_MARKER,
  MONSTER_EFFECT_MARKER,
  type SegmentationResult,
  type SegmentationStatus,
} from "./segmentCardText.js";

// Types
export { TEXT_KIND, type TextSlice, type TextKind } from "./types.js";
