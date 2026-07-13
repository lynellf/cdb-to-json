# Phase 2 — one reader-owned snapshot session and raw envelope

## Goal and dependency

Expose verified physical metadata and raw rows from one lifecycle, then map one
active database into a schema-valid `cdb.raw/1` envelope. This phase depends on
Phase 1's normalized limits and pre-open plan. It must preserve the public
`iterateRawCards()` async iterator and compatibility bridge.

## Files and bounded discovery

Change:

- `src/cdb/iterateRows.ts`
- `src/cdb/snapshotBundle.ts`
- `src/cdb/materializeSnapshot.ts`
- `src/cdb/openDatabase.ts`
- `src/cdb/textPreflight.ts`
- `src/cdb/rawTypes.ts`
- `src/application/stagingBudget.ts`
- `src/application/types.ts`
- `src/profiles/rawProfile.ts`
- `src/hashing/sha256.ts`

Create if needed:

- `src/cdb/readDatabase.ts` (the internal metadata-aware session boundary)
- `src/cdb/sourceHandle.ts` (opaque source identity/read binding)
- `tests/cli/rawProfile.test.ts`
- `tests/conformance/rawOutput.test.ts`
- `tests/reader/sourceHandleBinding.test.ts`

Extend these exact inherited R5.6 gates rather than creating alternate reader or
API gate names:

- `tests/reader/walMaterialization.test.ts`
- `tests/reader/textByteFidelity.test.ts`
- `tests/reader/physicalSnapshotProvenance.test.ts`
- `tests/reader/stagingSnapshotBudget.test.ts`
- `tests/api/iterateRawCards.test.ts`
- `tests/api/iterateRawCards.types.test.ts`

Inspect the current snapshot/materialization functions and raw types before
editing; do not open a second live database from the application to obtain
metadata.

## Implementation tasks

### 2.1 Define the reader-owned session

Introduce one internal session or callback whose contract contains verified
metadata and an async row iterator, for example:

```ts
interface RawDatabaseMetadata {
  sourcePath: string;
  fileName: string;
  sourceSizeBytes: number;
  bundleSha256: `sha256:${string}`;
  extraTables: readonly {
    name: string;
    columns: readonly string[];
    rowCount: number;
  }[];
}

interface RawDatabaseRead {
  metadata: RawDatabaseMetadata;
  rows: AsyncIterableIterator<RawCardRows>;
  close(): Promise<void>;
}
```

The final API may differ, but snapshot acquisition, copied-bundle WAL replay,
materialization, metadata queries, preflight, iteration, and reader-owned
cleanup must be owned by one session. `iterateRawCards()` delegates to that
session, so direct consumers still get an asynchronous iterator with
`return()`/`finally` cleanup. The session's `close()` releases SQLite,
materialized/copy resources, and reader-private staging after rows are consumed;
when used by `convertCatalog`, ownership of the still-open SourceHandle and its
source-parent handle transfers to the conversion transaction. The application
retains that handle plus the trusted destination ParentHandle/LeaseHandle
through final source/output identity recheck and the native commit barrier, then
closes/releases them in `finally`. It consumes the session rather than
hashing/opening the source a second time.

### 2.2 Enforce physical snapshot and staging invariants

- Capture the present main/WAL/SHM members before opening. Compare identity and
  bytes before and after copy; detect size, timestamp, hash, appearance, and
  disappearance changes and retry only the bounded number already specified.
- Reject the pre-copy member-size sum when it exceeds either
  `maxSnapshotBytes` or remaining aggregate `maxStagingBytes`. Reserve each
  physical private file before copy/write; reconcile actual growth and release
  exactly once. Materialized main bytes are a separate physical reservation,
  not a second charge for the source member.
- Open only the copied bundle for WAL-capable replay and `VACUUM INTO` a private
  main-only database. Close that connection before opening the materialized
  database read-only with `immutable=1`. Never live-read or use immutable mode
  to replay source WAL. Remove snapshot/materialized directories on success,
  error, and cancellation after provenance is captured.
- Keep `bundleSha256` as the physical identity. Do not expose a logical hash that
  hides physical layout changes. Preserve the original main-file size in raw
  metadata.

### 2.3 Validate schema, storage classes, IDs, and text bytes

- Validate required `datas` and `texts` tables and every fixed supported column
  before the join. Read extra table names/columns/counts with safely quoted
  identifiers; never select arbitrary extra-table cell values.
- Before duplicate checks or joins, require non-null SQLite INTEGER IDs in the
  signed 64-bit range. Require INTEGER or NULL for supported numeric data cells;
  require TEXT or NULL for text cells. Emit `INVALID_CARD_ID` or
  `INVALID_INTEGER_VALUE` without coercion.
- Order IDs numerically by canonical signed-int64 value and assign source
  ordinals from that order, with datas branch before a text orphan at the same
  ID. This makes output and merge decisions independent of insertion order.
- Require SQLite `PRAGMA encoding` to be exactly UTF-8 before text selection;
  non-UTF-8 emits `UNSUPPORTED_DATABASE_ENCODING` (exit `4`). Keep the existing
  count and text-byte preflights. Before byte-size checks, reject a supported
  text cell whose storage class is not TEXT or NULL with `INVALID_TEXT_VALUE`
  (exit `4`). Select valid text fields as BLOB, decode with
  `TextDecoder("utf-8", { fatal: true })`, and emit `INVALID_TEXT_ENCODING` for
  invalid bytes before any envelope can be published. Never turn an invalid byte
  sequence into null. Preserve CRLF, CR, LF, empty strings, and nulls exactly
  after decoding.
- Convert every SQLite INTEGER to an exact decimal string, including signed
  64-bit extrema. Ensure reader errors reject/abort the session instead of being
  swallowed as an empty successful stream. Promote warnings only at the agreed
  strict-policy boundary.
- Check the abort signal per row and await `scheduler.yield()` at least once in
  each 256-row window. Preserve cleanup when the consumer calls `return()`.

### 2.4 Build the raw envelope

Replace the CLI path's per-card envelope interpretation with a database-envelope
builder. It may retain rows for the active database only, bounded by the table
row limits and output budget; it must not retain envelopes or row arrays across
multiple databases. Keep `mapRawCard`/`mapDatabaseToRaw` only for existing
compatibility imports and ensure `convertCatalog` cannot call them per row.

The builder emits, in fixed insertion order:

- `schema: "cdb.raw/1"`;
- `integerEncoding: "signed-int64-decimal"`;
- source `fileName`, verified `sha256`, original `sizeBytes`, and converter;
- supported `datas` and `texts` arrays containing present rows only; and
- metadata-only `extraTables`.

Datas-only/texts-only records retain their present raw rows and diagnostics;
missing partner values do not become fabricated rows. Preserve all fixed columns,
including null and empty text values.

### 2.5 Correct provenance tests and schema fixtures

Update physical-provenance tests so two physical layouts with equal canonical
rows/ordinals have equal row content but different bundle hashes. Add a WAL-only
committed-row fixture and assert no original member mutation or extraction
sidecar. Add invalid UTF-8, invalid ID/storage class, extra-table/WAL budget, and
materialization-failure fixtures. Update the raw schema to require
`integerEncoding`, `extraTables`, fixed columns, signed-decimal strings, nullable
supported values, and metadata-only extra tables.

## Tests and acceptance criteria

Run:

```bash
npm run build
npm run test:reader
npm run test:compat
npx vitest run tests/reader/walMaterialization.test.ts tests/reader/textByteFidelity.test.ts tests/reader/physicalSnapshotProvenance.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/reader/sourceHandleBinding.test.ts tests/cli/limitRelations.test.ts tests/api/iterateRawCards.test.ts tests/api/iterateRawCards.types.test.ts
npm run test:cli -- --run tests/cli/rawProfile.test.ts
npm run test:conformance -- --run tests/conformance/rawOutput.test.ts
```

Assert that:

- the session performs one snapshot/materialization/open lifecycle and supplies
  metadata without a second live source open;
- WAL-only rows are visible only through copied-bundle materialization;
- source bundle hash is physical, raw rows/ordinals are canonical, and source
  size is the original main-file size;
- all supported INTEGER/text values are exact, invalid bytes/storage classes fail
  with stable codes, and orphan diagnostics retain the present raw branch;
- staging reservations cover source copies and materialized output and are
  released on all paths; and
- no all-database `RawCardRows[]` accumulator exists in the application path.

**Stop condition:** a live hash/open is used, malformed UTF-8 becomes null, an
integer is rounded, a source member bypasses staging, or reader failure becomes a
successful empty envelope.

## Rollback

Revert only the new session and raw-envelope wiring while retaining the existing
Phase 0–1 iterator and fixtures. Before rollback completion run the reader and
compatibility gates and verify all temporary staging directories are absent.

## B2-R2 implementation amendment — bind reads to one source handle

This amendment supersedes the path-oriented acquisition wording above. Add a
bounded `src/cdb/sourceHandle.ts` (or an equivalently explicit module) whose
opaque `SourceHandle` owns the opened regular main descriptor, source-parent
descriptor/main leaf, and original device/inode/type/size identity. The default
policy is `followSymlinks=false` and rejects a source symlink; explicit follow
policy resolves once and binds the resolved descriptor.

Change the internal session boundary to accept the handle, not a string:

```text
openSourceIdentity(inputPath, followSymlinks) -> SourceHandle
acquireSnapshotBundle(sourceHandle, budget, limits, signal) -> SnapshotBundle
materializeSnapshot(bundle, budget, signal) -> MaterializedSnapshot
openMaterializedSnapshot(materialized) -> ReaderDatabase
```

After deterministic discovery, the concrete planner acquires one source
handle per input before any snapshot/open call. `iterateRawCards` and the
metadata-aware session consume that handle and pass it through snapshot
capture, descriptor-relative main/WAL/SHM reads, identity/byte verification,
materialization, metadata, row iteration, and the final source/output identity
check. No application or reader code may call `computeFileHash(input.path)` or
`acquireSnapshotBundle(sourcePath)`. Immediately before publication, native
`fstatat` rechecks the held source-parent/main-leaf against the SourceHandle
identity. Hold the source handle through the final source/output identity check
and native commit barrier, then close it in `finally`; replacement of a source
pathname must not redirect reads to a replacement inode. The reader session has
a separate cleanup boundary: after metadata and row iteration complete, close
the SQLite connection, materialized main, copied WAL bundle, and their private
snapshot/materialization artifacts, but transfer the still-open SourceHandle
(and its source-parent handle) to the conversion transaction. The conversion
also retains the trusted destination ParentHandle and LeaseHandle through the
final native recheck; it releases/closes all of those handles in `finally` after
`COMMITTED`, `NOT_COMMITTED`, or one-time `INDETERMINATE` reconciliation.
Sidecar appearance/disappearance and content changes are handled by the
existing bounded stability retry, but the bytes for each attempt are read
through descriptors bound to the captured source parent rather than reopened
through an unchecked path. Lifecycle and cancellation tests must prove no
source, parent, or lease handle is closed before the final recheck.

Add `tests/reader/sourceHandleBinding.test.ts` to swap main and sidecar paths
between planning, snapshot copy, materialization, and commit. The test must
assert either a stable read from the originally opened handle or a definite
source-mutation rejection. Swapping back before a path recheck must not make it
possible for replacement bytes to have been read; a string-only recheck is not
acceptable. Include this test in the secure-destination focused gate and in the
Phase 2 reader gate.
