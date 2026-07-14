# Phase P6 — Hardening, migration, package, and release gate (delivery Phase 5)

## Outcome

Make the refactor installable and supportable as 2.0.0. Document migration and profile/registry contracts, verify package contents and deterministic output on the supported Node matrix, and retain a rollback path to the v1-compatible default export until 3.0.

## Ordered tasks

### 5.1 Finish public exports and package metadata

Update `package.json` to version 2.0.0 when release is approved, set `main` to `dist/index.js` (never the source-tree `app/index.js`), set `bin.cdb-to-json` to `dist/cli.js`, expose typed modern APIs from `.`, retain the deprecated default legacy export, expose `./schemas/*`, and include only `dist`, `schemas`, README, and license in the package. `app/index.js` remains a source-tree ESM shim used by compatibility tests and is explicitly not a packed-package API. Add a shebang to the CLI entrypoint and verify executable permissions after `npm pack`.

The packed-artifact test must import the root default legacy export and named `convert()`, `iterateRawCards()`, `normalizeCard()`, and `toSourceDocument()` from a clean temporary install, run the documented v1-shaped call twice against an existing output file, and assert that legacy replacement is atomic and a failed second conversion preserves the prior final. It must assert that `require`/import resolution does not point at a missing `app/index.js`, and that the declared `main`, `exports`, `bin`, and `files` metadata agree with the tarball contents. The exact evidence command is `npm run package:check && npx vitest run tests/package/packageContents.test.ts tests/package/packedCli.test.ts`.

**Files:** `package.json`, `package-lock.json`, `src/index.ts`, `src/cli.ts`, `README.md`.

### 5.2 Write migration and operational documentation

Rewrite `README.md` around CLI-first workflows and add `docs/output-profiles.md`, `docs/registry-versioning.md`, `docs/limits-and-diagnostics.md`, and `docs/migration-v1-to-v2.md`. Document the exact profile/format/split/merge/output matrix, logical record units, raw-envelope versus normalized-record JSONL behavior, deterministic split filenames, pre-open rejection rules, and no-continue/continue atomicity. Also document the exact legacy bridge behavior/limits, including that a non-null legacy `outputDir` authorizes replacement of old-named files, modern versus legacy discovery/name policies, CLI options and the diagnostic severity/exit-precedence table, stdout/stderr policy, signed-64 decimal raw integer representation, raw/card/source schemas, deterministic hash input/exclusions, registry citation/versioning, unknown-bit and null-on-conflict handling, merge spool/index aggregate limits and precedence/lineage, exclusive destination reservations/no-clobber versus force commits, symlink/input collision rules, source main/WAL/SHM snapshot verification, normalized text/span units, cancellation commit-barrier cleanup, security boundaries, and how to migrate from `app/index.js` to named `convert()`.

Include examples for one-file stdout, recursive directory output, JSONL piping, `inspect`, `validate --strict`, `schema`, and explicit `--merge --on-conflict last`. State that generated data inherits source-data obligations and that the package does not bundle card databases.

**Files:** `README.md`, `docs/output-profiles.md`, `docs/registry-versioning.md`, `docs/limits-and-diagnostics.md`, `docs/migration-v1-to-v2.md`.

### 5.3 Add CI and packaging checks

Add CI configuration under `.github/workflows/` for the supported Node/OS matrix, `npm ci`, the pinned `node-gyp` build via `npm run build:native`, TypeScript build, focused/full tests, package dry-run, and CLI smoke execution from the packed artifact. The release packaging job is Linux Node 22+ only for secure file output and MUST verify the exact `dist/native/secure_destination.node` plus capability-manifest checksum; a non-Linux job runs stdout-only tests and asserts `UNSAFE_DESTINATION_FILESYSTEM` rather than pretending to package secure output. Add a package-content test that fails if source tests, fixtures, `.pi-conductor`, `app/index.js`, or undeclared files enter the tarball, and a clean packed-artifact test that verifies `main: dist/index.js`, root default legacy import, named modern import, the exact item and aggregate schema filenames, the native loader/module, and executable `bin` resolution.

**Files:** `.github/workflows/ci.yml`, `tests/package/packageContents.test.ts`, `tests/package/packedCli.test.ts`.

### 5.4 Benchmark without making speculative performance claims

Create `benchmarks/convert-full-cdb.ts` and the exact `npm run benchmark` interface. Run:

```bash
npm run benchmark -- --full-cdb __tests__/input_dir/cards.cdb \
  --high-cardinality benchmarks/fixtures/high-cardinality.cdb \
  --profile raw --format json \
  --report benchmarks/reports/convert-full-cdb.json
```

The command takes both named fixture arguments and writes JSON with one result per
fixture. Each result must contain `elapsedMs`, `peakHeapBytes`, `outputBytes`,
`profile`, `format`, `nodeVersion`, and `fixtureIdentity`; the report includes the
command/environment metadata and does not apply an uncalibrated threshold. Keep the
root spec's provisional under-10-second/under-256 MiB values as measured targets
until the supported hardware/CI baseline is recorded; do not fail release on a
machine-specific number.

**Files:** `benchmarks/convert-full-cdb.ts`, `benchmarks/fixtures/high-cardinality.cdb`, `benchmarks/reports/convert-full-cdb.json`, `package.json` benchmark script, `docs/performance.md` if measurements are recorded.

### 5.5 Execute final conformance and rollback rehearsal

Run all focused gates, then the full release gate. Rehearse rollback by verifying a consumer can still import the default legacy export from the packed root and that a 1.x-shaped raw conversion is available through `--profile raw --split database`. Include dotted/non-final legacy filenames and safe/unsafe integer cases. Confirm no schema identifier, registry version, collision policy, or source hash changes during release packaging.

**Files:** `tests/release/releaseGate.test.ts`, `tests/release/rollbackCompatibility.test.ts`, `docs/migration-v1-to-v2.md`.

## Gate and commands

```bash
npm ci
npm run build
npm run test:fixtures
npm run test:reader
npm run test:compat
npm run test:cli
npm run test:normalization
npm run test:source
npm run test:streaming
npm run test:conformance
npm test
npm run package:check
```

Then run the packed-artifact smoke test from the generated tarball and record benchmark output. Release is blocked if any command fails, if `npm pack --dry-run` includes undeclared files, if stdout/stderr separation regresses, if source revisions are nondeterministic, or if the legacy bridge no longer passes.

## Stop/rollback conditions

- Do not bump to 2.0.0 until every earlier phase gate and packed CLI test passes.
- If native SQLite installation fails on a supported platform, block that platform or fix packaging; do not replace the reader with a weaker runtime silently.
- If the output matrix, reservation protocol, source snapshot/span contract, or conflict policy is ambiguous in implementation, keep the prior version and revise the tactical package before coding further.
- If a release discovers a schema/registry/hash incompatibility, keep the prior version and publish a migration decision before changing artifacts.
- Rollback consists of restoring the prior package version/CLI artifact while retaining the v1-compatible bridge; generated outputs are not silently rewritten.

## Dependencies and scope

Depends on Phases 0–4. This phase adds no new card semantics. It is the release/documentation/operational boundary only.

## Revision-4 release additions

Declare the supported OS/filesystem matrix and the exact no-force publication primitive (exclusive link/publication where supported, otherwise reject the filesystem with a stable output diagnostic; never silently fall back to clobbering rename). Run packed-artifact tests for aggregate schemas, `--max-staging-bytes`, valid WAL snapshot conversion, UTF-16 rejection, invalid-ID rejection, and non-atomic stdout failure semantics.

The release gate must include a many-output no-continue run that exceeds aggregate staging, a `--continue-on-error` run with a pre-existing final on the failed database, and a merged late collision under `on-conflict=error` proving exit 5/no final rather than exit 7. The packed migration docs must state the supported fixed-column raw boundary, orphan null shape, canonical numeric ordering/ordinals, UTF-8-only policy, copied-bundle/WAL-materialization/main-only extraction lifecycle, shared semantic hash options, and stdout atomicity distinction.

## Revision-5 secure publication and snapshot release additions

1. Declare the hardening support matrix in `README.md`, `docs/migration-v1-to-v2.md`, and package metadata: secure file/split output is Node 22+ Linux only when the native capability probe passes `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow traversal, descriptor-relative named `openat(O_CREAT|O_EXCL|O_NOFOLLOW)` temp/lock creation, and separate `renameat2` no-replace/force operations. This is the selected equivalent under the senior D5 decision; `O_TMPFILE`, `linkat`, and path-based lock/rename helpers are not used. Stdout remains cross-platform; unsupported capability returns `UNSAFE_DESTINATION_FILESYSTEM` before input opening. The release must not advertise a path-based fallback.
2. Build and test `native/secure-destination/` in CI before TypeScript tests. `npm run build:native` MUST use the pinned `node-gyp` toolchain and checked-in `binding.gyp`, produce exactly `dist/native/secure_destination.node`, and write a capability-manifest checksum consumed by `src/destinations/nativeLoader.ts`. The package `files` allowlist MUST include `dist` so the loader, manifest, and native module ship together; the package check fails on a release host if any is absent. Clean-install tests must verify the same capability and failure mode as the source tree. `npm run build` must include the native build prerequisite, while stdout-only tests remain runnable on unsupported hosts.
3. Add release cases for `tests/reader/walMaterialization.test.ts`, `tests/reader/textByteFidelity.test.ts`, `tests/reader/stagingSnapshotBudget.test.ts`, `tests/cli/freshSplitRoot.test.ts`, `tests/cli/secureDestinationRace.test.ts`, `tests/cli/limitRelations.test.ts`, and `tests/api/iterateRawCards.test.ts`. Verify WAL-only data, no source mutation/sidecars, strict UTF-8, pre-copy budget failure, fresh-root rejection, parent-swap resistance, reject-only relations, and async cancellation from the packed artifact.
4. Verify rollback by importing the v1-shaped default through `app/index.js` and the packed root while modern secure-destination failures leave prior finals untouched. Do not weaken the native requirement to make a non-Linux package test pass; route stdout-only compatibility tests separately.
5. Release-gate the Revision-11 closures: source members are acquired through held no-symlink descriptors and fstat-verified before copy/hash; source spans use required `text.sections`/`text.sourceSpans` slices with copied text/start/end/kind/basis and no `identity.databaseSha256`; `maxSnapshotBytes` is enforced chunk-by-chunk through source growth and generated-private materialization; and no-continue multi-output publication uses a journaled commit set with reverse rollback/force-backup restoration. Run `tests/reader/sourceMemberSwap.test.ts`, `tests/cli/commitSetRollback.test.ts`, and `tests/cli/commitSetRecovery.test.ts` from the packed artifact or declared release-equivalent harness.

### Revision-5 release gate commands

```bash
npm ci
npm run build
npm run test:fixtures
npm run test:reader
npm run test:compat
npm run test:cli
npm run test:normalization
npm run test:source
npm run test:streaming
npm run test:conformance
npm test
npm run package:check
```

The gate is blocked if a split root can adopt an existing directory, a source is read live after WAL capture, source acquisition copies through a path after lstat or follows a member swap, native capability failure falls back to string paths, a physical reorder leaves `sourceRevisionId` unchanged or introduces `identity.databaseSha256`, a source span omits copied text/start/end/kind/basis, `maxSnapshotBytes` is enforced only by its pre-copy estimate, a between-final failure leaves an undocumented partial set, or any pre-commit abort leaves snapshot/materialized/output artifacts.

Revision-12 release rehearsal additionally runs the materialization-quota,
source-parent/same-inode, legacy-publication-security, and orphan-journal tests
from `phase-r11-enforcement-and-gates.md`. The packed artifact must use the same
native capability matrix for legacy and modern output, retain identity-guarded
recovery state after interruption, and refuse a stale dispatch evidence record.