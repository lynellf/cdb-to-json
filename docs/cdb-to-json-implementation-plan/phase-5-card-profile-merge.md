# Phase 5 — authoritative registries, card normalization, and merge lineage

**Depends on:** Phase 4 raw/session/schema contracts. **External research gate:**
complete the three bounded registry questions in `spec.md` before coding
normative decoders.

## Task 5.1 — Pin registry versions and fixture authority

**Files:** create `docs/registry-versioning.md`,
`src/registry/loadRegistry.ts`, and `tests/registry/registryLoader.test.ts`,
plus `tests/normalization/registries.test.ts`; extend
`src/application/types.ts` and inspect and either extend `src/registry/*.v1.ts`
or move implementation into `src/normalization/registries/*.v1.ts` while
preserving public exports.

The normalized `RegistryConfig` selects built-in or explicit
`--setcode-registry`/`--availability-registry` descriptors. The loader accepts an
override only with an allowlisted/pinned version and declared content hash,
validates the bytes against that hash before parsing, and returns the effective
version/hash for provenance; unsafe paths, missing pins, and hash mismatches are
stable failures and never silently use built-ins. Record URL, immutable
revision/checksum, known masks, unknown-bit policy, conflict policy, and content
hashes for card type, attribute, monster type, link marker, availability,
category, progression, stats, and setcode registries. Generated fixtures exercise
the source but never become the authority. Unknown bits must remain stable
hexadecimal data; no primary-kind/subtype precedence is allowed. Add independent
hand-authored vectors and known-bit re-encoding tests, including override
selection and content-hash failure.

**Stop:** no citable layout revision, ambiguous registry value, or requirement
for guessing unknown bits. Preserve raw data and block Phase 5.

## Task 5.2 — Exact pure decoders

**Files:** create/extend `src/normalization/decodeType.ts`,
`decodeProgression.ts`, `decodeStats.ts`, `decodeSetcodes.ts`,
`decodeAvailability.ts`, `decodeCategory.ts` and registry modules; extend
`src/normalization/normalizeCard.ts`; create
`tests/normalization/decoders.test.ts`, `tests/normalization/progressionVectors.test.ts`,
`tests/normalization/setcode.test.ts`.

Decoders must consume exact source integer strings without JavaScript numeric
coercion that can lose signed-int64 precision; use bounded bigint parsing and
explicit range conversion only where a field's documented domain is safe. Return
raw decimal values, typed values, complete arrays, unknown bits, registry
version/hash, and diagnostics. Implement conflict-safe card kind/subtype,
attribute/monster-type masks, packed level/rank/link/Pendulum fields, sentinel
attack/defense nulls, Link arrows with no invented defense, ordered zero-
terminated setcodes, alias zero-to-null, neutral availability, simulator-only
category flags, and all str1–str16 values.

**Verification:** property/golden tests cover every major frame, unknown bits,
conflicts, malformed packing, sentinel values, and exact signed-int64 extrema.
Run `npm run test:normalization` and `npm run build`.

**Stop:** `parseInt`/`Number` changes an exact raw value, an unknown flag is
silently zeroed, or a decoder invents semantic precedence.

## Task 5.3 — Schema-valid card profile and incomplete joins

**Files:** `src/profiles/cardProfile.ts`, `src/normalization/normalizeCard.ts`,
`src/application/convertCatalog.ts`, `schemas/cdb.card.v2.schema.json`;
create `tests/normalization/cardFrames.test.ts`,
`tests/conformance/cardProfileSchema.test.ts`.

Map canonical `RawCardRows` plus source context into `cdb.card/2`. Preserve
external string IDs, decoded/raw simulator values, null-on-conflict primary
fields, content-hashed registry provenance, unresolved setcodes, optional raw
rows only under `--include-raw`, source bundle hash, ordinals, and stable
diagnostics. Datas-only rows retain data/raw identity with null text/name and
unknown/null typed surfaces; texts-only rows retain exact text/name with null
data-derived surfaces. Never fill an absent partner with placeholders.

Implement card-kind-specific monster/spell/trap surfaces and ensure the primary
domain surface contains no unexplained integers. Do not implement text
segmentation here beyond passing exact source text to the later phase.

**Verification:** generated fixtures cover Normal, Effect, Ritual, Fusion,
Synchro, Xyz, Pendulum, Link, Token/Skill/special, every supported Spell/Trap
subtype, unknown/conflict/incomplete cases. Every output validates against the
item schema and is deterministic across physical insertion order.

## Task 5.4 — Disk-backed merge and lineage

**Files:** create `src/application/mergeRecords.ts`,
`src/application/mergeSpool.ts`, `src/application/mergeIndex.ts`; change
`src/application/convertCatalog.ts`, `src/application/stagingBudget.ts`;
create `tests/normalization/mergeConflicts.test.ts`,
`tests/normalization/mergeLateDuplicate.test.ts`,
`tests/cli/mergeConflicts.test.ts`.

Require explicit `--merge` for cross-input combination. Process deterministic
input order and canonical numeric IDs. Implement `error`, `first`, and `last`
with complete source lineage and ignored/replaced diagnostics. Use a two-pass
length-delimited disk spool/index for merged output; enforce one aggregate
`maxSpoolBytes` reservation across spool/index/lineage/temp files, honor output
backpressure, and clean all owned artifacts on error/cancel. A late duplicate
must fail before final rename under `error`; never silently replace. Expose the
winning records through a bounded, repeatable final-record cursor whose order
is the controlling merged output order and whose identity field is the exact
canonical signed-int64 decimal ID.

**Verification:** high-cardinality late-duplicate fixtures assert winner,
ordering, lineage, bounded heap, cleanup, writer failure, cancellation, and
that a duplicate found after earlier records have been mapped still prevents
any split-card child from being staged. Run:

```bash
npm run build
npm run test:normalization
npm run test:conformance
npm run test:cli
```

**Rollback:** if a registry or normalization mapping is wrong, preserve raw and
bump the registry version/checksum; do not rewrite historical raw fixtures. If
merge cannot remain bounded, disable card merge rather than silently using an
all-memory collector.

## Task 5.5 — Late final-record name allocation for card split output

**Depends on:** Task 5.3/5.4 and the Phase 3 directory-destination API. The
shared allocator is reused by the source-profile invocation in Phase 6 Task
6.3.

**Files:** create `src/application/finalRecordNamePlan.ts`; change
`src/application/convertCatalog.ts`, `src/application/outputPlan.ts`, and
`src/destinations/directoryDestination.ts`; create
`tests/cli/finalRecordOutputPlan.test.ts` and extend
`tests/normalization/mergeLateDuplicate.test.ts`,
`tests/cli/conversionLifecycle.test.ts`, and
`tests/cli/processSmoke.test.ts`.

Consume the `DeferredSplitCardPlan` rather than changing the pre-reader
planner's contract. This task is the authoritative allocation boundary for
`card` split-card output. It runs only after reader-owned canonical rows have
been mapped to `cdb.card/2` and the merge `error`/`first`/`last` policy has
produced the final record cursor. The same allocator and manifest contract is
invoked for `source` only after `ygo.card-source/1` mapping in Phase 6 Task 6.3.
It must not read SQLite, reopen a source, or infer an ID from a display name.

Perform a count pass over the final cursor to obtain the exact number `N` of
records, then a second pass in that cursor's final deterministic order. For
zero-based final record ordinal `j`, compute
`padWidth = max(1, decimalDigitCount(N - 1))` and construct exactly
`<String(j).padStart(padWidth, "0")>-<canonicalId>.<profile>.<format>`.
`canonicalId` is the already validated signed-int64 decimal string supplied by
the finalized record identity; retain it as a string and never use `Number`,
`parseInt`, or localized/name text. Validate each result as a native leaf,
reject duplicate/colliding names even if an upstream uniqueness invariant says
they should be impossible, and persist the manifest/index under the shared
spool/staging budgets rather than collecting all records or names in memory.

The allocator completes before any split-card child writer is opened or any
child is placed in the private stage. Pass its immutable name-to-record
manifest to `directoryDestination`; the destination only validates the leaf
again and writes it. A count/identity/name failure, late duplicate, resource
limit, cancellation, or writer failure removes only owned spool/index/stage/
lease artifacts and leaves the fresh final root absent. No partial split-card
publication and no exit-7 child commit is permitted.

**Verification:** `finalRecordOutputPlan.test.ts` covers exact IDs (`-2`, `2`,
`10`, and signed-int64 extrema), zero/one/many records, the `N=10` padding
boundary, deterministic ordering, duplicate-name defense, unsafe-leaf
rejection, and proof that SQLite/reader calls are complete before allocation.
Lifecycle/process tests assert the card sequence
`map -> merge winner selection -> count/name passes -> child staging -> single
commit`, and assert that a late duplicate or generated-name collision leaves no
final root. Phase 6 repeats the same vectors after source-profile mapping. Run:

```bash
npm run build
npm run test:normalization
npx vitest run tests/cli/finalRecordOutputPlan.test.ts tests/normalization/mergeLateDuplicate.test.ts tests/cli/conversionLifecycle.test.ts tests/cli/processSmoke.test.ts
npm run test:conformance
```

**Stop:** if final IDs/order are unavailable from the finalized cursor, if
allocation requires reopening SQLite, if names are allocated before conflict
selection, or if the implementation must retain the entire catalog in heap
memory. Preserve raw/unsplit output and block split-card publication until the
cursor and bounded manifest are fixed.
