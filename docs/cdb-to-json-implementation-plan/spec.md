# Tactical implementation specification: `cdb-to-json` publication

## Request class and controlling sources

**Request class:** follow-up against an existing accepted implementation plan, with
remediation of the unwired Phase 2 surfaces.

**Exact delta:** continue from commit `b9d3585` on `publish`, where Phase 0–1
reader/compatibility work and a partial raw-to-stdout path exist. Complete the
remaining implementation required by the controlling product specification,
including secure file/directory publication, card/source profiles, commands,
streaming, packaging, and release gates. Do not treat the current raw stdout
increment as completion.

This package translates and sequences the accepted documents; it does not reopen
their product decisions:

- `docs/cdb-to-json-cli-refactor-spec.md`;
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`;
- `docs/cdb-to-json-cli-refactor-phase-2-remediation/spec.md`;
- `docs/cdb-to-json-cli-refactor-phase-2-publication/spec.md` and its phase files;
- `docs/cdb-to-json-cli-refactor/phase-3-card-profile.md`;
- `docs/cdb-to-json-cli-refactor/phase-4-source-streaming.md`; and
- `docs/cdb-to-json-cli-refactor/phase-5-hardening-release.md`.

## Concrete planning need

A new implementation plan is required because the repository currently has
independent scaffolds for parser, reader, raw mapping, serializers, commands,
and native destinations, while the accepted contract requires one ownership
lifecycle spanning all of them. The principal coordination hazards are:

1. a reader must own one verified main/WAL/SHM snapshot, WAL replay,
   materialization, strict text/integer validation, metadata, async iteration,
   and cleanup without a second live open;
2. application output must process one database at a time, reserve every private
   byte under one aggregate budget, and publish only after a synchronous commit
   barrier;
3. modern file/directory output must be a Linux capability-gated,
   descriptor-relative native transaction, not a JavaScript/path fallback; and
4. card/source normalization depends on exact canonical signed-int64 order and
   source provenance, while release/package behavior depends on the resulting
   API and schema contracts; and
5. `split=card` child names depend on final mapped records and merge winners,
   so assigning them in the pre-SQLite planner would either use unavailable
   facts or force an unbounded in-memory collection.

The order below makes the reader and writer contracts stable before native
publication, then enables card/source work only after raw conversion is safe;
late split-card allocation is an explicit boundary after profile/merge
finalization and before child staging.

## Verified repository state at planning time

`git status --short --branch` is clean on `publish`, with `HEAD` and
`origin/publish` at `b9d3585`.

The following gates were run against the working tree:

- `npm run build`: passes under Node `v26.5.0`; `build-native` writes an
  unsupported manifest and no native module;
- `npm run test:reader`: 7 files / 44 tests pass;
- `npm run test:cli`: 3 files / 41 tests pass; and
- `npm run package:check`: passes the current unsupported-native branch.

These passing checks prove only the current baseline. Source inspection found
these material gaps, which supersede optimistic claims in
`docs/implementation/current.md`:

- `src/cli/parseArgs.ts` uses `strict: false`, permissive numeric parsing, and
  resolves destination kind/cardinality from raw CLI positionals;
- `src/application/outputPlan.ts` is a partial matrix validator and
  `src/application/convertCatalog.ts` performs path-based `lstat` preflight,
  hashes/opens through the old iterator boundary, writes directly to injected
  streams, and has no atomic output transaction;
- `src/cdb/iterateRows.ts` has the basic snapshot/materialization flow but
  reads source members through strings, swallows read failures as a successful
  iterator termination, decodes invalid UTF-8 as `null`, does not validate all
  required storage classes/IDs, and has no metadata-aware ownership transfer;
- `src/cdb/snapshotBundle.ts`, `materializeSnapshot.ts`, and
  `stagingBudget.ts` do not reserve and reconcile all private bytes under one
  aggregate tracker;
- `src/serialization/*.ts` expose synchronous `Writable`-coupled placeholders,
  do not fully enforce output/staging reservations, and are not the application
  commit boundary;
- `src/destinations/secureDestination.ts` is an interface placeholder; the
  native source accepts raw fd integers and path strings, uses path-based lock
  operations, and calls `renameat2` with flags `0` rather than
  `RENAME_NOREPLACE`;
- `src/commands/validate.ts` reports discovery as `valid: true`,
  `inspectInputs.ts` hashes/opens the original path instead of a verified
  session, and `commands/schema.ts` ignores file output; and
- `src/normalization/normalizeCard.ts` uses JavaScript `parseInt` on raw
  signed-int64 strings, `src/text/segmentCardText.ts` is UNSPLIT-only, and
  card/source mapping, registries, schemas, and aggregate schemas remain
  incomplete or heuristic.

## Preserved decisions and invariants

The implementation MUST retain the accepted senior decisions D1–D8:

- physical bundle hash/source revision identity is distinct from canonical row
  ordering and logical content;
- copied main/WAL/SHM bytes are opened for WAL-capable replay, then
  `VACUUM INTO` materializes a private main-only file, which alone is opened
  read-only with `immutable=1` for extraction;
- supported text is selected as BLOB and decoded with fatal UTF-8; invalid
  encoding and wrong storage classes are errors, never `null` substitution;
- split roots are fresh and exclusive; existing empty or populated roots fail,
  including with `--force`;
- modern file/directory output is Linux-only when a truthful native capability
  manifest and selected-filesystem primitive probe pass; no path fallback exists;
- snapshot, materialization, spool, lock, reservation, and destination bytes
  share finite aggregate staging accounting;
- limit relations are reject-only before discovery (`maxSpoolBytes` and
  `maxSnapshotBytes` must not exceed `maxStagingBytes`); and
- `iterateRawCards()` is the one public async cancellable iterator, yielding to
  the event loop at least once per 256 rows and cleaning up on `return()`.

The product remains CLI-first, native ESM/strict TypeScript, Node 22+,
`better-sqlite3`, no bundler, explicit stdout/stderr injection, stable exit
precedence `2 > 3 > 4 > 5 > 6 > 7 > 1`, versioned schemas/registries, and a
v1-compatible default export. Card/source conversion is unavailable only until
its implementation is complete; the implementation may not fabricate those
profiles or silently downgrade their requests.

## Scope and non-goals

### In scope

- strict CLI parsing, two-stage pre-open output planning, and the late final-record name allocation required by `split=card`;
- source-handle-bound snapshot/session extraction and exact raw envelopes;
- deterministic JSON/JSONL writers, output/staging budgets, and conversion state;
- secure Linux native file and fresh split-directory publication;
- inspect, validate, schema, capability/package wiring, and compiled process
  gates;
- versioned card normalization, card profile, merge conflict lineage;
- conservative text normalization/segmentation, source profile, source revision
  hashing, and backpressure-safe streaming;
- README/migration/registry documentation, CI, package exports, and release
  rollback tests.

### Out of scope

- Lua/script/ruling execution or DSL compilation;
- semantic PSCT parsing, effect inference, legality inference, archetype-name
  guessing, or any executable card artifact;
- path-based or cross-platform secure-publication fallback;
- logical-content hashes that hide physical SQLite layout changes;
- arbitrary extra-table cell dumps, input database modification, bundled card
  databases, or conversion back into CDB;
- archiving the active planning documents before approval.

## Cross-phase behavior contract

Every modern conversion follows this dependency/order:

```text
strict parse + normalized options
  -> structural destination/capability preflight
  -> deterministic discovery
  -> concrete input/cardinality plan (database names only)
  -> acquire and retain opaque SourceHandle(s)
  -> descriptor-relative source/output identity checks
  -> copied bundle + WAL materialization using those handles
  -> metadata-aware reader session and canonical rows
  -> profile mapping and merge/conflict finalization
  -> late final-record name allocation (split-card only)
  -> deterministic encoding and private staging
  -> final source/output identity recheck
  -> native COMMITTING barrier
  -> COMMITTED, NOT_COMMITTED, or one-time INDETERMINATE reconciliation
```

The concrete input plan assigns only names that are knowable from discovery:
for example, database-split children use the deterministic input ordinal and
sanitized input stem. It acquires one opaque SourceHandle per discovered input
after that planning and before any snapshot, reader, or SQLite access. It
performs source/output device/inode/type checks through those retained handles;
no string/path identity recheck substitutes for the descriptor-relative check.
The handles are passed into snapshot acquisition, materialization, and the
metadata-aware session, then retained through profile/merge finalization, the
late name plan, the final identity check, and the commit barrier.

`split=card` is deliberately a deferred output plan. Its accepted matrix
requires `card` or `source`, `--merge`, and a directory, so its final record
ordinal and canonical ID do not exist at discovery time. After all profile
mapping and `error`/`first`/`last` conflict selection, a disk-backed final
record cursor is counted and traversed again. For `card`, this is wired by
Phase 5; for `source`, it is wired after source-profile mapping in Phase 6.
Only then does the final-name allocator compute
`<zero-padded-final-record-ordinal>-<id>.<profile>.<format>`,
validate every single-component name, and collision-check the complete name
set. No split-card child is opened or staged before this pass succeeds. A
collision or late duplicate aborts before publication and cleans only owned
private state.

The application state machine is `PLANNING -> READING -> READY -> COMMITTING ->
COMMITTED`, or `ABORTED`; `READY` is not entered for split-card until final
record names have been allocated and validated. A pre-barrier abort cleans only
owned private artifacts; a post-barrier signal cannot relabel a committed
result. Split output stages all successful children in one private `0700`
directory and publishes that directory once. `--continue-on-error` may return
exit 7 only for input/database failures after successful units are staged. Every
`RESOURCE_LIMIT_EXCEEDED`—including a row or text limit,
snapshot/materialization limit, output-byte limit, merge-spool limit, or private
staging/reservation limit—maps to exit 4, even when the reservation belongs to
an output transaction; `INVALID_LIMIT_RELATION` remains exit 2. Writer,
destination, lease, cancellation, and publication failures (including
`OUTPUT_WRITE_FAILED`) abort the transaction with exit 6 and must not be
reclassified as resource-limit failures.

Raw Phase 2 emits one complete `cdb.raw/1` envelope per database in JSON or
one envelope plus LF per JSONL line. Card/source aggregate schemas are top-level
arrays, distinct from item schemas. Stdout is data-only and intentionally
non-atomic; private outputs are atomic and budgeted.

## Global acceptance criteria

The package is complete only when all of the following are proven by focused and
full tests:

1. all invalid structural parser/matrix/limit/profile/destination cases fail at
   their documented pre-open boundary and never reach discovery or SQLite;
   record-dependent split-card name failures are the explicitly deferred
   post-mapping boundary described below;
2. one reader-owned session supplies verified physical metadata, extra-table
   metadata, canonical raw rows, strict UTF-8/integer/storage validation,
   cancellation, and cleanup without a second source open;
3. raw/card/source outputs validate against their checked-in schemas, retain
   orphan/null/raw facts, and are byte-deterministic for identical semantic
   inputs; split-card names are allocated only from the finalized mapped/merged
   record stream using exact canonical IDs and final ordinals, with no child
   staged before name validation;
4. every encoded output chunk is charged to `maxOutputBytes`, and every private
   file/stage/snapshot/materialization/spool/lock reservation is charged once to
   aggregate `maxStagingBytes`, with exact release on every path;
5. native-supported publication proves descriptor-relative traversal,
   no-follow/symlink/traversal resistance, lease grammar/liveness, no-clobber
   publication, parent replacement behavior, source identity, stage ownership,
   and one-time indeterminate reconciliation; unsupported capability fails
   before input access with `UNSAFE_DESTINATION_FILESYSTEM` exit 6;
6. card decoders retain unknown bits/raw values and use null-on-conflict rather
   than precedence guesses; merge `error`/`first`/`last` retains complete
   lineage and canonical numeric ordering;
7. source segmentation preserves exact raw text and normalized UTF-16 spans,
   never emits executable semantics, and source revision/options hashes include
   only the documented semantic inputs;
8. inspect/validate/schema are machine-readable, diagnostics remain on stderr,
   schema selection makes zero SQLite calls, and package exports/loaders are
   truthful; and
9. the named focused gates, `npm run build`, `npm run test:reader`,
   `npm run test:compat`, `npm run test:cli`, `npm run package:check`, and the
   full `npm test` all pass, with the native race suite run whenever capability
   reports supported.

## Dependency graph and stop policy

Implementation proceeds through the phase files in numeric order. Phase 3 is a
security stop point: if native descriptor-relative publication cannot be proven,
retain stdout and legacy behavior, mark capability unsupported, and do not add a
fallback; its directory API must accept caller-supplied final child names rather
than deriving card names early. Phase 5 stops if an authoritative registry revision cannot be researched and
recorded, or if final mapped/merged card records cannot be exposed through a
bounded cursor for late split-card allocation. Phase 6 applies the same
allocation only after source-profile mapping and stops if source records cannot
be exposed through that bounded cursor, if a generic source consumer requires a
CDB adapter, or if spans/hash inputs are ambiguous. Phase 7 blocks release on
any prior gate, native manifest mismatch, packed-artifact failure, or incomplete
rollback.

## External research questions

Before card-registry implementation, a researcher must answer these bounded
questions with URL plus immutable tag/commit/checksum citations:

1. What authoritative source fixes the EDOPro/YGOPro bit layout for card kind,
   traits, attributes, monster types, link markers, availability, categories,
   packed level/scales, and setcode packing?
2. Which exact registry values and masks are normative for the target converter
   major, and which values must remain unknown rather than guessed?
3. What content-hashed setcode/availability registry file format can be accepted
   without embedding third-party card data in the package?

No user product decision is open; the accepted Linux-only secure destination,
fresh roots, profile identifiers, conflict policy, and hash exclusions are
already selected in the controlling documents.
