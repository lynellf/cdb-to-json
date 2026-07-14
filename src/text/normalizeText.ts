/**
 * Text normalization for CDB card descriptions.
 *
 * Implements text-normalization/1:
 * - CRLF (\r\n) → LF (\n)
 * - CR (\r) → LF (\n)
 * - Unicode NFC (Canonical Decomposition, followed by Canonical Composition)
 *
 * The raw text is preserved exactly as stored in SQLite.
 * Normalization is applied to produce the normalized representation.
 *
 * @module text/normalizeText
 */

/**
 * Text normalization result.
 */
export interface NormalizationResult {
  /** Raw text as stored in SQLite (exact, including original line endings) */
  raw: string | null;
  /** Normalized text (CRLF/CR→LF, NFC Unicode) */
  normalized: string | null;
  /** Normalization policy version */
  normalizationVersion: "text-normalization/1";
}

/**
 * Normalize card text according to text-normalization/1.
 *
 * @param raw Raw text from SQLite (may be null for missing text)
 * @returns Normalization result with raw and normalized text
 */
export function normalizeText(raw: string | null): NormalizationResult {
  if (raw === null) {
    return {
      raw: null,
      normalized: null,
      normalizationVersion: "text-normalization/1",
    };
  }

  // Step 1: Normalize line endings
  // CRLF (\r\n) → LF (\n)
  // CR (\r) → LF (\n)
  let normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Step 2: Apply Unicode NFC (Canonical Decomposition, then Canonical Composition)
  // This normalizes combining characters and ensures canonical representation
  normalized = normalized.normalize("NFC");

  return {
    raw,
    normalized,
    normalizationVersion: "text-normalization/1",
  };
}

/**
 * Convert a UTF-16 code-unit offset into a string to the corresponding byte offset.
 *
 * JavaScript strings use UTF-16 code units internally, so character indices
 * in string methods correspond to UTF-16 code-unit positions.
 *
 * @param str The string to measure
 * @param utf16Offset UTF-16 code-unit offset (0 to str.length)
 * @returns Byte offset for the UTF-8 encoding at that position
 */
export function utf16OffsetToUtf8ByteOffset(str: string, utf16Offset: number): number {
  // Count bytes up to the UTF-16 offset
  let utf8ByteOffset = 0;
  let utf16Count = 0;

  for (const char of str) {
    if (utf16Count >= utf16Offset) break;

    // Encode char as UTF-8 to get its byte length
    const codePoint = char.codePointAt(0)!;

    if (codePoint <= 0x7f) {
      utf8ByteOffset += 1; // ASCII
    } else if (codePoint <= 0x7ff) {
      utf8ByteOffset += 2; // 2-byte sequence
    } else if (codePoint <= 0xffff) {
      utf8ByteOffset += 3; // 3-byte sequence (BMP characters)
    } else {
      utf8ByteOffset += 4; // 4-byte sequence (astral characters)
    }

    utf16Count += char.length;
  }

  return utf8ByteOffset;
}

/**
 * Compute the number of UTF-16 code units in a string.
 * This equals string.length for most strings, but handles surrogate pairs correctly.
 *
 * @param str The string to measure
 * @returns Number of UTF-16 code units
 */
export function utf16Length(str: string): number {
  let length = 0;
  for (const char of str) {
    length += char.length;
  }
  return length;
}
