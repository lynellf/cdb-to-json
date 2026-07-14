# Phase P2 — Explicit CDB reader and compatibility bridge (delivery Phase 1)

## Outcome

Replace the generic, logging, read-write database loader with a safe explicit reader while preserving the v1 default-export path through a tested adapter. The output of this phase is a reusable raw row iterator and schema diagnostics; profile mapping and CLI parsing remain later phases.

## Ordered tasks

### 1.1 Implement deterministic input discovery and path policy

Create `src/discovery/discoverCdbInputs.ts` and `src/discovery/pathPolicy.ts`. Accept one file or directory, accept only a case-insensitive final `.cdb` extension, preserve command-line argument order, and sort each directory's results by slash-normalized relative path. Match repeatable `--exclude` globs against normalized paths relative to the supplied root before following links; explicit files are matched against their basename and root-relative path. Skip discovered symlinks by default. With `--follow-symlinks`, track realpaths to avoid cycles and visit a target once. Carry a display-safe path plus absolute path internally and never use an output path in a source hash.

Keep legacy discovery separate: `legacyConvert` must retain direct-child names containing `.cdb`, old first-dot basename derivation, and basename-based `ignore`; modern discovery must not reuse those rules. Distinguish directory traversal from explicit symlink inputs: discovered symlinks are skipped by default; with `--follow-symlinks`, an allowed target is canonicalized and tracked before `sourceHandle`, while `sourceHandle` still rejects any symlink/non-regular source member. Add tests for nested directories, glob base/normalization, explicit files, dotted/non-final names, explicit symlink resolution, symlink default/follow/cycles, excludes, and deterministic ordering.

**Files:** `src/discovery/discoverCdbInputs.ts`, `src/discovery/pathPolicy.ts`, `tests/reader/discovery.test.ts`, `tests/compatibility/legacyNames.test.ts`.

### 1.2 Implement read-only lifecycle, integer policy, limits, and explicit schema validation

Create `src/cdb/sourceHandle.ts`, `src/cdb/openDatabase.ts`, `src/cdb/inspectSchema.ts`, and `src/cdb/iterateRows.ts`. `sourceHandle.ts` owns the source-member snapshot/materialization/extraction lifecycle and idempotent cleanup. Open `better-sqlite3` only through a URI for the private materialized main with `uri: true`, `readonly: true`, `fileMustExist: true`, `immutable=1`, call `defaultSafeIntegers()` before value queries, and disable extension loading. Validate required tables/columns before iteration. Use fixed quoted statements for the supported `datas` and `texts` columns; never construct SQL from arbitrary table names or execute `SELECT *` over user tables. Record extra table/column metadata without reading unsupported table contents. For each extra table, obtain its metadata row count with a safely quoted, value-free bounded probe capped at `limits.maxRowsPerTable + 1` (compute the sentinel with `BigInt`, without numeric coercion); record the exact count only when below the cap, and emit `RESOURCE_LIMIT_EXCEEDED` with `details.limitCode: "MAX_EXTRA_TABLE_ROWS_EXCEEDED"` on the sentinel. Never use unbounded `COUNT(*)` for an extra table or select any extra-table cell.

`iterateRows()` exposes source ordinals and preserves SQLite INTEGER values as signed-64-bit decimal strings (`integerEncoding: "signed-int64-decimal"`) along with exact strings and nulls. Parse only validated decimal integers; reject values outside signed 64-bit with `INTEGER_OUT_OF_RANGE`. Enforce `limits.v1`: default max 1,000,000 rows per required table and 4 MiB stored SQLite UTF-8 bytes per text value, configurable before iteration. Count required rows before row-value materialization (after private snapshot/materialization has made the read connection available). Before the full join, run fixed byte-length-only queries for each `texts` column that select only IDs and lengths for values over the limit; never select an oversized text value. Require TEXT/NULL cells and reject non-text or invalid UTF-8 values. Repeat the byte check after retrieval.

Capture/copy/hash the main database plus every present `-wal`/`-shm` sidecar before any SQLite open. Every member must be a regular non-symlink file; missing/changed/appearing sidecars are rejected or retried, never followed. The one physical identity is SHA-256 of repository-canonical compact UTF-8 JSON for exactly this fixed array (with copied bytes, not source paths): `[ {"name":"main","present":true,"bytesBase64":"<exact copied bytes>"}, {"name":"-wal","present":<boolean>,"bytesBase64":<exact copied bytes or null>}, {"name":"-shm","present":<boolean>,"bytesBase64":<exact copied bytes or null>} ]`; absent members remain explicit with `present:false` and `bytesBase64:null`. Copy and hash incrementally with bounded base64 carry state; do not materialize the complete member or tuple string in one JavaScript allocation. Re-stat/re-hash original members before any SQLite open, retry bounded races, and never open an original member for extraction. Reserve all source/materialization/private SQLite sidecar bytes through `src/application/stagingBudget.ts`. Open the copied bundle only with ordinary WAL-capable SQLite access in `src/cdb/materializeSnapshot.ts`; encode the private `VACUUM INTO` path as a verified SQLite literal (including quote-bearing staging-path tests), run it to a private main-only materialized file, inventory generated private journal/WAL/SHM files, and close the bundle connection. Reject replay/materialization failure as `CDB_OPEN_FAILED` without a live-read fallback. Then open only the materialized main file through a URI with `uri: true`, `immutable=1`, and `defaultSafeIntegers()`; extraction never opens a WAL/SHM member and cannot create a sidecar. Verify copied members before publication and delete every source/materialized/generated-private artifact in the `sourceHandle.ts` finally path. Any acquisition mutation, sidecar appearance/disappearance, or unstable snapshot emits `SOURCE_MUTATED_DURING_READ` and prevents output. `iterateRows()` checks `AbortSignal` every row and awaits `scheduler.yield()` at least once per 256-row window so synchronous SQLite iteration is cancellable.

Every database handle is closed in `finally` on success, schema/limit/integer failure, iterator failure, writer failure, source mutation, `AbortSignal`, and SIGINT. Add lifecycle spies and child-process coverage rather than relying only on a successful read.

**Files:** `src/cdb/openDatabase.ts`, `src/cdb/inspectSchema.ts`, `src/cdb/iterateRows.ts`, `src/application/limits.ts`, `src/hashing/sha256.ts`, `tests/reader/openDatabase.test.ts`, `tests/reader/schema.test.ts`, `tests/reader/iterateRows.test.ts`, `tests/reader/resourceLimits.test.ts`.

### 1.3 Add a bounded full join and row-level diagnostics

Create `src/application/readCdb.ts` and `src/application/diagnosticsPolicy.ts`. Preflight duplicate IDs with fixed `GROUP BY id HAVING COUNT(*) > 1` statements and run the text byte-length preflight before the full join. Any duplicate or resource/text-type failure is a schema/input error and prevents output; it must not be resolved by a many-to-many join. Then stream an explicit-column full logical join implemented as `datas LEFT JOIN texts` plus an orphan-`texts` `UNION ALL` branch, carrying `dataOrdinal`/`textOrdinal`, decimal-string IDs, and all supported raw columns. Order by canonical decimal card ID and available source ordinal. This uses no JavaScript table map and retains orphan rows.

Emit `MISSING_DATA_ROW`/`MISSING_TEXT_ROW` for incomplete records. Apply the matrix in the tactical spec: incomplete/unknown/malformed warnings become errors under strict mode, while duplicate/schema/resource/integer failures are always errors. Add a large generated fixture containing missing partners, duplicate IDs, extra tables, a large extra table, and late rows; prove raw fidelity, diagnostics, ordinals, ordering, required-table limits, bounded extra-table metadata probing, no extra-cell query, and bounded memory. Add `tests/reader/extraTableLimits.test.ts` as the focused large-extra-table gate.

**Files:** `src/application/readCdb.ts`, `src/application/diagnosticsPolicy.ts`, `tests/reader/joinDiagnostics.test.ts`, `tests/reader/largeJoin.test.ts`, `tests/reader/extraTableLimits.test.ts`.

### 1.4 Implement the concrete compatibility bridge

Create `src/legacy.ts`. It adapts the new raw reader to `LegacyTableResult[]` and writes through the new destination abstraction only after the raw value has been fully read. Since the v1 signature has no force option, a non-null `outputDir` is explicit compatibility authorization to replace old-named files; use the reservation protocol and force-compatible atomic commit only for those files, and preserve a pre-existing final on every pre-commit failure. Preserve:

- default `emit` behavior and explicit `emit: false` behavior;
- direct-child candidates whose names contain `.cdb`, old first-dot basename-without-extension derivation, and `ignore` by that derived name;
- deterministic candidate ordering and `<basename>.json` filenames with raw `{ datas, texts }` contents;
- the old fixture logical content and wrapped failure behavior;
- safe legacy integer conversion: decimal integers within `Number.MAX_SAFE_INTEGER` retain the v1 JSON number shape, while unsafe values fail with `LEGACY_INTEGER_UNREPRESENTABLE` before any output is renamed;
- a preflight `LEGACY_BASENAME_COLLISION` error for two candidates that derive the same old basename, avoiding silent overwrite.

Modern exact-final-extension discovery must not be used by this adapter. Dotted and non-final-suffix names are explicit compatibility fixtures, and the migration document must call out this difference. Keep `app/index.js` as a tiny ESM shim importing `../dist/legacy.js`, and make `src/index.ts` export named modern APIs plus a deprecated default `legacyConvert`. The package root (not `app/index.js`) is the supported packed-artifact legacy path during 2.x. Do not emit deprecation warnings to stdout.

**Files:** `src/legacy.ts`, `src/index.ts`, `app/index.js`, `tests/compatibility/legacy.test.ts`, `tests/compatibility/legacy-output.test.ts`.

### 1.5 Replace the old implementation only after compatibility tests exist

Once the new reader and bridge tests pass, remove or stop using `app/getDirectory.js` and `app/getTables.js`. Do not leave a second path that logs, opens writable databases, or dynamically queries arbitrary tables. Preserve the files only if a package/export compatibility decision explicitly requires them; otherwise delete them and document the migration. `app/index.js` remains source-tree test support; the packed package uses `main: dist/index.js` and the root export for legacy compatibility.

**Files:** `app/getDirectory.js`, `app/getTables.js`, `README.md` (minimal compatibility note).

## Gate and commands

```bash
npm run build
npm run test:fixtures
npm run test:unit
npm run test:conformance
npm run test:reader
npm run test:compat
npm run test:api
npm run test:cli
npm run package:check
npm test
```

The compatibility gate must invoke `app/index.js` against `__tests__/input_dir/cards.cdb`, compare parsed raw `datas`/`texts` data to the checked-in logical fixture, verify output-directory creation and no-output behavior, test `ignore`, dotted/non-final legacy candidates, derived-basename collisions, unsafe legacy integers, and capture stdout/stderr to assert that the library emits no logs. Because the v1 signature has no force option, a non-null `outputDir` explicitly authorizes atomic replacement of its old `<basename>.json` files; test two successive writes, an injected failed second write preserving the prior final, and output-directory creation. Reader tests must prove `sourceHandle` closes every source, materialized, generated private SQLite, and legacy output resource on all failure paths; byte-length preflight rejects oversized text before a value-selecting join/destination; enforce row/text limits, use signed-64 decimal raw values, reject source mutation/WAL changes, and prove a fixture's extra table is not queried. P2 does not assert merge spool/index/lineage accounting or modern conversion lifecycle; those are P3/P4 gates. Run the same raw import from a clean packed artifact in Phase 5; `app/index.js` is not asserted to be present in the tarball.

## Stop/rollback conditions

- Stop if the old fixture cannot be represented by the explicit `datas`/`texts` reader without changing raw values; add a raw compatibility exception only through a documented contract decision.
- Stop if any database handle remains open after an injected iterator or writer failure.
- Roll back only the `src/cdb`, `src/application/readCdb`, and legacy adapter changes if this gate fails; keep Phase 0 contracts/fixtures intact.

## Dependencies and scope

Depends on Phase 0. The CLI is not implemented here. This phase is intentionally limited to discovery, SQLite lifecycle, raw joins, diagnostics, and the compatibility adapter.

## Revision-5 senior remediation tasks and gates

The following tasks supersede the Revision-4 reader wording where it conflicts with the senior remediation specification. They must be implemented before the existing 1.2/1.3 full-join work can pass:

1. **Snapshot lifecycle and WAL materialization.** Add `src/cdb/sourceHandle.ts`, `src/cdb/snapshotBundle.ts`, and `src/cdb/materializeSnapshot.ts`. Acquire the input directory through a held descriptor and traverse parent components with `openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)` or equivalent descriptor-relative `openat(O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`. Open each main/WAL/SHM member with `O_NOFOLLOW|O_RDONLY|O_CLOEXEC` (or equivalent), hold that descriptor through copy/hash, fstat-verify the same regular-file identity observed by `lstat`, and never copy by path after lstat. Reject symlink/non-regular members, stream-copy and incrementally hash the ordered member tuple with explicit presence markers, re-stat/re-hash originals, and retry bounded races. Add `tests/reader/sourceMemberSwap.test.ts` for deterministic lstat-to-open swaps of main, `-wal`, and `-shm`; it must prove no replacement target bytes are read and stable `INVALID_PATH`/`SOURCE_MUTATED_DURING_READ` cleanup. If the safe source primitive is unavailable, fail before SQLite rather than falling back to a path copy. Open only the copied bundle for WAL replay, use a verified SQLite literal for `VACUUM INTO`, inventory generated private journals/WAL/SHM, then close it before URI+immutable/default-safe-integer extraction. Add `tests/reader/walMaterialization.test.ts` and `tests/reader/physicalSnapshotProvenance.test.ts` for a committed WAL-only row, source/member immutability, hostile staging names, no extraction sidecar, materialization failure/no publish, physical hash changes after physical reorder, and stable `canonicalDataProjection(record)` values/ordinals/winners (with full-record physical identity differences asserted later).
2. **Encoding and byte-fidelity preflight.** Add `src/cdb/textPreflight.ts`. Require `PRAGMA encoding = 'UTF-8'`; check `typeof()` before byte limits; select only `CAST(column AS BLOB)` for retained cells; decode with fatal UTF-8 `TextDecoder`. Add `tests/reader/textByteFidelity.test.ts` for UTF-16 rejection, wrong storage type precedence, over-limit non-selection, under-limit non-ASCII/astral text, and invalid bytes (`INVALID_TEXT_ENCODING`).
3. **Bounded staging.** Add `src/application/stagingBudget.ts` and `tests/reader/stagingSnapshotBudget.test.ts`. Add `maxSnapshotBytes` (4 GiB default) as a dedicated aggregate snapshot/materialization counter covering copied source members, the materialized main, and generated private SQLite journal/WAL/SHM/temp siblings. Reject the pre-copy member sum early, then reserve every copy/write chunk before writing and reconcile actual growth; include source-growth-after-stat, materialized-main overflow, generated-private overflow, and cleanup vectors. Charge each physical file once to the snapshot counter and once to the aggregate `maxStagingBytes` counter, never twice within one counter. Reserve/reconcile each source/materialized/generated-private SQLite/legacy temporary file once, and clean all inventory members on success/failure/cancellation. The P2 gate contains no merge spool/index/lineage reservation assertion.
4. **Reject-only limit relations.** Add `src/application/normalizeOptions.ts` and `tests/cli/limitRelations.test.ts`. Validate every limit as a non-negative safe integer before discovery/open; reject `maxSpoolBytes > maxStagingBytes` or `maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION` exit 2. Equality, less-than, zero, and all diagnostic payloads/hash inputs are tested.
5. **Async iterator contract.** Add `src/application/iterateRawCards.ts` or the bounded equivalent that exports `AsyncIterableIterator<RawCardRows>` and is reused by `convert()`. Add `tests/api/iterateRawCards.test.ts` and `tests/api/iterateRawCards.types.test.ts` proving per-row signal checks, a scheduler checkpoint per 256 rows, direct-consumer `return()`/`finally` cleanup, abort rejection, and no synchronous public iterator.

Before the existing 1.2/1.3 full-join work can pass, implement the remaining stable input-shape contract from `spec.md`:

1. Add `src/cdb/sourceHandle.ts`, `src/cdb/snapshotBundle.ts`, and `src/cdb/materializeSnapshot.ts`: capture regular non-symlink main, `-wal`, and `-shm` members before opening SQLite, stream-copy the complete present bundle to a private sibling, incrementally hash the exact explicit presence/member-name/bytesBase64 tuple, and recheck original identities/bytes. Retry bounded acquisition races and emit `SOURCE_MUTATED_DURING_READ`; never silently omit or follow a sidecar. Open only the copied bundle with ordinary WAL-capable access, use a verified SQLite literal for `VACUUM INTO`, inventory generated private journal/WAL/SHM files, close that connection, and then open only a URI for the materialized file read-only with `immutable=1`, `uri:true`, and `defaultSafeIntegers()` before value selection. Add a valid-WAL baseline, hostile staging-name, regular-member, no-sidecar extraction assertion, generated-private cleanup, and materialization-failure/no-publish test; reject `CDB_OPEN_FAILED` rather than using a live fallback.
2. Read `PRAGMA encoding` before text selection and reject anything other than UTF-8 with `UNSUPPORTED_DATABASE_ENCODING` (exit 4). Before text length checks, query only fixed IDs, `typeof`, and byte lengths. Wrong storage class (`INVALID_TEXT_VALUE`) precedes an over-limit result; oversized valid TEXT is never selected; under-limit values are UTF-8 checked after retrieval. Add lifecycle spies proving snapshot temp files, databases, and transactions close in every failure path.
3. Validate all source storage classes before duplicate checks/join: non-null SQLite INTEGER for both IDs; INTEGER/NULL for other numeric `datas` cells; TEXT/NULL for `texts` cells. Reject NULL/numeric-looking TEXT/REAL/BLOB IDs with `INVALID_CARD_ID`, other wrong numeric cells with `INVALID_INTEGER_VALUE`, and never coerce. Add signed-int64 and malformed fixtures.
4. Replace insertion/source row order with canonical signed-int64 numeric ID order. Assign zero-based `dataOrdinal`/`textOrdinal` from that order, order joined rows by `(id, data-branch-before-text-orphan, ordinal)`, and prove physical insertion reorder preserves `canonicalDataProjection(record)`, canonical rows/ordinals, and `conversionOptionsHash` while changing the physical bundle hash/source revision. Merge winner invariance is deferred to P3/P4; legacy candidate semantics remain independently deterministic. The join must continue to use no JavaScript map.
5. The raw reader's scope is the fixed supported `datas`/`texts` columns. Extra tables/columns are metadata-only and must not be presented as losslessly captured cells. Datas-only/texts-only rows retain the present ID/raw side, null the absent side, emit the stable missing-partner diagnostic, and remain valid inputs for later card/source mappers.

The Phase-1 gate additionally runs:

```bash
npm run build
npm run test:reader
npm run test:compat
npm test
npx vitest run tests/reader/sourceMemberSwap.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/reader/extraTableLimits.test.ts tests/cli/limitRelations.test.ts
```

These commands are the evidence for `P2-AC1` through `P2-AC7`. `P2-AC7` requires every selected limit to be validated before discovery/input access, rejects `maxSnapshotBytes > maxStagingBytes` and `maxSpoolBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION` (exit 2), rejects a source bundle over `maxSnapshotBytes` with `RESOURCE_LIMIT_EXCEEDED` before copying/value selection, and then proves chunk-level snapshot/materialization reservation for source growth after stat and generated-private overflow. It proves once-only reserve/reconcile/release plus cleanup of source/materialized/generated-private SQLite/legacy temporary files on success, failure, and cancellation. It does not test merge spool/index/lineage accounting. The gate fails if a valid WAL database is rejected as self-mutating, a UTF-16 database reaches preflight, an invalid ID reaches the join, insertion order changes an ordinal, an oversized value is selected, an orphan requires a fabricated field, any source member symlink is followed, URI immutable/default-safe-integer extraction is absent, or any snapshot/SQLite/private artifact survives failure.

## Revision-12 enforcement correction

The Revision-11 snapshot and staging text is superseded by
`phase-r11-enforcement-and-gates.md`. P2 must specify and test the complete
absolute/relative held-anchor algorithm, keep member descriptors through a
second digest/fstat, and include parent-component and same-inode mutation
adversaries. `maxSnapshotBytes` must be admitted by the real page/WAL-derived
materialization bound in `materialization-quota.md` before writable SQLite work;
an injected `StagingBudget` event is supplementary only. The isolated legacy
writer must use the same no-follow, held-parent, descriptor-relative native
publication matrix as modern file output and may not use path rename or
cross-device copy. P2 cannot hand off to P3 until the dispatch guard, named
security/quota tests, and fresh evidence record pass.