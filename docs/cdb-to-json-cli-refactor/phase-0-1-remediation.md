# Remediation phase — Phase 0–1 implementation checkpoint

## Status and scope

This is a corrective phase after the first implementation checkpoint was reviewed as `REQUEST-CHANGES`. It is intentionally limited to Phase 0 (contract/toolchain/fixtures) and Phase 1 (reader/diagnostics/compatibility bridge). Phases 2–5 remain deferred until this checkpoint passes.

The remediation does not redesign the accepted tactical package or the senior remediation specification; it reuses them. Every finding below maps to ordered corrective tasks with exact files, named test fixtures, stop conditions, and verification commands. The implementer may not declare Phase 0–1 complete until every task, every named test, and the consolidated gate pass. Do not paper over a missing capability by weakening the signed-int64, snapshot, bounded-join, secure-cleanup, or v1-compatibility contracts.

## Revision 1 — plan-reviewer-a corrections (A1–A9)

This revision is a targeted correction to the executable plan. It does not reopen D1–D8, add Phase 2–5 product behavior, or alter `docs/cdb-to-json-cli-refactor-spec.md`. The following rules supersede any less-specific wording later in this document.

### A1 — the app-shim gate is runnable

`vitest.config.ts` MUST include `__tests__/**/*.test.js` in addition to `__tests__/**/*.test.ts` and `tests/**/*.test.ts`. `__tests__/main.test.js` MUST import `app/index.js` (not `dist/index.js`), import `it`/`expect` from `vitest` rather than `node:test`, and assert the v1-shaped result against the checked-in fixture. `npm test` is the complete declared suite and MUST run `npm run build && vitest run`; this include glob is what makes the JavaScript app-shim test execute. The focused `test:compat` gate runs `tests/compatibility` and the app-shim test is also run by the full suite. It is a Vitest JavaScript suite, not an untracked Node-only smoke test.

The package scripts are frozen for this checkpoint as follows: `build:native` runs `scripts/build-native.mjs`; `build` runs `npm run build:native && tsc -p tsconfig.json`; each focused script runs its named `tests/<area>` directory; `test` runs `npm run build && vitest run`; and `package:check` runs `scripts/package-check.mjs`. No focused script may rely on an undeclared target.

### A2 — one exit-policy implementation

`src/cli/exitCodes.ts` is the sole owner of terminal precedence. It exports `computeExitCode(state: ExitCodeState): ExitCode`, where the required state is explicit and typed:

```ts
export type ExitCodeState = {
  optionError: boolean;
  hasUsableInput: boolean;
  inputError: boolean;
  strictFailure: boolean;
  resourceOrIntegerFailure: boolean;
  mergeCollision: boolean;
  outputError: boolean;
  cancelled: boolean;
  continued: boolean;
  completedInputCount: number;
  failedInputCount: number;
  internalError: boolean;
};
```

`computeExitCode` applies exactly `2 > 3 > 4 > 5 > 6 > 7 > 1`, with output error/cancellation taking the documented output-failure path and `7` requiring `continued`, at least one completed input, and at least one failed input. `DiagnosticCollector` MUST only collect, `merge`, and `promote`; it MUST NOT expose a second exit-code helper or accept ambiguous booleans. `convert()` and the CLI both construct this state and call the same exported function. `tests/unit/diagnosticsPolicy.test.ts` tests merge/promotion and `tests/cli/exitCodes.test.ts` tests the complete state matrix against this one function.

### A3 — exact bounded join and raw text boundary

The implementation MUST use the following shape rather than the earlier illustrative query. First run storage-class and ID validation. Then execute one prepared fixed-column CTE query; the CTEs assign ordinals with SQLite's exact INTEGER ordering, which is signed 64-bit numeric ordering for the validated IDs. JavaScript parses every projected ID with `BigInt` only to validate/canonicalize and to assert monotonicity; it MUST NOT call `Number()`, use `+0`, lexicographically sort IDs, or build a table `Map`.

```sql
WITH
  d AS (
    SELECT id AS sort_id, CAST(id AS TEXT) AS data_id,
           ot, alias, setcode, type, atk, def, level, race, attribute, category,
           ROW_NUMBER() OVER (ORDER BY id) - 1 AS data_ordinal
    FROM datas
  ),
  t AS (
    SELECT id AS sort_id, CAST(id AS TEXT) AS text_id,
           CAST(name AS BLOB) AS name_blob,
           CAST(desc AS BLOB) AS desc_blob,
           CAST(str1 AS BLOB) AS str1_blob,
           CAST(str2 AS BLOB) AS str2_blob,
           CAST(str3 AS BLOB) AS str3_blob,
           CAST(str4 AS BLOB) AS str4_blob,
           CAST(str5 AS BLOB) AS str5_blob,
           CAST(str6 AS BLOB) AS str6_blob,
           CAST(str7 AS BLOB) AS str7_blob,
           CAST(str8 AS BLOB) AS str8_blob,
           CAST(str9 AS BLOB) AS str9_blob,
           CAST(str10 AS BLOB) AS str10_blob,
           CAST(str11 AS BLOB) AS str11_blob,
           CAST(str12 AS BLOB) AS str12_blob,
           CAST(str13 AS BLOB) AS str13_blob,
           CAST(str14 AS BLOB) AS str14_blob,
           CAST(str15 AS BLOB) AS str15_blob,
           CAST(str16 AS BLOB) AS str16_blob,
           ROW_NUMBER() OVER (ORDER BY id) - 1 AS text_ordinal
    FROM texts
  ),
  joined AS (
    SELECT d.sort_id AS order_id, 0 AS branch_rank,
           d.data_id, d.data_ordinal,
           t.text_id, t.text_ordinal,
           d.ot, d.alias, d.setcode, d.type, d.atk, d.def, d.level,
           d.race, d.attribute, d.category,
           t.name_blob, t.desc_blob,
           t.str1_blob, t.str2_blob, t.str3_blob, t.str4_blob,
           t.str5_blob, t.str6_blob, t.str7_blob, t.str8_blob,
           t.str9_blob, t.str10_blob, t.str11_blob, t.str12_blob,
           t.str13_blob, t.str14_blob, t.str15_blob, t.str16_blob
    FROM d LEFT JOIN t ON d.sort_id = t.sort_id
    UNION ALL
    SELECT t.sort_id AS order_id, 1 AS branch_rank,
           NULL, NULL,
           t.text_id, t.text_ordinal,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL,
           t.name_blob, t.desc_blob,
           t.str1_blob, t.str2_blob, t.str3_blob, t.str4_blob,
           t.str5_blob, t.str6_blob, t.str7_blob, t.str8_blob,
           t.str9_blob, t.str10_blob, t.str11_blob, t.str12_blob,
           t.str13_blob, t.str14_blob, t.str15_blob, t.str16_blob
    FROM t LEFT JOIN d ON t.sort_id = d.sort_id
    WHERE d.sort_id IS NULL
  )
SELECT data_id, text_id, data_ordinal, text_ordinal,
       ot, alias, setcode, type, atk, def, level, race, attribute, category,
       name_blob, desc_blob,
       str1_blob, str2_blob, str3_blob, str4_blob,
       str5_blob, str6_blob, str7_blob, str8_blob,
       str9_blob, str10_blob, str11_blob, str12_blob,
       str13_blob, str14_blob, str15_blob, str16_blob
FROM joined
ORDER BY order_id, branch_rank, COALESCE(data_ordinal, text_ordinal);
```

The committed SQL explicitly enumerates `str1_blob` through `str16_blob` and every supported `datas` column; it MUST contain no `SELECT *` or arbitrary identifier. `sort_id`/`order_id` are internal SQLite INTEGER sort keys and never cross the raw boundary. Every returned ID is the `CAST(... AS TEXT)` decimal string, every retained text cell is a BLOB decoded with `TextDecoder("utf-8", { fatal: true })`, and the row mapper converts every other SQLite INTEGER (`ot`, `alias`, `setcode`, `type`, `atk`, `def`, `level`, `race`, `attribute`, `category`) from the safe-integer `bigint` to its canonical decimal string without JSON-number coercion. `RawCardRows` explicitly contains `dataOrdinal: number | null` and `textOrdinal: number | null`. Storage-class validation and byte preflight occur before this query, so no oversized or invalid text value is selected. `ROW_NUMBER()` is bounded by the earlier row-count gate, and its ordinal is independent of insertion order.

### A4 — row-count preflight is explicit and ordered

Before duplicate detection or the join, run these fixed prepared statements and compare each result to `limits.maxRowsPerTable`:

```sql
SELECT COUNT(*) AS row_count FROM datas;
SELECT COUNT(*) AS row_count FROM texts;
```

Counts are read as safe `BigInt` values and compared without numeric coercion. An exceeded count emits `RESOURCE_LIMIT_EXCEEDED` with `details.limitCode: "MAX_ROWS_EXCEEDED"` and aborts before any row-value materialization. The preflight sequence is: snapshot/materialize; UTF-8 encoding check; the two count statements; fixed storage-class/ID validation; duplicate-ID statements; fixed text byte/type/encoding preflight; then the CTE join. Any failure closes the handle and removes private artifacts. `MAX_ROWS_EXCEEDED` and `MAX_TEXT_LENGTH_EXCEEDED` remain diagnostic aliases only; `RESOURCE_LIMIT_EXCEEDED` is the stable terminal code.

### A5 — one physical bundle hash representation

D1 uses one canonical physical representation everywhere. For the fixed member order `main`, `-wal`, `-shm`, the bundle hash is the SHA-256 of canonical JSON for this array:

```json
[
  {"name":"main","present":true,"bytesBase64":"<exact copied bytes>"},
  {"name":"-wal","present":false,"bytesBase64":null},
  {"name":"-shm","present":false,"bytesBase64":null}
]
```

Object keys use the repository canonical-JSON ordering, array order is fixed, absent members remain explicit, and `bytesBase64` is derived from the copied bytes (not the original path). Implementations MAY stream the equivalent canonical serialization rather than hold the base64 string in memory, but MUST produce the same digest. `src/cdb/snapshotBundle.ts`, `sourceRevisionId`, and `tests/reader/physicalSnapshotProvenance.test.ts` use this representation; the prior `[{name,present,sha256,size}]` wording is superseded. A physical reorder therefore changes this hash while canonical rows, ordinals, merge winners, and `conversionOptionsHash` remain equal.

### A6 — Phase ownership and the minimal legacy output boundary

The Phase 0–1 checkpoint owns contracts, fixtures, discovery, snapshot/materialization, raw reading, diagnostics, async iteration, and the v1 bridge only. Modern profile/output matrix behavior, fresh split roots, descriptor-relative publication, parent-swap adversaries, and general CLI destination writers remain Phase 2 work. The required Phase 0–1 `test:cli` script is declared now and runs only the pre-open policy tests that exist in this checkpoint (`tests/cli/exitCodes.test.ts` and `tests/cli/limitRelations.test.ts`); Phase 2 adds the remaining CLI files to the same script without changing its name. `package:check` is in scope now only for the build artifact/capability/hash/package-manifest contract; it does not imply that modern destination writers are complete.

The legacy exception has one named, private boundary: `src/compatibility/legacyOutput.ts`. It exposes `writeLegacyFile(outputDir, basename, bytes, options)` and owns output-directory creation, direct-child/symlink checks, an exclusive legacy lock, sibling temporary file, force-compatible atomic replacement, and `finally` cleanup. It is used only by `src/legacy.ts`; it is not a modern destination implementation and MUST NOT be imported by Phase 2 profile/directory writers. `src/destinations/secureDestination.ts` is created in Phase 0 as the typed native capability/publication boundary; Phase 0–1 may use its capability types but does not implement the modern publication matrix. The three compatibility gates that close the in-scope legacy writer are `tests/compatibility/legacy.test.ts`, `legacy-output.test.ts`, and `legacyNames.test.ts`.

### A7 — native capability and stale-artifact behavior

Create `src/destinations/secureDestination.ts` now with the capability manifest type and adapter interface (`probeCapability`, trusted-root acquisition, reservation/temp/commit/cleanup method signatures). Native behavior remains implemented in Phase 2, but the Phase 0 contract freezes its Linux Node 22+ support matrix and the no-path-fallback rule. `scripts/build-native.mjs` MUST remove `dist/native/secure_destination.node` before writing an `unsupported` manifest on an unsupported host, and `scripts/package-check.mjs` MUST fail if an unsupported manifest coexists with any module file. A stale module from a prior supported build is therefore never packaged or treated as capability. Supported builds MUST verify the module hash in the manifest.

### A8 — terminal I/O is injected at the CLI edge

Core, application, reader, discovery, diagnostics, and compatibility modules MUST remain terminal-free. `src/cli.ts` is the adapter edge and MUST not call `console.*`; `main(args, streams)` receives an explicit `{ stdout: Writable, stderr: Writable }` port, and `renderHelp`, `renderVersion`, and `renderDiagnostics` receive the target stream instead of using globals. The executable wrapper supplies `process.stdout`/`process.stderr` only at the entrypoint. Add a source/test gate that fails on `console` imports/calls in `src/`, and a CLI test that captures the injected streams. This resolves the current `src/cli.ts`/renderer direct-console calls without exempting hidden global logging.

### A9 — accepted legacy emit/output matrix

The bridge follows the normative v1 return contract exactly:

| `emit` | `outputDir` | Result |
|---|---|---|
| omitted/`true` | absent | resolve `LegacyTableResult[]` |
| omitted/`true` | present | write `<basename>.json`, then resolve `LegacyTableResult[]` |
| `false` | absent | resolve `void` and write nothing |
| `false` | present | write `<basename>.json`, then resolve `void` |

`ignore` always filters derived basenames before reading. `legacy.test.ts` asserts the array shape only for `emit: true`, asserts `undefined` and no file for `emit: false` without an output directory, and performs an emit-false write/read-back check when `outputDir` is supplied. It does not require an undocumented same-shape return. The wrapped failure behavior remains the v1 contract: any bridge failure is rethrown as `Failed to parse databases: <original message>` without logging. The compatibility tests assert this boundary and the exact array-or-void matrix above.

## Predecessor state

The rejected checkpoint produced a partial skeleton:

- `package.json` declares `build`, `test`, `lint`, `prepublishOnly` only. The Phase-0 gate scripts (`build:native`, `test:fixtures`, `test:unit`, `test:reader`, `test:compat`, `test:cli`, `test:normalization`, `test:source`, `test:streaming`, `test:conformance`, `package:check`) are absent, as is the `node-gyp` pin and `scripts/build-native.mjs`.
- `tsconfig.json` and `vitest.config.ts` exist; the Vitest glob only matches `__tests__/**/*.test.ts` and ignores the required `tests/fixtures`, `tests/unit`, `tests/reader`, `tests/compatibility`, `tests/cli`, and `tests/conformance` trees.
- `src/cdb/openDatabase.ts` opens read-only and validates required tables/columns, but does **not** enable `safeIntegers: true`, does **not** open with `immutable=1`, and does **not** check `PRAGMA encoding` until after the database handle is open (it closes after a UTF-16 rejection, but the encoding is not enforced before text/value work begins elsewhere).
- `src/cdb/iterateRows.ts` materializes both tables into `Map<number, ...>` and joins in JavaScript. The "async iterator" still materializes both tables first and only `yield`s from a sorted in-memory list. There is no `GROUP BY id HAVING COUNT(*) > 1` duplicate preflight, no byte-length-only text preflight, no canonical signed-int64 numeric ordering, and no `AbortSignal` checkpoint per 256 rows.
- `src/cdb/rawTypes.ts` declares `RawDatasRow.id: number`. The boundary exposes a JavaScript number, not a signed-int64 decimal string, so the safe-integer boundary is bypassed.
- `src/discovery/discoverCdbInputs.ts` uses `fs.stat` (follows symlinks) and a simple `*`/`?` glob matcher. Excludes are tested against both full path and basename. It does not use `lstat` to detect symlinks, does not track realpath cycles, and does not normalize excludes against root-relative slash form.
- `src/diagnostics/{codes,collector}.ts` define the basic matrix but lack `RESOURCE_LIMIT_EXCEEDED` (subcoded as `MAX_ROWS_EXCEEDED`/`MAX_TEXT_LENGTH_EXCEEDED`), `INVALID_LIMIT_RELATION`, `CDB_OPEN_FAILED` (present), `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING` (present), `OUTPUT_DIRECTORY_EXISTS`, `UNSAFE_DESTINATION_FILESYSTEM`, `LEGACY_INTEGER_UNREPRESENTABLE`, `LEGACY_BASENAME_COLLISION`, `INTEGER_OUT_OF_RANGE`, and `SOURCE_MUTATED_DURING_READ`. The collector has no strict-promotion or exit-precedence helper.
- `src/application/convertCatalog.ts` opens each input live (no snapshot, no WAL materialization), reads everything in memory, does not handle a per-database `DiagnosticCollector` merged into a top-level one, does not validate limit relations, and does not classify "no usable input" as exit 3.
- `src/legacy.ts` ignores its `outputDir` parameter (`void outputDir`), returns `LegacyTableResult[]` with empty `datas`/`texts` arrays, and does not preserve the v1 fixture's logical content. `app/index.js` and `app/getTables.js` still log to the terminal, open databases read-write, and dynamically query every non-system table. `app/getDirectory.js` retains the v1 first-dot basename policy without normalized slash paths or root-relative excludes.
- `__tests__/integration/cdb-reader.test.ts` exercises happy-path open/join only. The named fixture gates required by R5.6 (`walMaterialization`, `textByteFidelity`, `physicalSnapshotProvenance`, `discovery`, `joinDiagnostics`, `largeJoin`, `stagingSnapshotBudget`, `limitRelations`, `iterateRawCards`, `legacy`, `legacy-output`, `legacyNames`, `diagnosticsPolicy`, `exitCodes`) are absent.
- The `app/index.js` smoke test is the only `npm test` assertion. It imports `dist/index.js`, runs `convert({ profile: "raw", recursive: true })`, and asserts `sources.length === 1` and `cardCount > 0`. It does not cover the v1 fixture's logical content, `emit: false`, `ignore`, output-directory creation, no-output, or the absence of `console.*` calls.

The remediation below reverses every one of these gaps.

## Consolidated reviewer findings (verbatim)

> **REQUEST-CHANGES:** Phase 0–1 implementation is not approvable. Focused gates and required contract artifacts are absent; the reader violates signed-int64, snapshot, bounds, join, and cancellation contracts; and the legacy compatibility path remains the unsafe logging/writable/dynamic-table implementation.

The reviewer recorded these blocking findings, each linked to the smallest acceptable correction and the gate that proves closure:

| # | Finding | Required correction | Gate proving closure |
|---|---|---|---|
| R0.1 | Missing Phase 0 toolchain/gates/native capability | Add the exact Phase 0 scripts (`build:native`, `test:fixtures`, `test:unit`, `test:reader`, `test:compat`, `test:cli`, `test:conformance`, `test:streaming`, `test:normalization`, `test:source`, `test`, `package:check`); pin `node-gyp`; commit `scripts/build-native.mjs` and `native/secure-destination/{binding.gyp,src/*.cc,src/*.h}`; emit `dist/native/secure_destination.node` and `dist/native/capability.json`; make `package:check` verify the exact artifact and module hash. | `npm run build:native`, `npm run test:fixtures`, `npm run test:conformance`, `npm run package:check` |
| R1.1 | Unsafe integer/raw contract | Use `better-sqlite3` safe-integer mode; expose INTEGER values at the type boundary as signed-int64 decimal strings (`integerEncoding: "signed-int64-decimal"`); validate storage class (`INTEGER`/`TEXT`/`NULL`) before any join; reject `INTEGER_OUT_OF_RANGE` and wrong storage classes; preserve NULL exactly. | `tests/fixtures/integerVectors.test.ts`, `tests/reader/textByteFidelity.test.ts` |
| R1.2 | Unbounded / materializing join and incomplete cancellation | Add `GROUP BY id HAVING COUNT(*) > 1` duplicate preflight and `length(CAST(text_col AS BLOB))` byte preflight; replace the in-memory `Map` join with a fixed `datas LEFT JOIN texts UNION ALL orphan-texts` statement carrying decimal-string IDs, `dataOrdinal`/`textOrdinal`, and an explicit column list; add canonical signed-int64 numeric ordering; expose a single async iterator (`iterateRawCards`) that yields per row and awaits `scheduler.yield()` at least once per 256 rows; close every handle in `finally`. | `tests/reader/joinDiagnostics.test.ts`, `tests/reader/largeJoin.test.ts`, `tests/api/iterateRawCards.test.ts` |
| R1.3 | Live reads and no physical snapshot lifecycle | Capture `main` plus present `-wal`/`-shm` to a private sibling before opening SQLite; hash the exact fixed canonical-JSON `[ { name, present, bytesBase64 } ]` representation from Revision 1 A5; re-stat/re-hash the originals; retry bounded races; open only the copied bundle for WAL replay and `VACUUM INTO` materialization; close that connection; open only the materialized main file read-only with `immutable=1` and `safeIntegers: true`; reject `CDB_OPEN_FAILED` rather than falling back to a live read. | `tests/reader/walMaterialization.test.ts`, `tests/reader/physicalSnapshotProvenance.test.ts` |
| R1.4 | Legacy path still unsafe/broken | Route `app/index.js` through the safe bridge; `legacyConvert` must use the new reader, preserve direct-child `.cdb`-containing names, old first-dot basename derivation, basename `ignore`, deterministic order, `<basename>.json` filename shape, raw `{ datas, texts }` table object, two-write compatibility with `LEGACY_BASENAME_COLLISION`, `LEGACY_INTEGER_UNREPRESENTABLE`, and zero `console.*` calls; `src/index.ts` exports `legacyConvert` as the default and the package root remains the supported packed-artifact legacy path during 2.x. | `tests/compatibility/legacy.test.ts`, `tests/compatibility/legacy-output.test.ts` |
| R1.5 | Symlink / discovery policy violation | Use `lstat` for symlink detection; refuse to follow symlinks by default; when `--follow-symlinks` is set, track realpaths to break cycles and visit each target once; normalize excludes against root-relative slash form; match explicit files by basename **and** root-relative path; preserve deterministic sorted-by-relative-path order; keep legacy discovery separate with its own first-dot basename rule. | `tests/reader/discovery.test.ts`, `tests/compatibility/legacyNames.test.ts` |
| R1.6 | Diagnostics / strict / exit aggregation missing | Add a top-level `DiagnosticCollector` that merges per-database collectors; promote `WARNING` → `ERROR` under `--strict`; apply the documented exit precedence (2 → 3 → 4 → 5 → 6 → 7 → 1) using a single `computeExitCode(...)` helper; classify "no usable input" as exit 3 before opening; classify any option-validation failure as exit 2; emit the documented `MAX_ROWS_EXCEEDED`/`MAX_TEXT_LENGTH_EXCEEDED` → `RESOURCE_LIMIT_EXCEEDED` plus the new stable codes. | `tests/unit/diagnosticsPolicy.test.ts`, `tests/cli/exitCodes.test.ts` |
| R0.2 | Green tests did not cover the contract | Restore app-shim coverage (`__tests__/main.test.js`) plus the full named fixture suite from R5.6; make the Vitest include match `__tests__/**/*.test.js`, `__tests__/**/*.test.ts`, and `tests/**/*.test.ts`; declare every focused npm script before its gate; make `npm test` run `npm run build && vitest run` over the complete declared suite. | All Phase 0–1 focused gates plus `npm test` |

No reviewer finding is rejected. Authoritative registry citation and downstream source-schema acceptance remain later-phase stop gates as already documented.

## Phase 0 corrective tasks (R0.*)

These tasks must complete before any Phase 1 code change is reviewed.

### R0.1 Toolchain, native build, package scripts, and gates

**Files to create or modify**

- `package.json` — declare every script named in `phase-0-contract-fixtures.md` and `spec.md` before any gate invokes it. In particular:
  - `build:native`: `node scripts/build-native.mjs`
  - `build`: `npm run build:native && tsc -p tsconfig.json`
  - `test:fixtures`: `vitest run tests/fixtures`
  - `test:unit`: `vitest run tests/unit`
  - `test:reader`: `vitest run tests/reader`
  - `test:compat`: `vitest run tests/compatibility`
  - `test:cli`: `vitest run tests/cli`
  - `test:normalization`: `vitest run tests/normalization`
  - `test:source`: `vitest run tests/source`
  - `test:streaming`: `vitest run tests/streaming`
  - `test:conformance`: `vitest run tests/conformance`
  - `test`: `npm run build && vitest run`
  - `package:check`: `node scripts/package-check.mjs`
  - `lint`: keep existing `tsc --noEmit`; do not replace with a non-TSC linter.
- `package.json` — pin `node-gyp` to `11.2.0` in `devDependencies`; add `@types/node` already present.
- `package-lock.json` — regenerate so the `node-gyp` pin survives.
- `scripts/build-native.mjs` — Node 22+ Linux: invoke `node-gyp rebuild` from `native/secure-destination/`, verify the expected N-API module, copy to the exact path `dist/native/secure_destination.node`, write `dist/native/capability.json` containing `{ platform, arch, nodeAbi, moduleSha256, secureDestination: true, supportedPrimitives: ["openat2","openat","linkat","renameat2"], requiredFlags: ["RESOLVE_BENEATH","RESOLVE_NO_SYMLINKS"] }`. Unsupported hosts: first remove any stale `dist/native/secure_destination.node`, then write an `unsupported` capability manifest and emit a clear stderr line; **do not** fabricate a native module.
- `scripts/package-check.mjs` — run `npm pack --dry-run`; verify that `dist/index.js`, `dist/cli.js`, `dist/legacy.js`, `dist/native/capability.json`, `schemas/*.schema.json`, `README.md`, `LICENSE`, and `package.json` are present; when the manifest is supported, require `dist/native/secure_destination.node` and verify its SHA-256; when the manifest is unsupported, fail if that module exists; on a release host (CI tag or `CDB_RELEASE_HOST=1`) fail loudly when the Linux native module is missing; on non-release hosts without the module, emit a non-fatal warning and continue.
- `src/destinations/secureDestination.ts` — committed Phase-0 capability and adapter contract. It names the Linux Node 22+ support matrix, `openat2`/`openat`/`linkat`/`renameat2` primitives, required flags, trusted-root and reservation operations, and the no-path-fallback failure boundary; modern implementation is Phase 2.
- `native/secure-destination/binding.gyp`, `native/secure-destination/src/secure_destination.cc`, `native/secure-destination/src/secure_destination.h` — committed source. The native module owns `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow directory opens, and descriptor-relative `openat`, `linkat`, `renameat2`. No unchecked string path is resolved after root acquisition.
- `vitest.config.ts` — extend the include glob to `["__tests__/**/*.test.ts", "__tests__/**/*.test.js", "tests/**/*.test.ts"]`; keep `environment: "node"`; keep the existing coverage exclusions. The JavaScript glob is required so `__tests__/main.test.js` executes in `npm test`.

**Stop conditions.** Stop if any Phase 0 script is undeclared before its gate runs; stop if `node-gyp` is unpinned; stop if the native module is fabricated on an unsupported host; stop if an unsupported manifest coexists with a stale native module; stop if `package:check` does not verify the module hash and unsupported-state rule; stop if `vitest.config.ts` does not match both the app-shim and new `tests/**` trees.

### R0.2 Schemas, types, fixtures, registry placeholder

**Files to create or modify**

- `schemas/cdb.raw.v1.schema.json`, `schemas/cdb.card.v2.schema.json`, `schemas/ygo.card-source.v1.schema.json`, `schemas/cdb.card-array.v2.schema.json` (identifier `cdb.card-array/2`), `schemas/ygo.card-source-array.v1.schema.json` (identifier `ygo.card-source-array/1`). Frozen filenames/identifiers.
- `src/cdb/rawTypes.ts` — change `RawDatasRow.id` and every numeric `datas` column to `string` (signed-int64 decimal). Add `integerEncoding: "signed-int64-decimal"` to the canonical record envelope. Add `null` as a valid value (do not coerce to "0").
- `src/cdb/rawTypes.ts` — add `RawCardRows`, `RawDatasRow`, `RawTextsRow` plus an explicit `RawTableCounts` interface. Add `null` on `texts` columns (SQLite NULL is a valid text cell).
- `src/application/types.ts` — `LimitsV1` (`maxRowsPerTable`, `maxTextBytes`, `maxOutputBytes`, `maxStagingBytes`, `maxSpoolBytes`, `maxSnapshotBytes`) with frozen defaults `1_000_000`, `4 * 1024 * 1024`, `2 * 1024 * 1024 * 1024`, `4 * 1024 * 1024 * 1024`, `2 * 1024 * 1024 * 1024`, `4 * 1024 * 1024 * 1024`; `ConvertOptions` with `profile`, `format`, `split`, `merge`, `onConflict`, `locale`, `sourceNamespace`, `includeRaw`, `strict`, `recursive`, `exclude`, `followSymlinks`, `force`, `outputPath`, `limits`, `signal?`. Add `AbortSignal` ownership in options.
- `src/diagnostics/codes.ts` — add `RESOURCE_LIMIT_EXCEEDED` (replace the deprecated `MAX_ROWS_EXCEEDED`/`MAX_TEXT_LENGTH_EXCEEDED` as aliases for v1 back-compat), `INTEGER_OUT_OF_RANGE`, `INVALID_INTEGER_VALUE`, `INVALID_TEXT_VALUE`, `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING` (already present — keep), `CANCELLED`, `LEGACY_INTEGER_UNREPRESENTABLE`, `LEGACY_BASENAME_COLLISION`, `INVALID_LIMIT_RELATION`, `CDB_OPEN_FAILED` (already present — keep), `OUTPUT_DIRECTORY_EXISTS`, `UNSAFE_DESTINATION_FILESYSTEM`, `SOURCE_MUTATED_DURING_READ` (already present — keep), `CONFLICTING_CARD_KIND_FLAGS`, `CONFLICTING_SUBTYPE_FLAGS`, `CONFLICTING_PROGRESSION_FLAGS`, `DUPLICATE_CARD_ID`, `INVALID_PATH`. Verify the matrix table in `limits-and-diagnostics.md` is satisfied.
- `src/diagnostics/collector.ts` — add `merge(other: DiagnosticCollector)` and `promote(strict: boolean): void` (WARNING → ERROR under `strict`). Do not add an exit-code function here; `src/cli/exitCodes.ts` owns the single typed `computeExitCode(state: ExitCodeState)` policy described in Revision 1 A2.
- `tests/fixtures/buildCdbFixture.ts`, `tests/fixtures/cases.ts`, `tests/fixtures/expected/minimal-*.json`, `tests/fixtures/pilot-ids.json`, `tests/fixtures/fixture.test.ts`, `tests/fixtures/generated/README.md`, `tests/conformance/schemaValidation.test.ts` — committed per Phase 0.3 and 0.4 of the tactical spec.
- `__tests__/main.test.js` — change the existing smoke test to import `app/index.js`, assert the v1 raw `datas`/`texts` logical fixture and no library terminal output, and keep it matched by the JavaScript Vitest include.
- `src/registry/placeholder.ts` — committed registry placeholder recording the required URL/commit/checksum fields. Phase 3 cannot proceed until a maintainer supplies the authoritative revision.

**Stop conditions.** Stop if an aggregate schema uses an unfrozen identifier; stop if `LimitsV1` defaults drift; stop if the collector silently drops diagnostics from a per-database failure; stop if any `src/` module imports `console`, terminal state, or a process-global logger.

### R0.3 Conformance harness and registry placeholder

**Files to create**

- `tests/conformance/schemaValidation.test.ts` — assert the frozen item and aggregate schemas validate their golden minimal records; assert aggregate arrays use `items` referencing the frozen item schema; assert `UNSUPPORTED_DATABASE_ENCODING` is referenced in the limits/diagnostics documentation; assert `cdb.card-array/2` and `ygo.card-source-array/1` identifiers are present and frozen.
- `tests/fixtures/integerVectors.test.ts` — IDs `-2`, `0`, `2`, `10`, signed-64 minimum/maximum, NULL, numeric-looking TEXT, REAL, BLOB; expected behavior: valid IDs become decimal strings with stable canonical ordering; invalid IDs emit `INVALID_CARD_ID`; oversized values emit `INTEGER_OUT_OF_RANGE`.

**Stop conditions.** Stop if a conformance test imports SQLite implementation details; stop if the registry placeholder does not block Phase 3.

## Phase 1 corrective tasks (R1.*)

These tasks may not start until R0.1, R0.2, and R0.3 are complete.

### R1.1 Snapshot bundle acquisition and materialization

**Files to create or modify**

- `src/cdb/snapshotBundle.ts` — accept a source path; resolve siblings `main`, `-wal`, `-shm` via `lstat`; copy every present member to a private staging directory (under the configured staging root); compute the bundle hash exactly as the canonical JSON SHA-256 of the fixed `[ { name, present, bytesBase64 } ]` array defined in Revision 1 A5, including explicit absent members; retry bounded races (≤ 3) when an original identity/size/bytes changes; emit `SOURCE_MUTATED_DURING_READ` and abort when the retry budget is exhausted. Every copied member's identity/size/bytes is verified before and after copy. No string path is resolved after the staging directory is acquired.
- `src/cdb/materializeSnapshot.ts` — open only the copied bundle with ordinary WAL-capable SQLite access (`readonly: false` is required for `VACUUM INTO`; the source is the private copy, not the user input); run `VACUUM INTO '<private materialized main>'`; close the bundle connection; never open the original source or any original sidecar; report `CDB_OPEN_FAILED` on replay or materialization failure.
- `src/cdb/openDatabase.ts` — open only the materialized main file with `{ readonly: true, fileMustExist: true, immutable: 1, safeIntegers: true }`; disable extension loading; capture `PRAGMA encoding` exactly once before any other PRAGMA; emit `UNSUPPORTED_DATABASE_ENCODING` (exit 4) when encoding is not `UTF-8`; close the handle in `finally` on every exit path.
- `src/hashing/sha256.ts` — canonical JSON SHA-256 over a sorted-key, deterministic object.
- `src/application/stagingBudget.ts` — single aggregate reservation counter used by snapshot bundle, materialized main, output staging, merge spool/index/lineage, and lock records. `reserve(path, bytes)` and `reconcile(path)` track actual file sizes; over-budget writes emit `RESOURCE_LIMIT_EXCEEDED` before the write completes; cleanup removes every reserved file on success/failure/cancellation paths.

**Stop conditions.** Stop if `immutable=1` is not used for extraction; stop if the original source is ever opened; stop if `safeIntegers` is not enabled at extraction; stop if a materialization failure silently falls back to a live read; stop if the bundle hash omits any present sidecar.

### R1.2 Text encoding preflight and byte fidelity

**Files to create or modify**

- `src/cdb/textPreflight.ts` — fixed-column queries for each supported `texts` column that select only `id`, `typeof(column)`, and `length(CAST(column AS BLOB))` for cells over the byte limit. Validate `typeof()` is `text` or `null`; reject wrong storage classes with `INVALID_TEXT_VALUE` before any length check; reject oversized valid TEXT without selecting its value; emit `INVALID_TEXT_ENCODING` for under-limit values whose retrieved bytes fail `TextDecoder('utf-8', { fatal: true })` after a separate fixed `SELECT id, CAST(column AS BLOB)` for retained under-limit cells. The byte/type preflight runs only after both row counts and complete fixed storage-class/ID validation.
- `src/cdb/iterateRows.ts` — replace the `Map`-based join with the exact fixed CTE query in Revision 1 A3. Its `ROW_NUMBER() OVER (ORDER BY id)` ordinals use SQLite's validated INTEGER numeric order; output IDs are `CAST(id AS TEXT)` decimal strings; every retained text column is `CAST(column AS BLOB)` and is fatal-decoded in TypeScript. JavaScript uses `BigInt` only for canonical validation/monotonicity checks and never uses `Number`, `+0`, lexicographic ordering, or a table map. The query carries `dataOrdinal`/`textOrdinal` as nullable zero-based fields and ranks the data branch before a text orphan at a shared ID. The branch must not execute `SELECT *` over arbitrary tables or columns.
- `src/cdb/iterateRows.ts` — after the exact row-count and storage-class preflights, preflight duplicate IDs with `SELECT id FROM datas GROUP BY id HAVING COUNT(*) > 1` and the same for `texts`. Any non-empty result is an error (`DUPLICATE_CARD_ID`) and prevents output. Row counts are checked before any value-selecting statement, as required by Revision 1 A4.

**Stop conditions.** Stop if any text cell is selected before the byte preflight; stop if a wrong storage class is checked after length; stop if the join uses a JavaScript map; stop if duplicate IDs are not detected before iteration; stop if a `SELECT *` query is executed against a user table; stop if `id` is parsed as a JavaScript number at the boundary.

### R1.3 Async iterator, cancellation, and lifecycle

**Files to create or modify**

- `src/application/iterateRawCards.ts` — `export function iterateRawCards(databasePath: string, options?: ReadOptions): AsyncIterableIterator<RawCardRows>`. The iterator owns the entire reader lifecycle: snapshot → materialize → open → preflight → duplicate preflight → yield per row → close. Checks `options.signal?.aborted` before work and before each `yield`. Awaits `scheduler.yield()` at least once every 256 rows. Implements `return()` and `throw()` to close handles and remove private staging/snapshot artifacts in `finally`. Emits `CANCELLED` (exit 6) at the first post-checkpoint abort; never claims success after a post-barrier abort.
- `src/application/convertCatalog.ts` — replace per-database handle management with `iterateRawCards`; collect each database's diagnostics into a per-database `DiagnosticCollector`, then merge into a top-level `DiagnosticCollector`; apply `promote(strict)`; construct the complete `ExitCodeState` and call the sole `computeExitCode` from `src/cli/exitCodes.ts`. The collector never computes an exit code.
- `src/cli/parseArgs.ts` — add `--max-snapshot-bytes`, `--max-staging-bytes`, `--max-spool-bytes`, `--max-output-bytes`, `--max-text-bytes`, `--max-rows`, `--on-conflict error|first|last`, `--continue-on-error`, `--pretty`, `--force`, `--diagnostics text|json|jsonl|none`, `--include-raw`, `--profile raw|card|source`, `--format json|jsonl`, `--split none|database|card`, `--merge`, `--output`, `--exclude`, `--follow-symlinks`, `--recursive`, `--locale`, `--source-namespace`, `--strict`.
- `src/cli/exitCodes.ts` — export the typed `ExitCodeState` and sole `computeExitCode(state)` enforcing option (2) > no-input (3) > input/schema/strict/resource/integer (4) > merge collision (5) > output conflict / unsafe destination / write / cancel (6) > mixed continued database failures (7) > internal (1). Both the application and CLI call this same function.

**Stop conditions.** Stop if `iterateRawCards` is not `AsyncIterableIterator`; stop if a public synchronous iterator is exported; stop if a SIGINT handler is installed without `finally` removal; stop if a signal checkpoint is missing; stop if the exit-code precedence table is not enforced.

### R1.4 Discovery and symlink policy

**Files to create or modify**

- `src/discovery/pathPolicy.ts` — `lstat`-based symlink detection (`isSymbolicLink`), realpath cycle tracking (`Map<realpath, true>`), slash-normalized relative-path comparison (`path.split(path.sep).join('/')`), and a glob matcher that splits exclude patterns by `*`/`?` and matches the normalized relative path. Explicit files match both basename and root-relative path.
- `src/discovery/discoverCdbInputs.ts` — use `lstat` to detect symlinks (not `stat`); skip symlinks by default; with `--follow-symlinks`, track realpaths to prevent cycles and visit a target once; sort each directory's results by slash-normalized relative path; preserve command-line argument order; never use an output path in a source hash.
- `src/legacy.ts` — keep `legacyConvert` discovery isolated: direct-child names **containing** `.cdb`, old first-dot basename derivation, basename `ignore`, deterministic order, no symlink policy change from v1. Detect derived-basename collisions in preflight and emit `LEGACY_BASENAME_COLLISION` before any output is renamed.

**Stop conditions.** Stop if any directory traversal uses `stat`; stop if excludes match against a non-normalized path; stop if a target is visited twice through `--follow-symlinks`; stop if a modern discovery path reuses the legacy first-dot basename rule.

### R1.5 Compatibility bridge

**Files to create or modify**

- `src/legacy.ts` — replace the placeholder with a real bridge. Open each discovered legacy file through `iterateRawCards` (no `app/getTables.js` round-trip); close all handles in `finally`; preserve the v1 logical content (raw `{ datas, texts }` table object), `<basename>.json` filenames, deterministic order, the A9 emit/output matrix, basename `ignore`, dotted/non-final legacy names, and the wrapped failure message. A non-null `outputDir` explicitly authorizes replacement of the old `<basename>.json` destinations; route only those files through `src/compatibility/legacyOutput.ts`'s reservation and force-compatible atomic commit. Two successive writes, a derived-basename collision, an emit-false write/read-back, an unsafe legacy integer (`LEGACY_INTEGER_UNREPRESENTABLE`), an `ignore` match, and a created-vs-existing output directory are required behaviors.
- `src/index.ts` — export the named modern APIs (`convert`, `iterateRawCards`) plus a deprecated `default` that is `legacyConvert`. The package root's default export is `legacyConvert` during 2.x. Do not emit deprecation warnings to stdout.
- `app/index.js` — keep the existing v1 function signature; import from `../dist/legacy.js`; never call `app/getTables.js` directly; never `console.log` from inside `legacyConvert`.

**Stop conditions.** Stop if `legacyConvert` returns an empty `datas`/`texts` table object; stop if the v1 fixture's logical content is not preserved; stop if `console.*` is called from the library; stop if a successful call requires a second argument; stop if the package root default export is not `legacyConvert`.

### R1.6 Remove the unsafe legacy implementation only after compatibility tests pass

**Files to delete or stop importing**

- `app/getDirectory.js`, `app/getTables.js` — delete only after `tests/compatibility/legacy.test.ts`, `tests/compatibility/legacy-output.test.ts`, and `tests/compatibility/legacyNames.test.ts` pass. Do not delete `app/index.js`; it is the source-tree ESM shim for the built legacy module.
- `README.md` — add a "v1 compatibility" note that the legacy default export is supported during the 2.x line and that `app/index.js` is the source-tree shim.

**Stop conditions.** Stop if any compatibility test fails; stop if a delete breaks a packed-artifact or source-tree consumer.

## Migration safety: what to keep, what to change

Keep these files unchanged until Phase 2 introduces output writers:

- `__tests__/input_dir/cards.cdb` and `__tests__/output_dir/cards.json` — frozen logical fixture; the bridge must reproduce `output_dir/cards.json` from `input_dir/cards.cdb` byte-for-byte (modulo whitespace; canonical JSON is required).
- `package.json` `name`, `version`, `description`, `keywords`, `author`, `license`, `engines.node`, `bin.cdb-to-json`, and `exports` — preserve until Phase 5 confirms packed-artifact contents.
- `tsconfig.json` — preserve strict, native ESM, NodeNext resolution, and `rootDir: "./src"`.

Modify these files in the remediation:

- `src/cdb/openDatabase.ts`, `src/cdb/iterateRows.ts`, `src/cdb/rawTypes.ts` — replace per R1.1–R1.3.
- `src/diagnostics/codes.ts`, `src/diagnostics/collector.ts` — add the codes and helpers per R0.2.
- `src/application/convertCatalog.ts` — replace per R1.3; introduce `src/application/iterateRawCards.ts`, `src/application/normalizeOptions.ts`, `src/application/stagingBudget.ts`, `src/application/readCdb.ts`, `src/application/diagnosticsPolicy.ts`.
- `src/discovery/discoverCdbInputs.ts` — replace per R1.4; introduce `src/discovery/pathPolicy.ts`.
- `src/cli.ts`, `src/cli/parseArgs.ts`, `src/cli/exitCodes.ts`, `src/cli/renderHelp.ts`, `src/cli/renderDiagnostics.ts` — extend only the Phase 0–1 pre-open option/exit contracts and add `--max-snapshot-bytes`; use injected `{ stdout, stderr }` streams and no `console.*`. The full profile/output matrix remains Phase 2.
- `src/legacy.ts` — replace per R1.5 and route writes through the isolated compatibility boundary.
- `src/compatibility/legacyOutput.ts` — implement the minimal legacy output-directory/lock/temp/force-compatible atomic-write boundary from Revision 1 A6.
- `src/destinations/secureDestination.ts` — add the Phase 0 typed native capability/publication boundary; do not implement modern output publication until Phase 2.
- `src/index.ts` — re-export per R1.5.
- `app/index.js` — replace the body to re-export the built legacy default.
- `vitest.config.ts` — extend include per R0.1.
- `package.json` — add scripts per R0.1; pin `node-gyp` per R0.1.

Create these new files:

- `scripts/build-native.mjs`, `scripts/package-check.mjs`.
- `native/secure-destination/binding.gyp`, `native/secure-destination/src/secure_destination.cc`, `native/secure-destination/src/secure_destination.h` (committed; built only on supported Linux).
- `schemas/*.schema.json` per R0.2.
- `src/cdb/snapshotBundle.ts`, `src/cdb/materializeSnapshot.ts`, `src/cdb/textPreflight.ts`.
- `src/hashing/sha256.ts`, `src/hashing/canonicalJson.ts`.
- `src/application/{iterateRawCards,readCdb,normalizeOptions,stagingBudget,diagnosticsPolicy,limits,types}.ts`.
- `src/compatibility/legacyOutput.ts`, `src/destinations/secureDestination.ts`.
- `src/registry/placeholder.ts`.
- `tests/fixtures/{buildCdbFixture,cases,fixture.test,integerVectors}.test.ts`, `tests/fixtures/generated/README.md`, `tests/fixtures/expected/minimal-*.json`, `tests/fixtures/pilot-ids.json`.
- `tests/conformance/schemaValidation.test.ts`.
- `tests/unit/diagnosticsPolicy.test.ts`.
- `tests/reader/{walMaterialization,textByteFidelity,physicalSnapshotProvenance,discovery,joinDiagnostics,largeJoin,stagingSnapshotBudget,openDatabase,schema,iterateRows,resourceLimits}.test.ts`.
- `tests/api/iterateRawCards.test.ts`, `tests/api/iterateRawCards.types.test.ts`.
- `tests/cli/{exitCodes,limitRelations}.test.ts` — Phase 0–1 pre-open/exit-policy gates. `tests/cli/{freshSplitRoot,secureDestinationRace,convertExitCodes}.test.ts` are Phase 2 artifacts and MUST NOT be used as evidence for this checkpoint; the `test:cli` script is nevertheless declared now.
- `tests/compatibility/{legacy,legacy-output,legacyNames}.test.ts`.

Do not modify `docs/cdb-to-json-cli-refactor-spec.md` — it is the root normative spec. The tactical package (`docs/cdb-to-json-cli-refactor/spec.md`) and its phase documents remain the authoritative implementation plan.

## Stop / rollback conditions

- Stop the entire remediation if any reviewer finding must be rejected rather than corrected. No finding is rejected in this plan; if a future maintainer wishes to do so, route a senior-planner re-decision through a `senior-translation` handoff.
- Stop if `npm ci` does not succeed on the supported Node 22+ Linux matrix. `better-sqlite3` must build natively.
- Stop if `npm run build:native` either fabricates a native module on an unsupported host or fails without writing an `unsupported` capability manifest.
- Stop if any of the named fixture gates fails on the supported host. The named gates are listed below.
- Roll back only the new files listed in R1.* if a Phase 1 fixture gate fails; do not roll back Phase 0 contracts.
- Do not roll back `app/getDirectory.js` or `app/getTables.js` until `tests/compatibility/legacy.test.ts` and `tests/compatibility/legacy-output.test.ts` pass.
- Do not claim Phase 0–1 complete until every task above, every named test, and the consolidated gate pass.

## Named fixture gates (must exist before coding review)

Each test asserts diagnostics and exit path, not merely thrown-message text. Names are frozen.

- `tests/fixtures/integerVectors.test.ts` — IDs `-2`, `0`, `2`, `10`, signed-int64 extrema, NULL, numeric-looking TEXT, REAL, BLOB; canonical numeric ordering; ordinals independent of insertion order; invalid IDs emit `INVALID_CARD_ID` before any join.
- `tests/fixtures/fixture.test.ts` — generated fixture is reproducible; golden minimal records validate; conflict vectors validate the nullable/array shape.
- `tests/conformance/schemaValidation.test.ts` — every frozen schema validates its golden record; aggregate schemas use `items` referencing the frozen item schema; `UNSUPPORTED_DATABASE_ENCODING` is referenced in the limits/diagnostics documentation.
- `tests/reader/walMaterialization.test.ts` — WAL-only committed row, source member immutability, no extraction sidecar, materialization failure/no publish.
- `tests/reader/textByteFidelity.test.ts` — UTF-16 rejection (`UNSUPPORTED_DATABASE_ENCODING`), wrong storage type precedence (`INVALID_TEXT_VALUE`), over-limit non-selection (`RESOURCE_LIMIT_EXCEEDED`), under-limit non-ASCII/astral text, invalid bytes (`INVALID_TEXT_ENCODING`).
- `tests/reader/physicalSnapshotProvenance.test.ts` — physical bundle hash changes after physical reorder while canonical rows/ordinals/winners remain equal.
- `tests/reader/discovery.test.ts` — nested directories, exclude normalization, explicit files, dotted/non-final names, symlink default/follow/cycles, deterministic ordering.
- `tests/reader/joinDiagnostics.test.ts` — duplicate IDs, orphan rows, raw fidelity, ordinals, ordering, diagnostics codes.
- `tests/reader/largeJoin.test.ts` — bounded memory, row limit, byte-length preflight, extra-table metadata, signed-64 decimal raw values, no JavaScript map.
- `tests/reader/stagingSnapshotBudget.test.ts` — `maxSnapshotBytes` enforcement, aggregate staging reservation/reconciliation, cleanup on every success/failure/cancellation path, extra-table/WAL over-budget pre-copy rejection.
- `tests/cli/limitRelations.test.ts` — zero/equal/less/greater relation vectors before discovery/open; `INVALID_LIMIT_RELATION` exit 2.
- `tests/cli/exitCodes.test.ts` — option (2) > no-input (3) > input/schema/strict/resource/integer (4) > merge collision (5) > output conflict / unsafe destination / write / cancel (6) > mixed continued database failures (7); under strict mode warnings promote to errors.
- `tests/unit/diagnosticsPolicy.test.ts` — per-database collectors merge, strict promotion, severity/promotion matrix, terminal exit precedence.
- `tests/api/iterateRawCards.test.ts` — async iterator signature, per-row signal checks, scheduler checkpoints, direct-consumer `return()`/`finally` cleanup, abort rejection, `convert()` reuse.
- `tests/api/iterateRawCards.types.test.ts` — type-level assertion that the public API is `AsyncIterableIterator<RawCardRows>` and no synchronous public iterator is exported.
- `tests/compatibility/legacy.test.ts` — `app/index.js` invoked against `__tests__/input_dir/cards.cdb` reproduces the v1 fixture's logical content for `emit: true`; `emit: false` resolves `void` and writes nothing when no output directory is supplied; with an output directory it writes the same raw table shape and a subsequent `emit: true` call reads back the same content; `ignore` matches the derived basename; dotted/non-final names are accepted; capture stdout/stderr and assert no `console.*` calls.
- `tests/compatibility/legacy-output.test.ts` — two successive writes through `src/compatibility/legacyOutput.ts`; injected failed second write preserves the prior final; output-directory creation; `LEGACY_BASENAME_COLLISION`; unsafe legacy integers emit `LEGACY_INTEGER_UNREPRESENTABLE`; emit-false writes resolve `void`.
- `tests/compatibility/legacyNames.test.ts` — direct-child candidates whose names contain `.cdb`, old first-dot basename derivation, basename `ignore`, derived-basename collisions.

## Consolidated gate

Run after `npm ci` on Node 22+ Linux:

```bash
npm run build
npm run test:fixtures
npm run test:unit
npm run test:conformance
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
npm test
```

The gate fails if:

- any named fixture gate above fails;
- `npm run build:native` fabricates a native module on an unsupported host or omits the capability manifest;
- `npm run package:check` does not verify the exact artifact and module hash;
- `npm test` does not run the complete declared suite;
- the v1 fixture's logical content is not preserved through `app/index.js`;
- any `src/` module imports `console`, terminal state, or a process-global logger;
- an aggregate schema uses an unfrozen identifier;
- locale/namespace changes leave `conversionOptionsHash` unchanged;
- insertion order changes an ordinal;
- an oversized valid TEXT is selected;
- a valid WAL database is rejected as self-mutating or a UTF-16 database reaches the join;
- an invalid ID reaches the join or an orphan requires a fabricated field;
- a snapshot/SQLite handle survives failure;
- a signal checkpoint is missing in the async iterator.

## Acceptance criteria

1. Every task in R0.* and R1.* is complete and committed; no task is partial.
2. Every named fixture gate passes.
3. The consolidated gate passes on Node 22+ Linux.
4. `app/index.js` reproduces the v1 fixture's logical content with no `console.*` calls.
5. The reader is `iterateRawCards`: async, signal-aware, yielding per row with `scheduler.yield()` every 256 rows, closing every handle in `finally`.
6. The reader is `safeIntegers: true`, opens with `immutable=1`, captures and materializes a snapshot bundle before opening, and rejects `CDB_OPEN_FAILED` rather than falling back to a live read.
7. The reader uses a fixed `LEFT JOIN UNION ALL` statement with an explicit column list, no JavaScript map, canonical signed-int64 numeric ordering, and zero-based `dataOrdinal`/`textOrdinal` ordinals.
8. The diagnostics policy enforces the exit precedence and merges per-database collectors.
9. The discovery policy uses `lstat` for symlink detection, normalizes excludes against root-relative slash form, and keeps legacy discovery separate.
10. `package:check` verifies the native module hash; an unsupported host writes an `unsupported` capability manifest and never fabricates a module.

## Risks and mitigations

| Risk | Impact | Mitigation / stop condition |
|---|---|---|
| Native secure-destination adapter cannot be built on the supported host | Phase 0 contract gate fails | Run `npm run build:native` early; fail loudly and stop if `dist/native/secure_destination.node` is missing on the release host; do not weaken to a path-based fallback. |
| `better-sqlite3` safe-integer boundary is bypassed by JavaScript number conversion | Signed-64 lossless contract violated | Type the raw boundary as `string` (signed-int64 decimal); add `integerVectors.test.ts`; assert `INTEGER_OUT_OF_RANGE` and wrong storage classes; do not coerce. |
| Materialized snapshot is silently skipped | Live-read fallback reappears | Add `walMaterialization.test.ts` and `physicalSnapshotProvenance.test.ts`; require `immutable=1` at extraction; close the bundle connection after `VACUUM INTO`; assert no extraction sidecar. |
| Async iterator is not actually cancellable | SIGINT leaves a partial result | Add `iterateRawCards.test.ts` with per-row signal checks and a 256-row scheduler checkpoint; add a child-process signal test. |
| Discovery allows symlink loops | Heuristic discovery breaks the source-identity contract | Use `lstat`, track realpaths, visit each target once; add `discovery.test.ts`. |
| Legacy bridge silently diverges from v1 | Consumer breakage | Two successive writes, derived-basename collision, unsafe legacy integer, `app/index.js` invocation against the v1 fixture are required tests. |
| Diagnostics exit precedence drifts | Misleading exit code | Single `computeExitCode` helper; `exitCodes.test.ts` and `diagnosticsPolicy.test.ts` enforce the table. |

## Cross-references

- `docs/cdb-to-json-cli-refactor-spec.md` — root normative spec.
- `docs/cdb-to-json-cli-refactor/spec.md` — tactical package (revision 7).
- `docs/cdb-to-json-cli-refactor/phase-0-contract-fixtures.md` — Phase 0 detail.
- `docs/cdb-to-json-cli-refactor/phase-1-reader-compatibility.md` — Phase 1 detail.
- `docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md` — limits, severity, exit precedence.
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md` — D1–D8 decisions.