# Phase 2 — deterministic writers, staging budgets, and conversion orchestration

**Depends on:** Phase 1 normalized options, reader session, and raw envelope.
**Unblocks:** secure file/directory destinations.

## Task 2.1 — Writer-neutral byte boundary

**Files:** `src/serialization/canonicalJson.ts`, `src/serialization/index.ts`,
`src/serialization/jsonArrayWriter.ts`, `src/serialization/jsonLinesWriter.ts`;
create `tests/cli/serialization.test.ts`.

Replace direct `Writable` coupling with an injected writer contract exposing
encoded `write`, `flush`, `close`, `abort`, and explicit commit state. Keep stream
adaptation at destinations/application edges. Canonical JSON must be compact,
UTF-8, LF-only by default, two-space pretty when allowed, insertion-order for
profile output, and separate sorted-key canonicalization for hashes. Reject
non-finite values, circular values, unsupported types, and depth overflow.

JSONL writes one compact complete record plus LF; raw JSONL receives one envelope
per database, never rows. JSON array writer streams prefix/separators/suffix for
zero/one/many records and does not collect all records. `--pretty` is rejected
for JSONL.

**Verification:** test Unicode byte length, null/empty values, CRLF/CR/LF,
int64 strings, circular/non-finite values, JSONL final LF, and array boundaries.
Run:

```bash
npm run build
npx vitest run tests/cli/serialization.test.ts
```

**Stop:** a serializer uses JS code-unit counts for byte budgets, writes a
partial closing array after abort, or raw JSONL emits per-row records.

## Task 2.2 — Reservation correctness

**Files:** `src/application/stagingBudget.ts`, `src/application/types.ts`,
serialization files from Task 2.1; create
`tests/cli/stagingReservations.test.ts`.

Make reservations unique per owned physical file/handle; reject duplicate
reservation identities instead of overwriting entries. Before every encoded
chunk reserve against `maxOutputBytes`, then reconcile actual bytes after write.
Private file/directory chunks also reserve aggregate staging; stdout chunks do
not. Snapshot, materialization, spool, locks, reservations, and temporary
siblings remain aggregate-budgeted. Release exactly once in `finally`, including
zero/equal/over-limit boundaries.

Diagnostics must classify every reservation rejection as
`RESOURCE_LIMIT_EXCEEDED` (exit 4) before writing—including output-byte,
private-staging, snapshot, materialization, and merge-spool reservations—and
writer failures as `OUTPUT_WRITE_FAILED` (exit 6), without altering an incumbent
final.

**Verification:** use failing/instrumented writers and assert budget totals,
actual-size reconciliation, idempotent release/abort/close, stdout-vs-private
charging, and no leaked reservation after cancellation.

## Task 2.3 — One-database application state machine

**Files:** `src/application/convertCatalog.ts`, `src/application/outputPlan.ts`,
`src/application/types.ts`; create `tests/cli/conversionLifecycle.test.ts`.

Refactor `convert()` to discover, concretely plan, and acquire/retain one
opaque SourceHandle per discovered input before snapshot, reader, or SQLite
access, then process inputs sequentially. Concrete planning performs the
source/output device/inode/type checks through those handles; it does not use a
string/path recheck. For each active database, pass the retained handle into the
reader-owned session, map only the current database's rows, and either serialize
the database unit or feed the bounded profile/merge cursor. Close reader-owned
resources after reading and retain the SourceHandle for the conversion
transaction. Use `READING -> READY -> COMMITTING -> COMMITTED/ABORTED`; for a
split-card request, `READING` includes profile mapping, merge conflict
selection, and the late final-name pass, and `READY` is forbidden until that
pass succeeds. Collect source reports and diagnostics independently.

No-continue stages all required logical units before publication. Unmerged
continue-on-error isolates input failures, retains only successful units in one
owned private split directory, never publishes or commits a child independently,
and performs exactly one directory commit after all input attempts; it returns
exit 7 only after that successful final stage commit. Writer, lease, destination,
cancellation, and publication failures abort all staged output with exit 6;
`RESOURCE_LIMIT_EXCEEDED` remains exit 4 even when a private output or staging
reservation triggers it. Do not call
`computeFileHash(input.path)` or retain all input envelopes. Keep stdout
single-output/non-atomic and defer file/directory commit calls to Phase 3.

For `split=card`, the Phase 1 plan contains only a `DeferredSplitCardPlan` and
Phase 2 must not invent child names from raw/source ordinals. Keep mapped final
records in the existing disk-backed merge spool/index (or an equivalent bounded
final-record cursor). After the selected profile mapper and `error`/`first`/`last`
selection have produced the authoritative final order, the selected profile's
late-name task (Phase 5 Task 5.5 for `card`, Phase 6 Task 6.3 for `source`)
counts that cursor and allocates/collision-checks all child leaves in one pass
pair before any child writer is opened. A late duplicate or generated-name
collision aborts the private transaction and publishes no split root. The
trusted destination stage may exist privately, but it must contain no child
until the final-name manifest is complete.

Retain SourceHandle, trusted destination ParentHandle, and LeaseHandle through
final source/output identity recheck and commit barrier; release only after
`COMMITTED`, `NOT_COMMITTED`, or one-time `INDETERMINATE` reconciliation.

**Verification:** lifecycle doubles assert discovery -> concrete input plan ->
SourceHandle acquisition -> snapshot/session ordering, descriptor-relative
source/output identity checks, ordered close/transfer, sequential multi-input
processing, no all-input accumulator, and for split-card:
profile mapping -> merge winner selection -> final cursor/name allocation ->
child staging -> writer close -> final identity check -> commit. Assert that no
card child is created if late allocation or a late duplicate fails. Cover
pre-existing-final preservation, writer failure, cancellation before/during/
after commit, and exit state precedence. `sourceHandleBinding.test.ts` must
assert this ordering and that the retained handles stay open through the final
identity check and commit barrier. Run:

```bash
npx vitest run tests/cli/conversionLifecycle.test.ts tests/cli/stagingReservations.test.ts
npm run test:reader
npm run test:compat
```

**Stop:** any pre-commit failure publishes output, a signal after commit deletes
the final, or a private reader/destination resource bypasses ownership tracking.

## Task 2.4 — Raw stdout end-to-end checkpoint

**Files:** `src/commands/convert.ts`, `src/cli.ts`,
`tests/cli/processSmoke.test.ts`, `README.md` (raw workflow only).

Wire the phase-1 plan/session/envelope/application through compiled `dist/cli.js`
for explicit `--profile raw` stdout JSON and JSONL. Keep diagnostics and summaries
on stderr, make profile-unavailable failures stable before discovery, and do not
claim card/source availability yet. Use child processes, not only imported
`main()`, for stream separation and SIGINT behavior.

**Verification:**

```bash
npm run build
npm run test:cli
npm run package:check
```

The checkpoint must show schema-valid deterministic raw stdout, one envelope per
JSONL line, no diagnostics in stdout, and cleanup on SIGINT. Roll back only
application/writer wiring if this checkpoint fails; preserve Phase 1 reader and
fixtures.
