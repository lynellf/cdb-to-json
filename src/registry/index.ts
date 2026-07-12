/**
 * Registry exports.
 * Versioned registries for CDB field decoding.
 */

// Card Types
export { CARD_TYPE_VERSION } from "./cardTypes.v1.js";
export { MonsterTrait } from "./cardTypes.v1.js";
export { SpellType } from "./cardTypes.v1.js";
export { TrapType } from "./cardTypes.v1.js";
export type { CardKind, MonsterTrait as MonsterTraitType, SpellType as SpellTypeType, TrapType as TrapTypeType, TypeDecodeResult } from "./cardTypes.v1.js";
export { getCardKind, getMonsterTraits, getSpellType, getTrapType, decodeType } from "./cardTypes.v1.js";

// Attributes
export { ATTRIBUTE_VERSION, Attribute } from "./attributes.v1.js";
export type { AttributeDecodeResult } from "./attributes.v1.js";
export { decodeAttribute, getPrimaryAttribute } from "./attributes.v1.js";

// Monster Types
export { MONSTER_TYPE_VERSION, MonsterType } from "./monsterTypes.v1.js";
export type { MonsterTypeDecodeResult } from "./monsterTypes.v1.js";
export { decodeMonsterType, getPrimaryMonsterType } from "./monsterTypes.v1.js";

// Link Markers
export { LINK_MARKER_VERSION, LinkMarker, LINK_MARKER_DISPLAY_NAMES } from "./linkMarkers.v1.js";
export type { LinkMarkerDecodeResult } from "./linkMarkers.v1.js";
export { decodeLinkMarkers, isLikelyLinkMarkers } from "./linkMarkers.v1.js";

// Availability
export { AVAILABILITY_VERSION, Availability } from "./availability.v1.js";
export type { AvailabilityDecodeResult } from "./availability.v1.js";
export { decodeAvailability, getPrimaryAvailability } from "./availability.v1.js";

// Categories
export { CATEGORY_VERSION, Category } from "./categories.v1.js";
export type { CategoryDecodeResult } from "./categories.v1.js";
export { decodeCategory } from "./categories.v1.js";

// Setcodes
export { SETCODE_VERSION, MAX_SETCODE_COUNT, SETCODE_MASK } from "./setcodes.v1.js";
export type { UnpackedSetcode, SetcodeDecodeResult } from "./setcodes.v1.js";
export { unpackSetcode, validateSetcode, formatSetcode } from "./setcodes.v1.js";

// Progression
export { PROGRESSION_VERSION, LevelField, LINK_RATING_MIN, LINK_RATING_MAX, PENDULUM_SCALE_MIN, PENDULUM_SCALE_MAX } from "./progression.v1.js";
export type { ProgressionDecodeResult } from "./progression.v1.js";
export { getProgressionType, decodeProgression, validateProgression } from "./progression.v1.js";

// Stats
export { STATS_VERSION, UNKNOWN_STAT_SENTINEL, MAX_VALID_STAT, MIN_VALID_STAT } from "./stats.v1.js";
export type { StatDecodeResult } from "./stats.v1.js";
export { decodeStat, decodeDefense, formatStat } from "./stats.v1.js";
