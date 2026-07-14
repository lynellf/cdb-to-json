# Phase P1 — Contract, toolchain, and fixtures (delivery Phase 0)

## Outcome

Establish the TypeScript/ESM build and the stable data contracts before changing extraction behavior. Create small generated SQLite fixtures and golden vectors that exercise every field decoder and every major card frame named by the root spec.

## Ordered tasks

### 0.1 Add the build/test skeleton

Modify `package.json` and `package-lock.json`; add `tsconfig.json` and the Vitest configuration. Set Node 22 as the supported runtime, strict TypeScript, native ESM, and `dist/` output. Declare every gate target before any gate runs: `build`, `build:native`, `test:fixtures`, `test:unit`, `test:reader`, `test:compat`, `test:api`, `test:cli`, `test:normalization`, `test:source`, `test:streaming`, `test:conformance`, `test` (build plus full Vitest), and `package:check`. For the P1/P2 checkpoint, `test:cli` is explicitly limited to the named pre-open/exit/native-outcome files; P3 expands that same script to modern CLI files. In particular, `test:conformance` MUST be an actual package script pointing at `tests/conformance`; Phase 0 may not invoke an undeclared target. Keep `better-sqlite3` as the runtime SQLite dependency and add only the test/schema-validation dependencies required by the accepted root spec.

The native build is reproducible rather than an implicit local tool: pin `node-gyp` to `11.2.0` in `package-lock.json`, add an import-safe typed `runNativeBuild(rootDir, host, build, probe)` to `scripts/build-native.mjs`, and define the exact scripts `"build:native": "node scripts/build-native.mjs"` and `"build": "npm run build:native && tsc -p tsconfig.json"`. The executable wrapper is the only process-exit boundary. On supported Linux/Node 22, the injected/real build must build `native/secure-destination` from its checked-in `binding.gyp` and sources, verify the expected N-API module, and copy it to the exact packaged path `dist/native/secure_destination.node` with a generated canonical manifest containing platform, architecture, Node module ABI, N-API version, and module SHA-256. `package:check` MUST run `npm pack --dry-run` followed by a manifest/module presence and hash check; on a release host it fails if the exact native artifact is unavailable. Unsupported-host, post-probe unsupported, failed-probe, and malformed-probe outcomes must remove any stale module before writing an explicit unsupported manifest, and must not fabricate a module or enable path-based output fallback.

Keep the old `npm test` entry point green by making the new `test` script build before running Vitest and by retaining a compatibility test that imports `app/index.js`.

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`.

### 0.2 Freeze shared contract types, integer encoding, limits, and diagnostics

Create the initial type modules under `src/` for `RawCardRows`, `CardRecord`, `CardSourceDocument`, `Diagnostic`, conversion options/reports, registry versions, `limits.v1`, and profile/schema identifiers. Raw SQLite INTEGER fields are decimal strings under `integerEncoding: "signed-int64-decimal"`; the type boundary must not expose a JavaScript `number` for source integers. Define `AbortSignal` ownership in conversion options.

Define diagnostic codes in `src/diagnostics/codes.ts` and a collector that is pure and injectable; include `RESOURCE_LIMIT_EXCEEDED`, `INTEGER_OUT_OF_RANGE`, `CANCELLED`, `LEGACY_INTEGER_UNREPRESENTABLE`, `LEGACY_BASENAME_COLLISION`, `INVALID_TEXT_VALUE`, `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING`, `SOURCE_MUTATED_DURING_READ`, `CDB_OPEN_FAILED`, `CONFLICTING_CARD_KIND_FLAGS`, `CONFLICTING_SUBTYPE_FLAGS`, and `CONFLICTING_PROGRESSION_FLAGS`. `UNSUPPORTED_DATABASE_ENCODING` is an unconditional input error (exit 4), emitted before text selection for any encoding other than exactly SQLite `UTF-8`. Encode the severity/promotion matrix and the explicit pairwise terminal predicate matrix (including output-over-input/collision, input-over-collision, collision-over-partial, and option/no-input cases) from `limits-and-diagnostics.md`. No module in `src/` may import `console`, terminal state, or a process-global logger.

Create the directory skeleton from the root spec, but implement only types/contracts in this phase. Keep property names and enum casing exactly as the root spec.

**Files:** `src/cdb/rawTypes.ts`, `src/diagnostics/codes.ts`, `src/diagnostics/collector.ts`, `src/application/types.ts` (or the bounded equivalent chosen by implementation), `src/index.ts`.

### 0.3 Define schemas and schema validation

Add exactly these item schemas: `schemas/cdb.raw.v1.schema.json`, `schemas/cdb.card.v2.schema.json`, and `schemas/ygo.card-source.v1.schema.json`; and exactly these aggregate schemas: `schemas/cdb.card-array.v2.schema.json` (identifier `cdb.card-array/2`) and `schemas/ygo.card-source-array.v1.schema.json` (identifier `ygo.card-source-array/1`). These filenames and identifiers are frozen; no equivalent or alternate names are permitted. The raw schema must preserve source columns and the source envelope; card/source schemas must require the stable fields and permit diagnostic/unknown-bit extensions without making them executable semantics. Aggregate schemas MUST be `type: array` with `items` referencing the corresponding frozen item schema.

Add schema validation helpers used by tests and the future `schema` command. Add golden minimal records for all three identifiers and assert they validate. The source schema must require `text.raw`, `text.normalized`, `text.normalizationVersion: "text-normalization/1"`, `text.spansBasis: "normalized"`, and `text.offsetEncoding: "utf-16-code-units"`; serialize spans only as the frozen `text.sections` plus `text.sourceSpans` layout. Each `TextSlice` requires copied `text`, inclusive `start`, exclusive `end`, `kind`, and `basis: "normalized"`; offsets are UTF-16 units into `text.normalized`, never implicit offsets into raw text. `text.spans`, `begin`, or begin/end-only spans are rejected, and `additionalProperties: false`/required-field mutations must fail through both the item schema and the `$ref`-linked aggregate schema. The value `utf-16-code-units` is valid only for `text.offsetEncoding`; it is not a valid `text.spansBasis` value. The source schema/goldens must not place `databaseSha256` under `identity`; the sole source physical hash is `simulatorSource.database.sha256`, which is removed by `canonicalDataProjection`. The card schema must represent nullable singleton primary fields plus complete `monsterTypes`/`attributes` arrays, raw masks, and conflict diagnostics.

**Files:** `schemas/*.schema.json`, `tests/conformance/schemaValidation.test.ts`, `tests/fixtures/expected/minimal-*.json`.

### 0.4 Build generated fixture helpers and vectors

Create a temporary-directory SQLite builder that creates only the standard `datas` and `texts` tables, inserts rows with explicit values, and can intentionally omit a partner row, duplicate an ID, add unknown bits, malformed packed values, signed-64 boundary/beyond-safe integers, sentinels, oversized text, over-limit row counts, output-limit cases, and extra tables. Add a large-extra-table fixture: metadata collection must probe at most `maxRowsPerTable + 1` value-free rows, emit `RESOURCE_LIMIT_EXCEEDED` with `MAX_EXTRA_TABLE_ROWS_EXCEEDED` on the sentinel, select no extra-table cells, and clean up. It must not depend on the checked-in full database for unit tests.

Add independent hand-authored expected vectors for the integer/limit envelope. Add a registry-source placeholder that records the required URL/commit/checksum fields; Phase 3 cannot proceed until a maintainer supplies the authoritative revision.

Create fixed cases for Normal, Effect, Ritual, Fusion, Synchro, Xyz, Pendulum, Link, Token/Skill/special, all listed Spell/Trap subtypes, unknown masks, missing partners, packed setcode errors, and cross-database collisions. Add independent zero/singleton/multi-bit/conflicting card-kind, subtype, monster-type, attribute, and progression cases proving null-on-conflict, complete decoded arrays, raw-value retention, and stable diagnostics. Add CRLF, CR, combining-character, astral-Unicode, invalid-text-type, and oversized-text cases for the source/span contract. Keep a deterministic list of 64 fixture IDs for the Phase 4 pilot.

**Files:** `tests/fixtures/buildCdbFixture.ts`, `tests/fixtures/cases.ts`, `tests/fixtures/generated/README.md`, `tests/fixtures/expected/*.json`, `tests/fixtures/pilot-ids.json`, `tests/fixtures/fixture.test.ts`.

## Gate and commands

Run after `npm ci`:

```bash
npm run build
npm run test:fixtures
npm run test:unit
```

The gate passes only when every generated fixture is reproducible, all three schemas validate their golden records, signed-64 decimal raw boundaries and limit diagnostics are stable, the 64 pilot IDs are stable, source spans validate against normalized text under explicit UTF-16 units, conflict vectors validate the nullable/array shape, and no contract test imports SQLite implementation details. Preserve the existing full CDB as a later integration input; do not replace or regenerate its 9 MB checked-in output in this phase.

## Stop/rollback conditions

- Stop if TypeScript output cannot be imported by both the CLI entrypoint and `app/index.js` without a bundler.
- Stop if a fixture requires undocumented semantic assumptions; represent it as an unknown/raw case instead.
- Revert only the new build/contracts/fixture files if the gate fails; do not modify `app/` behavior until Phase 1.

## Dependencies and scope

None. This phase touches package/tooling, schemas, types, and tests but not the reader or CLI behavior. It is medium-sized and must land as one contract checkpoint before Phase 1.

## Revision-4 additions required by the adversarial review

Extend this phase's contract checkpoint with the following executable artifacts:

1. Add `limits.v1.maxStagingBytes` (default `4294967296`) to public types, CLI contract fixtures, diagnostic envelopes, and semantic-hash vectors. Freeze aggregate schemas at `schemas/cdb.card-array.v2.schema.json` (`cdb.card-array/2`) and `schemas/ygo.card-source-array.v1.schema.json` (`ygo.card-source-array/1`), and test `schema card-array`/`schema source-array` selection separately from the frozen item schemas.
2. Freeze the incomplete join shape before mapper work. Golden `datas`-only and `texts`-only records must validate the exact R4.2 state: present ID identity; `cardKind: "UNKNOWN"`; `traits: []`; null typed card surfaces; required nullable text fields; exact present text/name values; `rawRows` partner nullability; and `MISSING_TEXT_ROW`/`MISSING_DATA_ROW`. The source item schema additionally requires `printed.name`, `printed.cardKind`, every printed `desc`/`str1`–`str16` field, nullable `monster`/`spell`/`trap` surfaces, and `simulatorSource.rawRows.datas`/`texts` partner keys. Card/source schemas must require these nullable/empty states, and conformance tests must reject the old omitted-field shape at both item and aggregate levels. Aggregate schemas use `$ref` to the frozen item schemas rather than duplicating their shape. No placeholder name, type, stat, effect, or executable meaning is permitted.
3. Build ID vectors for `-2`, `0`, `2`, `10`, signed-int64 minimum/maximum, NULL, numeric-looking TEXT, REAL, and BLOB. The valid vectors prove numeric ordering and canonical zero-based ordinals independent of insertion order; invalid vectors assert `INVALID_CARD_ID` before any join.
4. Build SQLite UTF-8 and UTF-16 databases, wrong-storage-class text cells, valid oversized TEXT, and under-limit non-ASCII/astral text. The expected precedence is wrong type first, then resource limit without selecting an oversized value, then invalid UTF-8 after retrieval.
5. Add a generated stable-WAL fixture with main/WAL/SHM members, a main-only fixture, and acquisition-time sidecar mutation hooks. Add independent semantic hash vectors toggling locale, source namespace, all limits (including staging), registry hashes, normalization version, and every excluded presentation value.

Phase-0 gate additions:

```bash
npm run build
npm run test:fixtures
npm run test:unit
npm run test:conformance
```

The gate must fail if aggregate arrays are validated only as item records, if orphan fixtures omit a required R4.2 nullable/empty field or require an invented value, if insertion order changes ordinals, if UTF-16 inputs pass the UTF-8 contract, if locale/namespace changes leave `conversionOptionsHash` unchanged, or if an unsupported capability manifest coexists with `dist/native/secure_destination.node` after a post-build probe. The `P1-AC3` limit vector also runs `npx vitest run tests/cli/limitRelations.test.ts` and proves reject-only relation diagnostics before input access.

## Revision-5 senior remediation additions

Freeze the decisions from `senior-remediation-spec.md` as executable contracts before implementation:

1. Extend `LimitsV1` and the CLI fixture contract with `maxSnapshotBytes` (default `4294967296`) as the aggregate private snapshot/materialization budget, not only a source-bundle pre-copy cap. Its counter covers copied main/WAL/SHM members, materialized main, and generated private SQLite files/temp siblings; chunk writes reserve before writing and reconcile actual growth. Add the exact CLI flag `--max-snapshot-bytes`, include it in pre-open option validation and semantic-hash vectors, and add `INVALID_LIMIT_RELATION`, `CDB_OPEN_FAILED`, `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING`, `OUTPUT_DIRECTORY_EXISTS`, and `UNSAFE_DESTINATION_FILESYSTEM` to the diagnostic codes and exit-path fixtures.
2. Declare the async-only `iterateRawCards(databasePath, options?): AsyncIterableIterator<RawCardRows>` API, its `AbortSignal` ownership, scheduler checkpoint behavior, and a type-level assertion that no synchronous iterator is exported.
3. Add the native adapter capability contract at `src/destinations/secureDestination.ts` and `native/secure-destination/{binding.gyp,src/secure_destination.cc,src/secure_destination.h}`. Add import-safe `runNativeBuild(rootDir, host, build, probe)` in `scripts/build-native.mjs`, pin `node-gyp` in `package-lock.json`, and make `build:native` invoke only its executable wrapper before `tsc`. The script must build the checked-in target deterministically on Linux Node 22+, verify/copy `secure_destination.node` to `dist/native/secure_destination.node`, and write a canonical manifest with platform/architecture/Node module ABI/module hash. The selected ABI is visible descriptor-relative temps/locks via `openat(O_CREAT|O_EXCL|O_NOFOLLOW)`, no-replace `renameat2(RENAME_NOREPLACE)`, and force `renameat2(flags=0)`; it does not use `O_TMPFILE`, `linkat`, or path-based lock/rename helpers. Unsupported, failed, and malformed probe outcomes remove the module and write an explicit unsupported manifest with no fallback. The contract names Linux Node 22+, `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow opens, descriptor-relative `openat`/`renameat2`; unsupported capability is a stable output failure with no path fallback. `package:check` MUST fail clearly on a release host lacking the required Linux module, while stdout-only tests remain runnable on hosts that cannot build the addon.
4. Add fixture builders for a valid committed-WAL bundle, main-only bundle, sidecar mutation, deterministic lstat-to-open member swaps for main/WAL/SHM, materialization failure, physical insertion reorder, invalid UTF-8 bytes, UTF-16 encoding, source-growth-after-stat, materialized/generated-private snapshot overflow, extra-table/WAL staging overflow, fresh/existing split roots, parent swap, and all limit-relation boundaries. Keep fixture assertions independent of implementation helpers where possible.
5. Add semantic-hash toggle vectors that change physical bundle member bytes/presence, canonical raw facts, ordinals, locale, source namespace, registry hashes, normalization version, and every limit independently; pair them with presentation toggles that must not change hashes. Physical reorder must change bundle hash/source revision while preserving `canonicalDataProjection(record)`, canonical rows, ordinals, and `conversionOptionsHash`; merge-winner invariance is deferred to P3/P4.

### Revision-5 phase-0 gate

```bash
npm ci
npm run build
npm run test:fixtures
npm run test:unit
npm run test:conformance
```

`test:conformance` is declared by Phase 0.1 as `vitest run tests/conformance`; the gate is not allowed to rely on an implicit or missing npm target. The gate blocks Phase 1 if limits are clamped, native capability is silently downgraded, a WAL fixture requires a live-source fallback, invalid text can reach a profile, `UNSUPPORTED_DATABASE_ENCODING` is absent or misclassified, an aggregate schema uses an unfrozen identifier, the source item/aggregate schema or any named source golden fixture accepts `spansBasis: "utf-16-code-units"` instead of the normative `"normalized"`, or the async API/type contract is absent.

## Revision-4 contract closure

The machine-readable gate is `P1-AC1` through `P1-AC4` in `execution-contract.json`. `P1-AC3` includes reject-only `INVALID_LIMIT_RELATION` (exit 2) vectors for `maxSnapshotBytes > maxStagingBytes` and `maxSpoolBytes > maxStagingBytes`, before discovery or input access. `P1-AC4` inspects the selected secure-destination capability: Node 22+ Linux, `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow traversal, descriptor-relative named `openat` temps/locks and separate `renameat2` no-replace/force operations; an unavailable capability is `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) with no path fallback. These criteria prove `INV-001`, `INV-004`, `INV-006`, and `INV-010` as applicable to this phase.

## Revision-6 bounded corrections

The named Phase-0 source-schema/conformance artifacts use one unambiguous pair of constants: every `text.spansBasis` property and source golden fixture is exactly `"normalized"`; every `text.offsetEncoding` property remains exactly `"utf-16-code-units"`. Update both `schemas/ygo.card-source.v1.schema.json` and `schemas/ygo.card-source-array.v1.schema.json`, plus `tests/fixtures/expected/minimal-source.json`, `orphan-datas-only-source.json`, `orphan-texts-only-source.json`, `minimal-source-array.json`, and `tests/conformance/schemaValidation.test.ts`. Conformance must assert the positive constants and reject a source document changed to `spansBasis: "utf-16-code-units"`; do not weaken the UTF-16 offset-unit requirement.

The native stale-artifact regression is deterministic and host-independent. Refactor `scripts/build-native.mjs` into an importable `runNativeBuild` entry with dependency injection for host metadata, module build/copy, and the capability probe while preserving the normal CLI invocation. `tests/cli/nativeCapabilityCleanup.test.ts` supplies a synthetic supported Linux/Node-22 host, writes a fake module to the expected `dist/native/secure_destination.node` path through the injected build step, then returns `supported: false` from the injected post-copy probe. It asserts the post-probe branch—not the pre-build unsupported-host branch—writes `dist/native/capability.json` with `supported: false`, removes the module, and does not retain a path-fallback artifact. A second supported-probe vector asserts the module remains only with a matching SHA-256 manifest. Run this test with `npx vitest run tests/cli/nativeCapabilityCleanup.test.ts` and include it in `test:cli`; no host-capability branch or real compiler is allowed to determine whether the post-probe branch is exercised.

## Revision-12 gate supersession

The Revision-12 remediation phase supersedes the earlier pre-P3 script scope:
`test:cli` now names `exitCodes.test.ts`, `limitRelations.test.ts`, and
`nativeCapabilityCleanup.test.ts`; authoritative normalization/source/streaming
scripts do not use `--passWithNoTests`; and reader/compatibility scripts name the
required source-parent, same-inode, materialization-quota, and legacy-security
vectors. `scripts/phase-dispatch-check.mjs` is the only P3/P4 dispatch authority
and must reject stale status/evidence or a missing named suite.