# Phase 0 — Contract, toolchain, and fixtures

## Outcome

Establish the TypeScript/ESM build and the stable data contracts before changing extraction behavior. Create small generated SQLite fixtures and golden vectors that exercise every field decoder and every major card frame named by the root spec.

## Ordered tasks

### 0.1 Add the build/test skeleton

Modify `package.json` and `package-lock.json`; add `tsconfig.json` and the Vitest configuration. Set Node 22 as the supported runtime, strict TypeScript, native ESM, and `dist/` output. Declare every gate target before any gate runs: `build`, `build:native`, `test:fixtures`, `test:unit`, `test:reader`, `test:compat`, `test:cli`, `test:normalization`, `test:source`, `test:streaming`, `test:conformance`, `test` (build plus full Vitest), and `package:check`. In particular, `test:conformance` MUST be an actual package script pointing at `tests/conformance`; Phase 0 may not invoke an undeclared target. Keep `better-sqlite3` as the runtime SQLite dependency and add only the test/schema-validation dependencies required by the accepted root spec.

The native build is reproducible rather than an implicit local tool: pin `node-gyp` to `11.2.0` in `package-lock.json`, add `scripts/build-native.mjs`, and define the exact scripts `"build:native": "node scripts/build-native.mjs"` and `"build": "npm run build:native && tsc -p tsconfig.json"`. On supported Linux/Node 22, the script MUST build `native/secure-destination` from its checked-in `binding.gyp` and sources, verify the expected N-API module, and copy it to the exact packaged path `dist/native/secure_destination.node` with a generated `dist/native/capability.json` containing platform, architecture, Node ABI, and module SHA-256. `package:check` MUST run `npm pack --dry-run` followed by a manifest/module presence check; on a release host it fails if the exact native artifact is unavailable. On unsupported hosts the build script may produce an explicit unsupported-capability manifest so stdout-only tests can run, but it MUST NOT fabricate a native module or enable path-based output fallback.

Keep the old `npm test` entry point green by making the new `test` script build before running Vitest and by retaining a compatibility test that imports `app/index.js`.

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`.

### 0.2 Freeze shared contract types, integer encoding, limits, and diagnostics

Create the initial type modules under `src/` for `RawCardRows`, `CardRecord`, `CardSourceDocument`, `Diagnostic`, conversion options/reports, registry versions, `limits.v1`, and profile/schema identifiers. Raw SQLite INTEGER fields are decimal strings under `integerEncoding: "signed-int64-decimal"`; the type boundary must not expose a JavaScript `number` for source integers. Define `AbortSignal` ownership in conversion options.

Define diagnostic codes in `src/diagnostics/codes.ts` and a collector that is pure and injectable; include `RESOURCE_LIMIT_EXCEEDED`, `INTEGER_OUT_OF_RANGE`, `CANCELLED`, `LEGACY_INTEGER_UNREPRESENTABLE`, `LEGACY_BASENAME_COLLISION`, `INVALID_TEXT_VALUE`, `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING`, `SOURCE_MUTATED_DURING_READ`, `CDB_OPEN_FAILED`, `CONFLICTING_CARD_KIND_FLAGS`, `CONFLICTING_SUBTYPE_FLAGS`, and `CONFLICTING_PROGRESSION_FLAGS`. `UNSUPPORTED_DATABASE_ENCODING` is an unconditional input error (exit 4), emitted before text selection for any encoding other than exactly SQLite `UTF-8`. Encode the severity/promotion matrix and terminal exit precedence from `limits-and-diagnostics.md`. No module in `src/` may import `console`, terminal state, or a process-global logger.

Create the directory skeleton from the root spec, but implement only types/contracts in this phase. Keep property names and enum casing exactly as the root spec.

**Files:** `src/cdb/rawTypes.ts`, `src/diagnostics/codes.ts`, `src/diagnostics/collector.ts`, `src/application/types.ts` (or the bounded equivalent chosen by implementation), `src/index.ts`.

### 0.3 Define schemas and schema validation

Add exactly these item schemas: `schemas/cdb.raw.v1.schema.json`, `schemas/cdb.card.v2.schema.json`, and `schemas/ygo.card-source.v1.schema.json`; and exactly these aggregate schemas: `schemas/cdb.card-array.v2.schema.json` (identifier `cdb.card-array/2`) and `schemas/ygo.card-source-array.v1.schema.json` (identifier `ygo.card-source-array/1`). These filenames and identifiers are frozen; no equivalent or alternate names are permitted. The raw schema must preserve source columns and the source envelope; card/source schemas must require the stable fields and permit diagnostic/unknown-bit extensions without making them executable semantics. Aggregate schemas MUST be `type: array` with `items` referencing the corresponding frozen item schema.

Add schema validation helpers used by tests and the future `schema` command. Add golden minimal records for all three identifiers and assert they validate. The source schema must require `text.raw`, `text.normalized`, `text.normalizationVersion: "text-normalization/1"`, `text.spansBasis: "normalized"`, and `text.offsetEncoding: "utf-16-code-units"`; each span is inclusive/exclusive UTF-16 units into `text.normalized`, never an implicit offset into raw text. The card schema must represent nullable singleton primary fields plus complete `monsterTypes`/`attributes` arrays, raw masks, and conflict diagnostics.

**Files:** `schemas/*.schema.json`, `tests/conformance/schemaValidation.test.ts`, `tests/fixtures/expected/minimal-*.json`.

### 0.4 Build generated fixture helpers and vectors

Create a temporary-directory SQLite builder that creates only the standard `datas` and `texts` tables, inserts rows with explicit values, and can intentionally omit a partner row, duplicate an ID, add unknown bits, malformed packed values, signed-64 boundary/beyond-safe integers, sentinels, oversized text, over-limit row counts, output-limit cases, and extra tables. It must not depend on the checked-in full database for unit tests.

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
2. Freeze the incomplete join shape before mapper work. Golden `datas`-only and `texts`-only records must validate: present ID identity, null/empty data-derived or text-derived fields as defined in the tactical spec, nullable typed surfaces, `rawRows` partner nullability, and `MISSING_TEXT_ROW`/`MISSING_DATA_ROW`. Add a schema assertion that no placeholder name, card kind, stat, or text is required for an orphan.
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

The gate must fail if aggregate arrays are validated only as item records, if orphan fixtures require invented values, if insertion order changes ordinals, if UTF-16 inputs pass the UTF-8 contract, or if locale/namespace changes leave `conversionOptionsHash` unchanged.

## Revision-5 senior remediation additions

Freeze the decisions from `senior-remediation-spec.md` as executable contracts before implementation:

1. Extend `LimitsV1` and the CLI fixture contract with `maxSnapshotBytes` (default `4294967296`) and the reject-only relations to `maxStagingBytes`/`maxSpoolBytes`. Add the exact CLI flag `--max-snapshot-bytes`, include it in pre-open option validation and semantic-hash vectors, and add `INVALID_LIMIT_RELATION`, `CDB_OPEN_FAILED`, `INVALID_TEXT_ENCODING`, `UNSUPPORTED_DATABASE_ENCODING`, `OUTPUT_DIRECTORY_EXISTS`, and `UNSAFE_DESTINATION_FILESYSTEM` to the diagnostic codes and exit-path fixtures.
2. Declare the async-only `iterateRawCards(databasePath, options?): AsyncIterableIterator<RawCardRows>` API, its `AbortSignal` ownership, scheduler checkpoint behavior, and a type-level assertion that no synchronous iterator is exported.
3. Add the native adapter capability contract at `src/destinations/secureDestination.ts` and `native/secure-destination/{binding.gyp,src/secure_destination.cc,src/secure_destination.h}`. Add `scripts/build-native.mjs`, pin `node-gyp` in `package-lock.json`, and make `build:native` invoke the script before `tsc`. The script must build the checked-in target deterministically on Linux Node 22+, verify/copy `secure_destination.node` to `dist/native/secure_destination.node`, and write a capability manifest with platform/architecture/ABI/module hash; unsupported hosts get an explicit unsupported manifest and no module. The contract must name Linux Node 22+, `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow opens, and descriptor-relative `openat`/`linkat`/`renameat2`; unsupported capability is a stable output failure with no path fallback. `package:check` MUST fail clearly on a release host lacking the required Linux module, while stdout-only tests remain runnable on hosts that cannot build the addon.
4. Add fixture builders for a valid committed-WAL bundle, main-only bundle, sidecar mutation, materialization failure, physical insertion reorder, invalid UTF-8 bytes, UTF-16 encoding, extra-table/WAL staging overflow, fresh/existing split roots, parent swap, and all limit-relation boundaries. Keep fixture assertions independent of implementation helpers where possible.
5. Add semantic-hash toggle vectors that change physical bundle member bytes/presence, canonical raw facts, ordinals, locale, source namespace, registry hashes, normalization version, and every limit independently; pair them with presentation toggles that must not change hashes. Physical reorder must change bundle hash/source revision while preserving canonical rows, ordinals, and merge winners.

### Revision-5 phase-0 gate

```bash
npm ci
npm run build
npm run test:fixtures
npm run test:unit
npm run test:conformance
```

`test:conformance` is declared by Phase 0.1 as `vitest run tests/conformance`; the gate is not allowed to rely on an implicit or missing npm target. The gate blocks Phase 1 if limits are clamped, native capability is silently downgraded, a WAL fixture requires a live-source fallback, invalid text can reach a profile, `UNSUPPORTED_DATABASE_ENCODING` is absent or misclassified, an aggregate schema uses an unfrozen identifier, or the async API/type contract is absent.
