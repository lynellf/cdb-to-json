/**
 * Raw types for CDB database rows.
 * These represent the raw data as extracted from SQLite.
 * All INTEGER values use signed-int64 decimal string encoding.
 */

/**
 * A datas table row from a CDB database.
 * All numeric values are signed-int64 decimal strings.
 */
export interface RawDatasRow {
  id: string;
  ot: string | null;
  alias: string | null;
  setcode: string | null;
  type: string | null;
  atk: string | null;
  def: string | null;
  level: string | null;
  race: string | null;
  attribute: string | null;
  category: string | null;
}

/**
 * A texts table row from a CDB database.
 * Text values are decoded UTF-8 strings. NULL is represented as null.
 */
export interface RawTextsRow {
  id: string;
  name: string | null;
  desc: string | null;
  str1: string | null;
  str2: string | null;
  str3: string | null;
  str4: string | null;
  str5: string | null;
  str6: string | null;
  str7: string | null;
  str8: string | null;
  str9: string | null;
  str10: string | null;
  str11: string | null;
  str12: string | null;
  str13: string | null;
  str14: string | null;
  str15: string | null;
  str16: string | null;
}

/**
 * Combined raw rows for a card, representing the lossless source.
 * May have only datas or only texts if the join is incomplete.
 */
export interface RawCardRows {
  datas: RawDatasRow | null;
  texts: RawTextsRow | null;
  /** Zero-based ordinal in the datas table (null if no datas row) */
  dataOrdinal: number | null;
  /** Zero-based ordinal in the texts table (null if no texts row) */
  textOrdinal: number | null;
}

/**
 * Schema information for a CDB database.
 */
export interface CdbSchema {
  tables: readonly string[];
  datasColumns: readonly string[];
  textsColumns: readonly string[];
}

/**
 * Database metadata extracted during inspection.
 */
export interface DatabaseMetadata {
  path: string;
  fileName: string;
  sizeBytes: number;
  schema: CdbSchema;
  datasRowCount: number;
  textsRowCount: number;
}

/**
 * Table row counts from preflight.
 */
export interface RawTableCounts {
  datasRowCount: number;
  textsRowCount: number;
}

/**
 * Integer encoding scheme for raw values.
 */
export const INTEGER_ENCODING = "signed-int64-decimal" as const;
