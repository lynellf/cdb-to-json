# Remediation phase — contract phases P1–P2 (Phase 0–1 implementation checkpoint)

## Status and scope

This is a corrective phase after the first implementation checkpoint was reviewed as `REQUEST-CHANGES`. It is intentionally limited to Phase 0 (contract/toolchain/fixtures) and Phase 1 (reader/diagnostics/compatibility bridge). Phases 2–5 remain deferred until this checkpoint passes.

The remediation does not redesign the accepted tactical package or the senior remediation specification; it reuses them. Every finding below maps to ordered corrective tasks with exact files, named test fixtures, stop conditions, and verification commands. The implementer may not declare Phase 0–1 complete until every task, every named test, and the consolidated gate pass. Do not paper over a missing capability by weakening the signed-int64, snapshot, bounded-join, secure-cleanup, or v1-compatibility contracts.

## Revision 6/7 — plan-reviewer-a corrections and plan-reviewer-b remediation

This revision addresses only the two remaining plan/verification blockers. It preserves the accepted R4.2 orphan contract, stale-evidence invalidation, and ordered P1 gates from the prior remediation. It does not reopen product scope or native support policy.

### R6.1 — Deterministically exercise every native build outcome

Refactor `scripts/build-native.mjs` into an import-safe, typed `runNativeBuild(rootDir, host, build, probe)` boundary. `rootDir` is explicit; the function must not read `process.cwd()`, host globals, or process arguments at import time and must never call `process.exit`. `host` supplies `platform`, `arch`, `nodeVersion`, `nodeAbi` (the Node module ABI, not a version string), and `napiVersion`. Injected `build` owns module compilation/copy into the supplied root, and injected `probe` returns a validated capability result: boolean `supported`, arrays of primitive/flag names, and a complete primitive-probe result with no contradictory fields. Missing fields, wrong types, or `supported:true` without every required primitive are malformed. The only process-exit side effect is the thin executable wrapper that calls `runNativeBuild` for the real pinned `node-gyp` build/probe.

Freeze the typed result and manifest boundary: every outcome writes a canonical manifest containing `platform`, `arch`, `nodeAbi`, `napiVersion`, `moduleSha256`, `supported`, `supportedPrimitives`, `requiredFlags`, and `primitiveProbeResults`. `supported: true` is legal only when the packaged module exists and its SHA-256 matches `moduleSha256`. Every unsupported or malformed/failed-probe outcome removes `dist/native/secure_destination.node`, writes `supported: false` with the zero-hash sentinel and empty primitive arrays, and leaves no fallback/path-based artifact. A failed compiler may return a failed result for the wrapper, but it must still perform the same stale-module cleanup before writing the unsupported manifest.

`tests/cli/nativeCapabilityCleanup.test.ts` uses an isolated temporary root and injected dependencies to exercise four independent vectors: (a) an unsupported host with a pre-existing stale module, (b) a synthetic supported Linux/Node-22 host whose injected build copies a fake module and whose post-copy probe returns `supported: false`, (c) `supported: true` with a matching module hash, and (d) a failed or malformed probe after copy. The test must prove the post-copy branch is reached, canonical `nodeAbi` semantics are used, no unsupported vector retains a module or fallback artifact, and only the matching supported vector retains the module. It must not invoke a compiler or branch on the actual host. `scripts/package-check.mjs` remains defense in depth and rejects both unsupported-manifest/module pairs and supported hash mismatches.

Verification: `npx vitest run tests/cli/nativeCapabilityCleanup.test.ts`, then `npm run test:cli`, then `npm run build:native && npm run build && npm run package:check`.

### R6.2 — Close the frozen orphan and aggregate-schema contract

R6.2 depends on and closes the earlier R2.2 orphan correction; it is not a spans-only patch. Re-prove the full R4.2 contract in the named item/aggregate schemas and goldens. The source item schema must require `printed.name`, `printed.cardKind`, every `printed.desc`/`str1`–`str16` source field, a complete nullable typed-surface set (`monster`, `spell`, and `trap`), and `simulatorSource.rawRows` with required nullable `datas` and `texts` partners. Datas-only goldens use `cardKind: "UNKNOWN"`, null typed surfaces, null text fields, `rawRows.datas` present/`rawRows.texts` null, and `MISSING_TEXT_ROW`; texts-only goldens retain exact name/text, keep data-derived surfaces null/empty, use `rawRows.datas` null/`rawRows.texts` present, and emit `MISSING_DATA_ROW`. No required field may be represented by omission or `undefined`.

Update the frozen item schemas and all named orphan/minimal goldens as needed: `schemas/cdb.card.v2.schema.json`, `schemas/ygo.card-source.v1.schema.json`, `schemas/cdb.card-array.v2.schema.json`, `schemas/ygo.card-source-array.v1.schema.json`, `tests/fixtures/expected/orphan-datas-only-card.json`, `tests/fixtures/expected/orphan-texts-only-card.json`, `tests/fixtures/expected/orphan-datas-only-source.json`, `tests/fixtures/expected/orphan-texts-only-source.json`, `tests/fixtures/expected/minimal-source.json`, `tests/fixtures/expected/minimal-source-array.json`, and `tests/conformance/schemaValidation.test.ts`. Both aggregate schemas must use a `$ref` to the frozen item schema (`cdb.card/2` or `ygo.card-source/1`); they must not duplicate an inline item shape. Conformance must load the frozen item schemas, validate all aggregate goldens through those references, assert the required orphan fields, reject deletion of each representative orphan field at item level, reject the same mutations through the aggregate validator, and reject `spansBasis: "utf-16-code-units"` at both item and aggregate levels.

Set every `text.spansBasis` constant and source golden value to `"normalized"`. Retain `text.offsetEncoding: "utf-16-code-units"`; it is the offset unit and must not be moved to `spansBasis`. The aggregate negative test must fail because the `$ref` reaches the frozen item schema, not merely because the aggregate repeats a local constant. Preserve unrelated nullability, source-profile, raw-row, and diagnostic semantics.

Verification: `npm run test:fixtures && npm run test:conformance`, followed by `git diff --check`, JSON parsing of all five schema files and named goldens, and an explicit aggregate mutation test run from `tests/conformance/schemaValidation.test.ts`.

### R6 stop conditions

Stop if the native regression can pass without reaching the post-copy probe result, if it depends on host capability or compiler availability, if `supported: false` coexists with the packaged module, or if any named Phase-0 artifact treats `utf-16-code-units` as `spansBasis`. Stop if any source artifact changes `offsetEncoding` away from `utf-16-code-units`, because that would be a separate contract change.

### Reviewer-B closure additions (R6.3–R6.5)

These additions are part of the active R6 gate and supersede any earlier wording in this file about native temporary creation, aggregate schema duplication, snapshot hashing, or P2 merge/output evidence.

**R6.3 native ABI decision.** The selected secure-publication equivalent is named descriptor-relative temporary files plus `renameat2`: create visible temporary and lock leaves under the trusted root with `openat(O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW)`, publish with separate no-replace (`RENAME_NOREPLACE`) and force-replace (`flags=0`) operations, and remove by trusted-root-relative descriptor operations. `O_TMPFILE` and `linkat` are not part of the ABI. The C++ and TypeScript boundaries must remove path-based lock/rename calls and return/close opaque descriptors. The functional probe and manifest must prove both publication modes, trusted-root traversal, no-follow behavior, and cleanup; advertised primitives are exactly `openat2`, `openat`, and `renameat2` with the required resolution/open flags.

**R6.4 snapshot and extraction decision.** Add `src/cdb/sourceHandle.ts` as the lifecycle boundary named by `INV-002`; it owns capture, materialization, extraction, reservations, and idempotent cleanup while delegating byte copying/hash calculation to `snapshotBundle.ts`. Reject every source member that is not a regular non-symlink file. Hash the exact `[main,-wal,-shm]` bytesBase64 representation incrementally with a streaming base64 encoder. Escape private `VACUUM INTO` paths as verified SQLite string literals and test quote-bearing staging paths. Open the materialized file through a URI with `uri:true`, `immutable=1`, and `defaultSafeIntegers()` before any value query. Inventory and reserve the materialized main plus every generated private journal/WAL/SHM/temporary sibling and delete them on every finally path.

**R6.5 phase gate decision.** P2 owns only source snapshot/materialization, bounded reader joins, discovery, diagnostics, async iteration, and the isolated legacy writer. Remove `tests/cli/conversionLifecycle.test.ts` and all merge spool/index/lineage assertions from P2 evidence; `stagingSnapshotBudget.test.ts` proves only snapshot/materialized/legacy private files and a generic reservation contract. Merge accounting and modern output publication are P3/P4 work. P2 evidence must inspect `sourceHandle.ts` and the exact focused command sequence, and it must not claim acceptance from a later-phase test.

## Revision 2 — checkpoint review remediation

This revision addresses the two actionable blocking findings from the checkpoint review. It removes the absent-not-null interpretation from the active P1 package and makes the post-build capability-probe cleanup path explicit. Undefined review labels are not acceptance criteria and are not reproduced here.

### Consolidated findings and decisions

1. **Implementation defect — unsupported post-build probe leaves a stale module.** The native build can copy `dist/native/secure_destination.node`, then report `supported: false` from the capability probe while leaving that file beside the unsupported manifest. The smallest correction is to remove the copied module on that branch, write the unsupported manifest, and retain a regression check. The pre-build unsupported-host branch and this post-probe branch must have identical package-visible behavior.
2. **Structural contract defect — orphan fixtures accept omission contrary to R4.2.** The existing card orphan fixtures/tests omit nullable fields and assert `undefined`, while normative R4.2 requires `cardKind: "UNKNOWN"`, null typed surfaces, null/empty text/data-derived states, and explicit missing-partner lineage. The smallest correction is to make schemas require the nullable/empty states, rewrite the golden fixtures, and assert rejection of omitted required states. Mapper phases consume this contract; this P1 task does not redesign their later decoding.

### Ordered corrective tasks

#### R2.1 — Redline the active orphan contract

Update `docs/cdb-to-json-cli-refactor/spec.md`, `docs/cdb-to-json-cli-refactor/phase-0-contract-fixtures.md`, and the P1 entries in `docs/cdb-to-json-cli-refactor/execution-contract.json` so R4.2 is unambiguous. For `cdb.card/2`, require the orphan-visible `cardKind`, `traits`, typed surfaces, and text object: datas-only emits `UNKNOWN`, `[]`, null typed surfaces, and null text values; texts-only retains exact text/name while data-derived surfaces remain null/empty. For `ygo.card-source/1`, require `printed.name`, `printed.cardKind`, nullable typed surfaces, the complete required text object, and `simulatorSource.rawRows` with one side null. Preserve present IDs, exact present raw values, `MISSING_TEXT_ROW`/`MISSING_DATA_ROW`, empty references, and `SOURCE_ONLY`. Do not add placeholder semantics or an absent-field alternative.

Files: `docs/cdb-to-json-cli-refactor/spec.md`, `docs/cdb-to-json-cli-refactor/phase-0-contract-fixtures.md`, `docs/cdb-to-json-cli-refactor/execution-contract.json`.

#### R2.2 — Make schemas and golden vectors enforce the redline

Update `schemas/cdb.card.v2.schema.json` and `schemas/ygo.card-source.v1.schema.json` to require the stable orphan fields and nullable/empty types without broadening unrelated fields. Rewrite `tests/fixtures/expected/orphan-datas-only-card.json`, `orphan-texts-only-card.json`, `orphan-datas-only-source.json`, and `orphan-texts-only-source.json` with the R4.2 states. Keep raw orphan vectors unchanged except where the fixed raw boundary requires partner nullability.

Update `tests/conformance/schemaValidation.test.ts` to assert exact `UNKNOWN`, `null`, empty arrays, exact text retention, raw-row partner nullability, and both missing-partner diagnostics. Add negative assertions that deleting a required orphan field makes AJV validation fail. The tests must not assert `undefined` for any R4.2-required field.

Files: `schemas/cdb.card.v2.schema.json`, `schemas/ygo.card-source.v1.schema.json`, the four orphan card/source golden files, `tests/conformance/schemaValidation.test.ts`.

#### R2.3 — Close the native post-probe stale-artifact path

Implement the same cleanup in `runNativeBuild` immediately after the injected/real `probe()` result is obtained. If the result is unsupported, failed, or malformed, remove the packaged module, write the canonical `supported: false` manifest, and return a typed unsupported/failed result; the executable wrapper alone may set a process exit code or emit diagnostics. Only a validated supported probe plus a matching module hash may retain the module and write a supported manifest. Keep `scripts/package-check.mjs` as defense in depth: any unsupported manifest with a module or supported hash mismatch remains a hard failure.

Add the deterministic regression specified by R6.1 at `tests/cli/nativeCapabilityCleanup.test.ts`; it must inject a synthetic supported host and a post-copy `supported: false` probe, then assert unsupported manifest means no module. A supported-probe vector must retain only a hash-matching module. This supersedes the earlier host-branch allowance: the test must never depend on actual host capability or accept a module beside `supported: false`.

Files: `scripts/build-native.mjs`, `scripts/package-check.mjs`, `tests/cli/nativeCapabilityCleanup.test.ts`.

#### R2.4 — Invalidate stale evidence and rerun the checkpoint

Mark `docs/cdb-to-json-cli-refactor/phases/P1/P1-EVIDENCE.md` and `docs/implementation/current.md` as superseded for the P1 completion claim until the new contract and native branch are re-proven. Do not carry forward a prior PASS statement that conflicts with the package gate. Record command output and host capability branch after rerun; the unrelated untracked storage-class suite is not part of the named P1 gate and must be reported separately rather than used to weaken this correction.

Files: `docs/cdb-to-json-cli-refactor/phases/P1/P1-EVIDENCE.md`, `docs/implementation/current.md`.

### Remediation verification

Run these in order from a clean working tree/build output:

```bash
npm run build:native && npm run build && npm run package:check
npm run test:fixtures && npm run test:conformance
npm run test:unit && npx vitest run tests/cli/limitRelations.test.ts tests/cli/nativeCapabilityCleanup.test.ts
npm test
```

The first three commands are the focused P1 proof. `npm test` is the full configured suite and must be reported independently if an unrelated untracked test fails. The checkpoint remains blocked if the package gate sees a stale module, any orphan fixture validates only because a field is omitted, or any mapper/test reintroduces absent-not-null semantics.

## Revision 1 — plan-reviewer-a corrections (A1–A9)

This revision is a targeted correction to the executable plan. It does not reopen D1–D8, add Phase 2–5 product behavior, or alter `docs/cdb-to-json-cli-refactor-spec.md`. The following rules supersede any less-specific wording later in this document.

### A1 — the app-shim gate is runnable

`vitest.config.ts` MUST include `__tests__/**/*.test.js` in addition to `__tests__/**/*.test.ts` and `tests/**/*.test.ts`. `__tests__/main.test.js` MUST import `app/index.js` (not `dist/index.js`), import `it`/`expect` from `vitest` rather than `node:test`, and assert the v1-shaped result against the checked-in fixture. `npm test` is the complete declared suite and MUST run `npm run build && vitest run`; this include glob is what makes the JavaScript app-shim test execute. The focused `test:compat` gate runs `tests/compatibility` and the app-shim test is also run by the full suite. It is a Vitest JavaScript suite, not an untracked Node-only smoke test.

The package scripts are frozen for this checkpoint as follows: `build:native` runs the executable wrapper in `scripts/build-native.mjs`; `build` runs `npm run build:native && tsc -p tsconfig.json`; `test:cli` is explicitly limited to `tests/cli/exitCodes.test.ts`, `tests/cli/limitRelations.test.ts`, and `tests/cli/nativeCapabilityCleanup.test.ts` until P3 expands it; the other focused scripts run their named `tests/<area>` directory; `test` runs `npm run build && vitest run`; and `package:check` runs `scripts/package-check.mjs`. No focused script may rely on an undeclared target or later-phase test.

### A2 — one exit-policy implementation

`src/cli/exitCodes.ts` is the sole owner of terminal precedence. It exports `computeExitCode(state: ExitCodeState): ExitCode`, where the required state is explicit and typed:

```ts
export type ExitCodeState = {
  optionError: boolean;
  hasUsableInput: boolean;
  /** True once discovery has produced an input and snapshot/open/read work has begun. */
  inputAccessStarted: boolean;
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

`computeExitCode` applies one explicit predicate matrix: option error/invalid limit relation first (`2`); `!hasUsableInput && !inputAccessStarted` with no input/strict/resource/collision/output/cancellation/internal failure (`3`); output error or cancellation (`6`); input/schema/strict/resource/integer failure when no output failure occurred (`4`); merge collision when no output or input failure occurred (`5`); mixed continuation with at least one completed and one failed input (`7`); unexpected internal failure (`1`); otherwise success (`0`). This makes output failure/cancellation override pending input, collision, or partial state, input failure override collision when output is clean, and collision override partial success. `DiagnosticCollector` MUST only collect, `merge`, and `promote`; it MUST NOT expose a second exit-code helper or accept ambiguous booleans. `convert()` and the CLI both construct this state and call the same exported function. `tests/unit/diagnosticsPolicy.test.ts` tests merge/promotion and `tests/cli/exitCodes.test.ts` tests the pairwise matrix for input+writer failure, input+cancellation, input+collision, collision+writer failure, option/no-input combinations, and the successful/partial states.

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

Object keys use the repository canonical-JSON ordering, array order is fixed, absent members remain explicit, and `bytesBase64` is derived from the copied bytes (not the original path). Implementations MUST stream the equivalent canonical serialization with bounded base64 carry state rather than hold a full member or base64 string in memory, and MUST produce the same digest. `src/cdb/sourceHandle.ts`, `src/cdb/snapshotBundle.ts`, `sourceRevisionId`, and `tests/reader/physicalSnapshotProvenance.test.ts` use this representation; the prior `[{name,present,sha256,size}]` wording is superseded. A physical reorder therefore changes this hash/source revision while `canonicalDataProjection(record)`, canonical rows, and ordinals remain equal; merge-winner invariance is proven only in P3/P4.

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
| R1.6 | Diagnostics / strict / exit aggregation missing | Add a top-level `DiagnosticCollector` that merges per-database collectors; promote `WARNING` → `ERROR` under `--strict`; apply one explicit `computeExitCode(...)` predicate matrix: option (2), no-input only before input access and absent output/cancellation (3), output/cancellation (6), input/schema/strict/resource/integer without output failure (4), collision without output/input failure (5), mixed continuation (7), internal (1); emit the documented `MAX_ROWS_EXCEEDED`/`MAX_TEXT_LENGTH_EXCEEDED` → `RESOURCE_LIMIT_EXCEEDED` plus the new stable codes. | `tests/unit/diagnosticsPolicy.test.ts`, `tests/cli/exitCodes.test.ts` |
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
  - `test:cli`: `vitest run tests/cli/exitCodes.test.ts tests/cli/limitRelations.test.ts tests/cli/nativeCapabilityCleanup.test.ts` for the P1/P2 checkpoint; P3 expands this same script to its modern CLI files
  - `test:api`: `vitest run tests/api`
  - `test:normalization`: `vitest run tests/normalization`
  - `test:source`: `vitest run tests/source`
  - `test:streaming`: `vitest run tests/streaming`
  - `test:conformance`: `vitest run tests/conformance`
  - `test`: `npm run build && vitest run`
  - `package:check`: `node scripts/package-check.mjs`
  - `lint`: keep existing `tsc --noEmit`; do not replace with a non-TSC linter.
- `package.json` — pin `node-gyp` to `11.2.0` in `devDependencies`; add `@types/node` already present.
- `package-lock.json` — regenerate so the `node-gyp` pin survives.
- `scripts/build-native.mjs` — expose import-safe `runNativeBuild(rootDir, host, build, probe)` and keep process exit only in the executable wrapper. On supported Linux/Node 22+, invoke the pinned `node-gyp` build, verify the module hash, and write a canonical manifest containing `platform`, `arch`, Node module `nodeAbi`, `napiVersion`, `moduleSha256`, `supported`, `supportedPrimitives: ["openat2","openat","renameat2"]`, and required resolution/open flags. Unsupported-host, post-probe-unsupported, failed-probe, and malformed-probe paths remove any stale `dist/native/secure_destination.node`, write `supported:false`, and leave no fallback artifact.
- `scripts/package-check.mjs` — run `npm pack --dry-run`; verify that `dist/index.js`, `dist/cli.js`, `dist/legacy.js`, `dist/native/capability.json`, `schemas/*.schema.json`, `README.md`, `LICENSE`, and `package.json` are present; when the manifest is supported, require `dist/native/secure_destination.node` and verify its SHA-256; when the manifest is unsupported, fail if that module exists; on a release host (CI tag or `CDB_RELEASE_HOST=1`) fail loudly when the Linux native module is missing; on non-release hosts without the module, emit a non-fatal warning and continue.
- `src/destinations/secureDestination.ts` — committed Phase-0 capability and adapter contract. It names the Linux Node 22+ support matrix, `openat2`/`openat`/`renameat2` named-temp ABI, required flags, trusted-root/reservation/temp/no-replace/force/cleanup operations, opaque descriptor ownership, and the no-path-fallback failure boundary; modern implementation is Phase 2.
- `native/secure-destination/binding.gyp`, `native/secure-destination/src/secure_destination.cc`, `native/secure-destination/src/secure_destination.h` — committed source. The native module owns `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow directory opens, visible descriptor-relative named temps/locks via `openat(O_CREAT|O_EXCL|O_NOFOLLOW)`, and separate no-replace/force `renameat2` operations. It exposes no path-based lock/rename ABI and resolves no unchecked string path after root acquisition.
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

- `src/cdb/sourceHandle.ts` and `src/cdb/snapshotBundle.ts` — make `sourceHandle` the named lifecycle owner. Acquire the input parent through a held directory descriptor and traverse components with `openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)` or equivalent descriptor-relative `openat(O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`. Resolve siblings `main`, `-wal`, `-shm` with `lstat` only as an observation; open each present member with `O_NOFOLLOW|O_RDONLY|O_CLOEXEC`, hold the descriptor through copy/hash, fstat-verify identity/size/mode against the observation, and copy/hash from that descriptor. Reject symlinks and any non-regular member as `INVALID_PATH`; a lstat-to-open swap emits `SOURCE_MUTATED_DURING_READ`/stable path diagnostic and never reads a replacement target. Recheck identity/size/bytes plus sidecar presence before any SQLite open. Retry bounded races (≤ 3), then emit `SOURCE_MUTATED_DURING_READ`. Stream-copy members and incrementally hash the exact canonical `[ { name, present, bytesBase64 } ]` representation with bounded base64 carry state; do not allocate the full member/base64 tuple. No unchecked string path is resolved after the staging root is acquired and no path-based copy follows lstat.
- `src/cdb/materializeSnapshot.ts` — open only the copied bundle with ordinary WAL-capable SQLite access (`readonly: false` is required for `VACUUM INTO`; the source is the private copy, not the user input); encode the private destination as a verified SQLite string literal (reject NUL and double embedded single quotes), run `VACUUM INTO`, inventory generated private journal/WAL/SHM siblings, and close the bundle connection before extraction. Never open the original source or sidecar; report `CDB_OPEN_FAILED` on replay/materialization failure.
- `src/cdb/openDatabase.ts` — open only a URI-encoded materialized main file with `{ uri: true, readonly: true, fileMustExist: true }` and `immutable=1`; disable extension loading; call `defaultSafeIntegers()` before any value query; read `PRAGMA encoding` exactly once before text selection and emit `UNSUPPORTED_DATABASE_ENCODING` (exit 4) for anything other than `UTF-8`; close the handle in `finally` on every exit path.
- `src/hashing/sha256.ts` — canonical JSON SHA-256 over a sorted-key, deterministic object.
- `src/application/stagingBudget.ts` — single aggregate reservation counter used by source members, materialized main, private SQLite journal/WAL/SHM siblings, legacy output staging, and lock records in P2. `reserve(path, bytes)` and `reconcile(path)` track actual file sizes; over-budget writes emit `RESOURCE_LIMIT_EXCEEDED` before the write completes; cleanup removes every reserved file on success/failure/cancellation paths. Merge spool/index/lineage reservations are deferred to P3/P4.

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
- `src/cli/exitCodes.ts` — export the typed `ExitCodeState` (including `inputAccessStarted`) and sole `computeExitCode(state)`, applying the explicit option/no-input/output-cancellation/input/collision/partial/internal predicate matrix. Both the application and CLI call this same function.

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
- `src/cdb/sourceHandle.ts`, `src/cdb/snapshotBundle.ts`, `src/cdb/materializeSnapshot.ts`, `src/cdb/textPreflight.ts`.
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
- `tests/reader/physicalSnapshotProvenance.test.ts` — physical bundle hash changes after physical reorder; `canonicalDataProjection(record)`, canonical rows, and ordinals remain equal while full records differ only at declared physical identity fields; merge-winner invariance is deferred to P3/P4.
- `tests/reader/discovery.test.ts` — nested directories, exclude normalization, explicit files, dotted/non-final names, symlink default/follow/cycles, deterministic ordering.
- `tests/reader/joinDiagnostics.test.ts` — duplicate IDs, orphan rows, raw fidelity, ordinals, ordering, diagnostics codes.
- `tests/reader/largeJoin.test.ts` — bounded memory, row limit, byte-length preflight, ordinary extra-table metadata, signed-64 decimal raw values, no JavaScript map.
- `tests/reader/extraTableLimits.test.ts` — large extra table, bounded value-free sentinel probe, `MAX_EXTRA_TABLE_ROWS_EXCEEDED`/`RESOURCE_LIMIT_EXCEEDED`, no extra-cell query, and cleanup.
- `tests/reader/stagingSnapshotBudget.test.ts` — `maxSnapshotBytes` enforcement, source/materialization/legacy-private aggregate staging reservation/reconciliation, cleanup on every success/failure/cancellation path, generated private SQLite sidecar inventory, and extra-table/WAL over-budget pre-copy rejection; merge spool/index/lineage accounting is deferred.
- `tests/cli/limitRelations.test.ts` — zero/equal/less/greater relation vectors before discovery/open; `INVALID_LIMIT_RELATION` exit 2.
- `tests/cli/exitCodes.test.ts` — the explicit terminal predicate matrix, including input+writer failure, input+cancellation, input+collision, collision+writer failure, option/no-input combinations, no-input without input access, and mixed continuation; under strict mode warnings promote to errors. P2 proves only the pre-open/diagnostics states; merge/output lifecycle cases remain later-phase tests.
- `tests/unit/diagnosticsPolicy.test.ts` — per-database collectors merge and strict promotion.
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
npm run test:api
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
- a signal checkpoint is missing in the async iterator;
- P2 evidence depends on modern conversion lifecycle or merge spool/index/lineage behavior;
- a native outcome vector is host/compiler-dependent, `nodeAbi` is not the Node module ABI, a failed/malformed probe retains a module, or a supported hash does not match;
- a source member is followed as a symlink, a hostile `VACUUM INTO` path is interpolated unsafely, extraction omits URI immutable/default-safe-integer setup, or generated private SQLite artifacts survive cleanup.

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
- `docs/cdb-to-json-cli-refactor/spec.md` — tactical package (revision 11; Revision-11 targeted adversarial closure is normative).
- `docs/cdb-to-json-cli-refactor/phase-0-contract-fixtures.md` — Phase 0 detail.
- `docs/cdb-to-json-cli-refactor/phase-1-reader-compatibility.md` — Phase 1 detail.
- `docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md` — limits, severity, exit precedence.
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md` — D1–D8 decisions.

## Revision-11 targeted checkpoint corrections

The four residual B re-verification blockers are closed only by the following bounded edits; these do not authorize implementation until the named gates pass:

1. **Source acquisition:** `sourceHandle` owns a held input-directory descriptor, safe parent traversal (`openat2` no-symlink resolution or descriptor-relative `openat`), and held `O_NOFOLLOW|O_RDONLY|O_CLOEXEC` member descriptors for `main`, `-wal`, and `-shm`. `lstat` is an observation only; fstat identity/size/mode verification and copy/hash-from-descriptor are mandatory. `tests/reader/sourceMemberSwap.test.ts` injects deterministic swaps for all three members and proves no replacement bytes are read.
2. **Source schema:** Phase 0 schemas and Phase 4 source tasks use required `text.sections` plus `text.sourceSpans`; every slice requires copied `text`, `start`, `end`, `kind`, and `basis: "normalized"`. `begin`/`end`-only and root `text.spans` shapes are rejected through item and aggregate `$ref` validation. The source schema removes `identity.databaseSha256`; only `simulatorSource.database.sha256` is physical and is removed with `sourceRevisionId` by `canonicalDataProjection`.
3. **Snapshot budget:** `maxSnapshotBytes` is an aggregate snapshot/materialization counter, not just the source-bundle pre-copy estimate. Every copy/write chunk reserves before writing and reconciles actual growth for copied members, materialized main, and generated private SQLite files. The named staging test covers growth after stat, materialized/generated-private overflow, and cleanup; `maxStagingBytes` covers each physical file once plus the remaining private state.
4. **Publication rollback:** P3's no-continue multi-output path uses a descriptor-relative commit journal, holds every reservation, and reverse-rolls back between-final failures. No-force rollback removes only new finals; force rollback restores byte-identical backups. `tests/cli/commitSetRollback.test.ts` covers every failure position and rerun; `commitSetRecovery.test.ts` covers rollback failure with retained recovery state and exit 6. `--continue-on-error` split-database remains per-database atomic by explicit exception.

The focused Revision-11 commands are:

```bash
npx vitest run tests/reader/sourceMemberSwap.test.ts tests/reader/stagingSnapshotBudget.test.ts
npx vitest run tests/conformance/schemaValidation.test.ts tests/source/translatorContract.test.ts
npx vitest run tests/cli/commitSetRollback.test.ts tests/cli/commitSetRecovery.test.ts
npm run build
git diff --check
```

Stop if any correction is described only as a future intention, if path copying follows lstat, if source spans omit copied text, if `maxSnapshotBytes` is checked only before copying, or if a late final publication can leave an undocumented partial set.

## Revision-12 enforcement correction

The Revision-11 text above is superseded by the ordered tasks in
`phase-r11-enforcement-and-gates.md`. Before P3/P4 dispatch, P1/P2 must additionally
prove: absolute and relative held-anchor traversal with no post-anchor `AT_FDCWD`,
post-copy digest/fstat from the same member descriptors, parent-component and
same-inode mutation vectors, a real SQLite materialization quota admitted before
writable SQLite work (see `materialization-quota.md`), and the hardened legacy
output boundary with no path or cross-device fallback. Injected budget events do
not replace the real materialization-quota gate. `docs/implementation/current.md`
completion prose is non-evidence until `scripts/phase-dispatch-check.mjs` records
all blocking P1/P2 commands and named test files.