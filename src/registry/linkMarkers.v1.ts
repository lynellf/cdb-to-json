/**
 * Link marker registry v1 - defines link arrow bitflags.
 *
 * Registry version: cdb-normalization/1
 * Based on Project Ignis YGOPro definitions.
 *
 * Link markers are stored in the `def` field of datas table for LINK monsters.
 * Each marker is a single bit representing one of 8 link arrow directions.
 *
 * Bit positions (same as YGOPro):
 * - Bottom-Left = 0x1
 * - Bottom = 0x2
 * - Bottom-Right = 0x4
 * - Left = 0x8
 * - Right = 0x10
 * - Top-Left = 0x20
 * - Top = 0x40
 * - Top-Right = 0x80
 */

export const LINK_MARKER_VERSION = "cdb-normalization/1" as const;

/**
 * Link marker bitflags.
 */
export const LinkMarker = {
  BOTTOM_LEFT: 0x1,
  BOTTOM: 0x2,
  BOTTOM_RIGHT: 0x4,
  LEFT: 0x8,
  RIGHT: 0x10,
  TOP_LEFT: 0x20,
  TOP: 0x40,
  TOP_RIGHT: 0x80,
} as const;

export type LinkMarker = (typeof LinkMarker)[keyof typeof LinkMarker];

/**
 * Link marker names in display order.
 */
export const LINK_MARKER_DISPLAY_NAMES: Record<number, string> = {
  [LinkMarker.TOP_LEFT]: "Top-Left",
  [LinkMarker.TOP]: "Top",
  [LinkMarker.TOP_RIGHT]: "Top-Right",
  [LinkMarker.LEFT]: "Left",
  [LinkMarker.RIGHT]: "Right",
  [LinkMarker.BOTTOM_LEFT]: "Bottom-Left",
  [LinkMarker.BOTTOM]: "Bottom",
  [LinkMarker.BOTTOM_RIGHT]: "Bottom-Right",
};

/**
 * Decode result for link markers field.
 */
export interface LinkMarkerDecodeResult {
  /** Array of decoded marker names */
  markers: string[];
  /** OR of all decoded marker bits */
  decodedBits: number;
  /** Bits that weren't recognized */
  unknownBits: number;
  /** Number of link rating (count of markers) */
  linkRating: number;
  rawValue: number;
  registry: string;
}

/**
 * Decode link markers from the def field.
 * Returns markers and link rating.
 */
export function decodeLinkMarkers(defValue: number): LinkMarkerDecodeResult {
  const decodedBits: number[] = [];

  if (defValue & LinkMarker.TOP_LEFT) decodedBits.push(LinkMarker.TOP_LEFT);
  if (defValue & LinkMarker.TOP) decodedBits.push(LinkMarker.TOP);
  if (defValue & LinkMarker.TOP_RIGHT) decodedBits.push(LinkMarker.TOP_RIGHT);
  if (defValue & LinkMarker.LEFT) decodedBits.push(LinkMarker.LEFT);
  if (defValue & LinkMarker.RIGHT) decodedBits.push(LinkMarker.RIGHT);
  if (defValue & LinkMarker.BOTTOM_LEFT) decodedBits.push(LinkMarker.BOTTOM_LEFT);
  if (defValue & LinkMarker.BOTTOM) decodedBits.push(LinkMarker.BOTTOM);
  if (defValue & LinkMarker.BOTTOM_RIGHT) decodedBits.push(LinkMarker.BOTTOM_RIGHT);

  const decodedOr = decodedBits.reduce((acc, b) => acc | b, 0);
  const unknownBits = defValue & ~decodedOr;

  return {
    markers: decodedBits.map(bitToName),
    decodedBits: decodedOr,
    unknownBits,
    linkRating: decodedBits.length,
    rawValue: defValue,
    registry: LINK_MARKER_VERSION,
  };
}

/**
 * Convert a link marker bit to its name string.
 */
export function bitToName(bit: number): string {
  return LINK_MARKER_DISPLAY_NAMES[bit] ?? `UNKNOWN_${bit.toString(16)}`;
}

/**
 * Check if a def value represents link markers (non-zero and no unknown bits
 * in the lower byte, and no defense value interpretation).
 *
 * For LINK monsters, def field stores link markers.
 * For non-LINK monsters, def field stores defense points.
 *
 * Link markers use only the lower byte (0xFF).
 * If the upper bits are set, it might be a defense value.
 */
export function isLikelyLinkMarkers(defValue: number): boolean {
  // If value is small enough to be link markers, assume it is
  // Link ratings 1-6 are valid
  const lowerByte = defValue & 0xFF;
  const markerCount = decodeLinkMarkers(defValue).linkRating;

  // If we decode 1-6 markers and they fit in lower byte, likely link
  if (markerCount >= 1 && markerCount <= 6 && lowerByte === (defValue & 0xFF)) {
    return true;
  }

  // If it looks like a defense value (higher than typical link rating)
  // and no valid link pattern, probably not link markers
  return false;
}
