# Phase 7 — package, documentation, CI, benchmark, and release gate

**Depends on:** Phases 1–6. This phase may not alter profile identifiers,
registry versions, collision policy, or hash inputs without a reviewed spec
change.

## Task 7.1 — Public exports and packed artifact

**Files:** `package.json`, `package-lock.json`, `src/index.ts`, `src/legacy.ts`,
`src/cli.ts`, and preserve the source-tree compatibility shim `app/index.js`;
create `tests/package/packageContents.test.ts`,
`tests/package/packedCli.test.ts`, `tests/compatibility/legacy.test.ts`, and
`tests/release/rollbackCompatibility.test.ts`.

Expose named modern APIs from the package root, retain the deprecated default
legacy export through 2.x, expose `./schemas/*`, keep `main`/types/bin pointed at
`dist`, add CLI shebang/executable permissions, and keep package files limited to
dist, schemas, README, and license. Preserve and re-test `app/index.js` as the
source-tree v1 compatibility bridge; it must not be dropped or repointed while
release exports are changed, and it remains deliberately absent from the packed
API. The packed artifact test must run root legacy import and named `convert()`
from a clean temporary install, verify schema selection, CLI resolution,
secure-module/manifest handling, and legacy atomic replacement/failure
preservation.

## Task 7.2 — Operational/migration documentation

**Files:** `README.md`; create `docs/output-profiles.md`,
`docs/migration-v1-to-v2.md`, and `docs/performance.md` only when measurements
are recorded; extend the registry record created by Phase 5 at
`docs/registry-versioning.md`.

Document the exact profile/format/split/merge/output matrix, raw envelope versus
normalized JSONL units, canonical numeric ordering/ordinals, orphan/null shape,
strict UTF-8 and copied WAL-materialization lifecycle, limits/diagnostics and
exit precedence, stdout non-atomic versus secure private outputs, Linux native
support matrix/no fallback, leases/force/fresh-root behavior, source hash
inputs/exclusions, conservative spans, registry citation/versioning, legacy
name/discovery policy, and rollback. State that generated data inherits source
licensing and no card database is bundled. Do not claim card/source support
until their phases pass.

## Task 7.3 — CI, native/package checks, and benchmark

**Files:** create `.github/workflows/ci.yml`, `benchmarks/convert-full-cdb.ts`,
change `package.json`, `scripts/build-native.mjs`, `scripts/package-check.mjs` only
as required by earlier contracts.

Run `npm ci`; `npm run build` must invoke the native build prerequisite and
native load/capability-manifest generation before TypeScript; then run focused
tests, full tests, package dry-run, and packed CLI smoke on the supported
Node/OS matrix. `scripts/package-check.mjs` must validate the truthful native
manifest, loaded module identity, module hash, ABI/N-API metadata, and package
contents rather than trusting a version string. Secure file output is Linux
Node 22+ only when manifest and selected-filesystem probes pass; non-Linux/
unsupported jobs run stdout-only and assert exit 6 for file/directory. Measure
elapsed time, peak heap, output bytes, and profile/format without making
uncalibrated performance targets release blockers.

## Task 7.4 — Final conformance and rollback rehearsal

**Files:** create `tests/release/releaseGate.test.ts`; extend existing named
reader/CLI/native/streaming tests only where a gate is missing.

Run in order:

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

Also run the named native/source-handle/lifecycle race gates when the manifest
reports support, and the explicit unsupported branch otherwise. Verify valid
WAL-only extraction, strict text/ID failures, pre-copy aggregate budget,
fresh-root rejection, parent swaps, lease liveness/malformed/token cases,
force/no-force races, indeterminate reconciliation, cancellation cleanup,
physical-vs-logical provenance, many-output staging failure, continue-on-error
partial directory, and merged late collision (`exit 5`, no final).

The release is blocked if any gate fails, the full-suite result is only a timeout,
`npm pack --dry-run` contains undeclared files, a packed import points to
`app/index.js`, native support is claimed without hash/probe truth, or a prior
final/private artifact changes after a failed pre-commit attempt.

**Rollback:** restore the prior package/CLI artifact while retaining the v1
compatibility bridge. Never silently rewrite generated outputs or weaken native
security to make packaging pass.
