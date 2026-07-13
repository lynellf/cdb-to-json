# Phase 1 — strict planning, source-bound reader, and raw contract

**Depends on:** existing Phase 0–1 compatibility/reader checkpoint.
**Unblocks:** serialization and application orchestration.

This phase replaces the current raw stdout scaffold with the stable contracts
that every later profile and destination consumes. Do not implement card/source
mapping here.

## Task 1.1 — Strict parse and normalized options

**Files:** `src/cli/parseArgs.ts`, `src/cli.ts`, `src/application/types.ts`,
`src/application/commandValidation.ts`, `src/diagnostics/codes.ts`, and
`src/registry/loadRegistry.ts` (create).

Use command-specific `node:util.parseArgs` definitions with `strict: true`.
Return a structured usage failure for unknown options, missing values, invalid
positionals, malformed/duplicate scalar options, and invalid enum values; never
turn parse failures into help. Parse only canonical non-negative safe integers
(no sign, fraction, trailing junk, overflow, or coercive `parseInt`). Parse
`--setcode-registry` and `--availability-registry` as explicit registry override
options and normalize them into `RegistryConfig` in `src/application/types.ts`
(each override is a `{path, version, sha256}` descriptor, with an explicit
built-in version/hash equivalent, not an untrusted path string). Normalize all
six limits exactly once, reject both aggregate-limit
relations before source access, preserve `PROFILE_NOT_AVAILABLE`, and keep
semantic options separate from presentation options. The loader in
`src/registry/loadRegistry.ts` is the only override-loading seam: it accepts only
pinned, content-hash-verified registry data and rejects unsafe paths or missing/
mismatched pins without silently falling back.

Install one SIGINT handler only around the application call and remove it in
`finally`. All diagnostics/progress go through injected stderr; data remains
injected stdout only.

**Verification:** add/extend `tests/cli/parseArgs.test.ts`,
`tests/cli/commandMatrix.test.ts`, `tests/cli/exitCodes.test.ts`,
`tests/cli/limitRelations.test.ts`, and
`tests/registry/registryLoader.test.ts`. Parser and matrix vectors must cover
both registry options, normalized descriptors, unsafe/unpinned/mismatched
registry data, and zero discovery/SQLite calls on those failures. Run:

```bash
npm run build
npx vitest run tests/cli/parseArgs.test.ts tests/cli/commandMatrix.test.ts tests/cli/exitCodes.test.ts tests/cli/limitRelations.test.ts tests/registry/registryLoader.test.ts
```

**Stop:** any parse failure becomes help, an unavailable profile touches
`discoverInputs`, or stdout receives human text.

## Task 1.2 — Two-stage pre-open plan with deferred split-card names

**Files:** `src/application/outputPlan.ts`, `src/commands/convert.ts`,
`src/application/types.ts`; create focused planner tests under
`tests/cli/commandMatrix.test.ts` and `tests/cli/pathSafety.test.ts`.

Define pure structural planning and post-discovery concrete input planning.
Structural planning validates profile/format/split/merge/conflict/pretty,
destination shape, limit relations, registry override descriptor shape, and
profile capability. The native preflight seam must accept only validated
destination intent and return opaque trusted-parent/lease handles; it must run
before discovery for destination kind, missing/invalid parent, existing split
root, and capability failures.

Concrete input planning runs after ordered discovery. It assigns `auto`,
validates cardinality, computes only discovery-derived database child names,
and rejects post-sanitization collisions before opening any source handle,
snapshot, or SQLite connection. For source/output device/inode/type identity
checks, the concrete plan then acquires and retains one opaque SourceHandle per
discovered input and performs the checks through those descriptors, still before
snapshot, reader, or SQLite access. No unchecked path recheck or live-source
hash/open is permitted.

Database children use
`<zero-padded-input-ordinal>-<sanitized-input-stem>.<profile>.<format>`. The
input stem is the basename with its final case-insensitive `.cdb` removed and
is sanitized by replacing every character outside `[A-Za-z0-9._-]` with `_`.
For a database name family with planned count `N`, ordinal `i` is zero-based
and `padWidth = max(1, decimalDigitCount(N - 1))`; use
`String(i).padStart(padWidth, "0")`. This exact formula and post-sanitization
collision check are pre-reader assertions. It must not hash inputs or make SQL
calls.

`split=card` is not a pre-SQLite filename plan. The command matrix requires
`card` or `source`, `--merge`, and a directory, while the final record ordinal
and canonical signed-int64 ID become authoritative only after reader-owned
canonical rows have been mapped to the selected profile and merge conflict
selection (`error`/`first`/`last`) has completed. Carry a typed
`DeferredSplitCardPlan` through the concrete plan; do not derive card names from
input ordinals, source ordinals, discovery stems, or unvalidated raw values.
The late allocator is specified in Phase 5 Task 5.5 and invoked for the
selected profile only after its mapping is complete (the source invocation is
wired in Phase 6); it is the only boundary that computes
`<zero-padded-final-record-ordinal>-<id>.<profile>.<format>`, using a second
pass over the finalized record cursor to count `N`, assign zero-based ordinal
`j`, apply
`padWidth = max(1, decimalDigitCount(N - 1))`, and collision-check every leaf
before any split-card child is staged. `<id>` remains the exact canonical
signed-int64 decimal string.

Freeze raw rules: raw rejects merge/card split; multiple unmerged inputs require
`split=database` and a directory; stdout is limited to one logical output;
existing split roots fail even with force; absent-file force remains no-replace,
while force against an expected regular incumbent is unsupported and fails
pre-discovery with exit 6.

**Verification:** inject a discovery spy and assert zero calls for each
structural failure and unavailable profile. Test absolute/relative destination
shapes, missing parents, traversal, symlinks, final appearance, parent swaps,
and force truth-table cases. In `tests/cli/commandMatrix.test.ts`, assert the
exact database-name formula, fixed input-ordinal padding, sanitization,
post-sanitization collision rejection, and that `split=card` produces a
`DeferredSplitCardPlan` without a final name or SQLite/reader call. Add the
late final-record name vectors in
`tests/cli/finalRecordOutputPlan.test.ts` during the profile phase that invokes
the allocator; do not pretend the pre-reader planner can assert their IDs. In
`tests/cli/processSmoke.test.ts`,
assert database-split names here and defer compiled split-card publication
vectors to the selected-profile Phase 5/6 gates. Run the Phase 1 command above plus
`npx vitest run tests/cli/pathSafety.test.ts`.

**Stop:** a plan method opens SQLite, follows an unchecked path, or defers a
structural destination failure until after discovery.

## Task 1.3 — Opaque source identity and bounded snapshot lifecycle

**Files:** create `src/cdb/sourceHandle.ts`; change
`src/cdb/snapshotBundle.ts`, `src/cdb/materializeSnapshot.ts`,
`src/cdb/stagingBudget.ts`, and `src/application/types.ts`.

Bind each discovered input once to an opened regular main descriptor, its source
parent/leaf, and device/inode/type/size identity. Default no-follow rejects a
source symlink; explicit follow resolves once and binds that descriptor. Change
snapshot acquisition to consume this handle and read main/WAL/SHM through held
parent/descriptor operations, verifying identity and bytes before/after copy
with bounded retries.

Reserve the pre-copy bundle sum against both `maxSnapshotBytes` and remaining
aggregate staging before the first copy. Reserve/reconcile each private physical
file exactly once, including materialized output, and remove owned directories on
success, error, and cancellation. Open only the copied bundle for WAL-capable
replay, `VACUUM INTO` a private main-only database, close it, then let extraction
open only the materialized file immutable. There is no live-read fallback.

**Verification:** extend `tests/reader/walMaterialization.test.ts`,
`tests/reader/physicalSnapshotProvenance.test.ts`,
`tests/reader/stagingSnapshotBudget.test.ts`; create
`tests/reader/sourceHandleBinding.test.ts`. Cover WAL-only rows, physical hash
changes despite canonical row equality, sidecar immutability/no sidecars,
source replacement at each boundary, materialization failure, zero/equal/over
budget, and cleanup. Run:

```bash
npx vitest run tests/reader/walMaterialization.test.ts tests/reader/physicalSnapshotProvenance.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/reader/sourceHandleBinding.test.ts
```

**Stop:** any live source hash/open, string-only source recheck, uncharged private
file, or immutable WAL replay appears.

## Task 1.4 — Reader-owned metadata session and exact raw rows

**Files:** change `src/cdb/iterateRows.ts`, `src/cdb/openDatabase.ts`,
`src/cdb/textPreflight.ts`, `src/cdb/rawTypes.ts`; create
`src/cdb/readDatabase.ts` if needed.

Introduce one internal session containing verified metadata, an async row
iterator, and `close()`. `iterateRawCards()` delegates to it and preserves the
public async iterator/`return()` cleanup contract. Validate required tables and
fixed columns, non-null SQLite INTEGER IDs, numeric storage classes, duplicate
IDs, UTF-8 encoding, text storage classes, and fatal BLOB decoding before any
row reaches output. Order IDs by canonical signed-int64 value and assign
zero-based data/text ordinals with data branch first. Convert SQLite INTEGERs to
exact decimal strings, preserve null/empty/line endings, propagate reader
failures, check abort per row, and yield at least once per 256 rows.

Metadata must include verified bundle hash, original main size, and sorted
metadata-only extra table name/columns/row count. The application must transfer
SourceHandle ownership after reader-owned SQLite/materialization/snapshot cleanup
and retain it through publication.

**Verification:** update `tests/api/iterateRawCards.test.ts` and
`tests/api/iterateRawCards.types.test.ts`; add invalid ID/storage/encoding/UTF-8
vectors and assert no null substitution. Run the inherited focused reader/API
gate from the controlling Phase 2 package, explicitly including the inherited
`tests/reader/textByteFidelity.test.ts` gate:

```bash
npx vitest run tests/reader/walMaterialization.test.ts tests/reader/textByteFidelity.test.ts tests/reader/physicalSnapshotProvenance.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/cli/limitRelations.test.ts tests/api/iterateRawCards.test.ts tests/api/iterateRawCards.types.test.ts
```

**Stop:** reader errors become successful empty streams, IDs are coerced through
JavaScript numbers, or malformed text reaches a profile.

## Task 1.5 — Database raw envelope and schema

**Files:** change `src/profiles/rawProfile.ts`,
`schemas/cdb.raw.v1.schema.json`; create `tests/cli/rawProfile.test.ts` and
`tests/conformance/rawOutput.test.ts`.

Build one active-database envelope in fixed property order:
`schema`, `integerEncoding`, `source`, `tables`, `extraTables`. Include every
supported fixed column and raw orphan branch, verified physical `sha256:` hash,
original main size, converter version, and metadata-only extra tables. Keep
legacy per-card mapper exports only where compatibility imports require them;
`convertCatalog` must not use them as its database pipeline.

**Verification:** validate raw JSON and raw JSONL envelopes against the schema,
including signed-int64 extrema, null/empty/Unicode/CRLF values, orphan rows,
extra-table metadata, and physical provenance. Run:

```bash
npm run build
npx vitest run tests/cli/rawProfile.test.ts tests/conformance/rawOutput.test.ts tests/api/iterateRawCards.test.ts tests/api/iterateRawCards.types.test.ts
npm run test:compat
```

**Rollback:** revert only the new session/raw envelope changes, retain reader
fixtures and the v1 bridge, then rerun reader and compatibility gates. No source
or final output may be modified during this phase.
