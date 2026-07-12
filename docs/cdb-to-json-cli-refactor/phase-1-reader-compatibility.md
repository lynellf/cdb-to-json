# Phase 1 — Explicit CDB reader and compatibility bridge

## Outcome

Replace the generic, logging, read-write database loader with a safe explicit reader while preserving the v1 default-export path through a tested adapter. The output of this phase is a reusable raw row iterator and schema diagnostics; profile mapping and CLI parsing remain later phases.

## Ordered tasks

### 1.1 Implement deterministic input discovery and path policy

Create `src/discovery/discoverCdbInputs.ts` and `src/discovery/pathPolicy.ts`. Accept one file or directory, accept only a case-insensitive final `.cdb` extension, preserve command-line argument order, and sort each directory's results by slash-normalized relative path. Match repeatable `--exclude` globs against normalized paths relative to the supplied root before following links; explicit files are matched against their basename and root-relative path. Skip discovered symlinks by default. With `--follow-symlinks`, track realpaths to avoid cycles and visit a target once. Carry a display-safe path plus absolute path internally and never use an output path in a source hash.

Keep legacy discovery separate: `legacyConvert` must retain direct-child names containing `.cdb`, old first-dot basename derivation, and basename-based `ignore`; modern discovery must not reuse those rules. Add tests for nested directories, glob base/normalization, explicit files, dotted/non-final names, symlink default/follow/cycles, excludes, and deterministic ordering.

**Files:** `src/discovery/discoverCdbInputs.ts`, `src/discovery/pathPolicy.ts`, `tests/reader/discovery.test.ts`, `tests/compatibility/legacyNames.test.ts`.

### 1.2 Implement read-only lifecycle, integer policy, limits, and explicit schema validation

Create `src/cdb/openDatabase.ts`, `src/cdb/inspectSchema.ts`, and `src/cdb/iterateRows.ts`. Open `better-sqlite3` with `readonly: true`, `fileMustExist: true`, safe-integer mode enabled, and extension loading disabled. Validate required tables/columns before iteration. Use fixed quoted statements for the supported `datas` and `texts` columns; never construct SQL from arbitrary table names or execute `SELECT *` over user tables. Record extra table/column metadata without reading unsupported table contents.

`iterateRows()` exposes source ordinals and preserves SQLite INTEGER values as signed-64-bit decimal strings (`integerEncoding: "signed-int64-decimal"`) along with exact strings and nulls. Parse only validated decimal integers; reject values outside signed 64-bit with `INTEGER_OUT_OF_RANGE`. Enforce `limits.v1`: default max 1,000,000 rows per required table and 4 MiB stored SQLite UTF-8 bytes per text value, configurable before iteration. Count rows before materialization. Before the full join, run fixed byte-length-only queries for each `texts` column that select only IDs and lengths for values over the limit; never select an oversized text value. Require TEXT/NULL cells and reject non-text or invalid UTF-8 values. Repeat the byte check after retrieval.

Capture/copy/hash the main database plus every present `-wal`/`-shm` sidecar before opening, recheck the original bundle, and reserve all snapshot bytes through `src/application/stagingBudget.ts`. Open the copied bundle only with ordinary WAL-capable SQLite access in `src/cdb/materializeSnapshot.ts`; run `VACUUM INTO` to a private main-only materialized file, close the bundle connection, and reject replay/materialization failure as `CDB_OPEN_FAILED` without a live-read fallback. Then open only that materialized main file through `src/cdb/openDatabase.ts` read-only with `immutable=1`; extraction never opens a WAL/SHM member and cannot create a sidecar. Verify copied members before publication and delete snapshot/materialized artifacts after provenance is retained. Any acquisition mutation, sidecar appearance/disappearance, or unstable snapshot emits `SOURCE_MUTATED_DURING_READ` and prevents output. `iterateRows()` checks `AbortSignal` every row and awaits `scheduler.yield()` at least once per 256-row window so synchronous SQLite iteration is cancellable.

Every database handle is closed in `finally` on success, schema/limit/integer failure, iterator failure, writer failure, source mutation, `AbortSignal`, and SIGINT. Add lifecycle spies and child-process coverage rather than relying only on a successful read.

**Files:** `src/cdb/openDatabase.ts`, `src/cdb/inspectSchema.ts`, `src/cdb/iterateRows.ts`, `src/application/limits.ts`, `src/hashing/sha256.ts`, `tests/reader/openDatabase.test.ts`, `tests/reader/schema.test.ts`, `tests/reader/iterateRows.test.ts`, `tests/reader/resourceLimits.test.ts`.

### 1.3 Add a bounded full join and row-level diagnostics

Create `src/application/readCdb.ts` and `src/application/diagnosticsPolicy.ts`. Preflight duplicate IDs with fixed `GROUP BY id HAVING COUNT(*) > 1` statements and run the text byte-length preflight before the full join. Any duplicate or resource/text-type failure is a schema/input error and prevents output; it must not be resolved by a many-to-many join. Then stream an explicit-column full logical join implemented as `datas LEFT JOIN texts` plus an orphan-`texts` `UNION ALL` branch, carrying `dataOrdinal`/`textOrdinal`, decimal-string IDs, and all supported raw columns. Order by canonical decimal card ID and available source ordinal. This uses no JavaScript table map and retains orphan rows.

Emit `MISSING_DATA_ROW`/`MISSING_TEXT_ROW` for incomplete records. Apply the matrix in the tactical spec: incomplete/unknown/malformed warnings become errors under strict mode, while duplicate/schema/resource/integer failures are always errors. Add a large generated fixture containing missing partners, duplicate IDs, extra tables, and late rows; prove raw fidelity, diagnostics, ordinals, ordering, row limits, and bounded memory.

**Files:** `src/application/readCdb.ts`, `src/application/diagnosticsPolicy.ts`, `tests/reader/joinDiagnostics.test.ts`, `tests/reader/largeJoin.test.ts`.

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
npm run test:reader
npm run test:compat
npm test
```

The compatibility gate must invoke `app/index.js` against `__tests__/input_dir/cards.cdb`, compare parsed raw `datas`/`texts` data to the checked-in logical fixture, verify output-directory creation and no-output behavior, test `ignore`, dotted/non-final legacy candidates, derived-basename collisions, unsafe legacy integers, and capture stdout/stderr to assert that the library emits no logs. Because the v1 signature has no force option, a non-null `outputDir` explicitly authorizes atomic replacement of its old `<basename>.json` files; test two successive legacy writes, an injected failed second write preserving the prior final, and output-directory creation. Reader tests must prove handles close on all failure paths, byte-length preflight rejects oversized text before a value-selecting join/destination, aggregate merge storage accounts for index growth, enforce row/text limits, use signed-64 decimal raw values, reject source mutation/WAL changes, and prove a fixture's extra table is not queried. Run the same raw import from a clean packed artifact in Phase 5; `app/index.js` is not asserted to be present in the tarball.

## Stop/rollback conditions

- Stop if the old fixture cannot be represented by the explicit `datas`/`texts` reader without changing raw values; add a raw compatibility exception only through a documented contract decision.
- Stop if any database handle remains open after an injected iterator or writer failure.
- Roll back only the `src/cdb`, `src/application/readCdb`, and legacy adapter changes if this gate fails; keep Phase 0 contracts/fixtures intact.

## Dependencies and scope

Depends on Phase 0. The CLI is not implemented here. This phase is intentionally limited to discovery, SQLite lifecycle, raw joins, diagnostics, and the compatibility adapter.

## Revision-5 senior remediation tasks and gates

The following tasks supersede the Revision-4 reader wording where it conflicts with the senior remediation specification. They must be implemented before the existing 1.2/1.3 full-join work can pass:

1. **Snapshot lifecycle and WAL materialization.** Add `src/cdb/snapshotBundle.ts` and `src/cdb/materializeSnapshot.ts`. Capture the main plus every present sidecar before opening SQLite; copy to private staging, hash the ordered member tuple with explicit presence markers, re-stat/re-hash originals, and retry bounded races. Open only the copied bundle for WAL replay, run `VACUUM INTO` for a main-only materialized snapshot, then close it before immutable extraction. Add `tests/reader/walMaterialization.test.ts` and `tests/reader/physicalSnapshotProvenance.test.ts` for a committed WAL-only row, source/member immutability, no extraction sidecar, materialization failure/no publish, physical hash changes after physical reorder, and stable canonical records/ordinals/winners.
2. **Encoding and byte-fidelity preflight.** Add `src/cdb/textPreflight.ts`. Require `PRAGMA encoding = 'UTF-8'`; check `typeof()` before byte limits; select only `CAST(column AS BLOB)` for retained cells; decode with fatal UTF-8 `TextDecoder`. Add `tests/reader/textByteFidelity.test.ts` for UTF-16 rejection, wrong storage type precedence, over-limit non-selection, under-limit non-ASCII/astral text, and invalid bytes (`INVALID_TEXT_ENCODING`).
3. **Bounded staging.** Add `src/application/stagingBudget.ts` and `tests/reader/stagingSnapshotBudget.test.ts`. Add `maxSnapshotBytes` (4 GiB default), reject source-bundle sum over it or aggregate `maxStagingBytes` before copying, reserve/reconcile each physical temporary file once, and clean snapshot/materialized files on all success/failure/cancellation paths.
4. **Reject-only limit relations.** Add `src/application/normalizeOptions.ts` and `tests/cli/limitRelations.test.ts`. Validate every limit as a non-negative safe integer before discovery/open; reject `maxSpoolBytes > maxStagingBytes` or `maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION` exit 2. Equality, less-than, zero, and all diagnostic payloads/hash inputs are tested.
5. **Async iterator contract.** Add `src/application/iterateRawCards.ts` or the bounded equivalent that exports `AsyncIterableIterator<RawCardRows>` and is reused by `convert()`. Add `tests/api/iterateRawCards.test.ts` and `tests/api/iterateRawCards.types.test.ts` proving per-row signal checks, a scheduler checkpoint per 256 rows, direct-consumer `return()`/`finally` cleanup, abort rejection, and no synchronous public iterator.

Before the existing 1.2/1.3 full-join work can pass, implement the remaining stable input-shape contract from `spec.md`:

1. Add `src/cdb/snapshotBundle.ts` and `src/cdb/materializeSnapshot.ts`: capture main, `-wal`, and `-shm` members before opening SQLite, copy the complete present bundle to a private sibling, hash explicit presence/member names and bytes, and recheck original identities/bytes. Retry bounded acquisition races and emit `SOURCE_MUTATED_DURING_READ`; never silently omit a sidecar. Open only the copied bundle with ordinary WAL-capable access, run `VACUUM INTO` into a private main-only materialized file, close that connection, and then open only the materialized file read-only with `immutable=1` and extensions disabled. Add a valid-WAL baseline, main-only test, no-sidecar extraction assertion, and materialization-failure/no-publish test; reject `CDB_OPEN_FAILED` rather than using a live fallback.
2. Read `PRAGMA encoding` before text selection and reject anything other than UTF-8 with `UNSUPPORTED_DATABASE_ENCODING` (exit 4). Before text length checks, query only fixed IDs, `typeof`, and byte lengths. Wrong storage class (`INVALID_TEXT_VALUE`) precedes an over-limit result; oversized valid TEXT is never selected; under-limit values are UTF-8 checked after retrieval. Add lifecycle spies proving snapshot temp files, databases, and transactions close in every failure path.
3. Validate all source storage classes before duplicate checks/join: non-null SQLite INTEGER for both IDs; INTEGER/NULL for other numeric `datas` cells; TEXT/NULL for `texts` cells. Reject NULL/numeric-looking TEXT/REAL/BLOB IDs with `INVALID_CARD_ID`, other wrong numeric cells with `INVALID_INTEGER_VALUE`, and never coerce. Add signed-int64 and malformed fixtures.
4. Replace insertion/source row order with canonical signed-int64 numeric ID order. Assign zero-based `dataOrdinal`/`textOrdinal` from that order, order joined rows by `(id, data-branch-before-text-orphan, ordinal)`, and prove physical insertion reorder cannot change output, hashes, merge winners, or legacy candidate semantics. The join must continue to use no JavaScript map.
5. The raw reader's scope is the fixed supported `datas`/`texts` columns. Extra tables/columns are metadata-only and must not be presented as losslessly captured cells. Datas-only/texts-only rows retain the present ID/raw side, null the absent side, emit the stable missing-partner diagnostic, and remain valid inputs for later card/source mappers.

The Phase-1 gate additionally runs:

```bash
npm run build
npm run test:reader
npm run test:compat
npm test
```

and fails if a valid WAL database is rejected as self-mutating, a UTF-16 database reaches preflight, an invalid ID reaches the join, insertion order changes an ordinal, an oversized value is selected, an orphan requires a fabricated field, or any snapshot/SQLite handle survives failure.