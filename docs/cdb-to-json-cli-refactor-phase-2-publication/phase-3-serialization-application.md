# Phase 3 — deterministic writers, budgets, and conversion orchestration

## Goal and dependency

Create a destination-neutral byte writer contract and make `convertCatalog` process
one active database at a time with explicit pre-commit state. This phase depends
on the reader session/raw envelope from Phase 2 and the normalized options from
Phase 1. It may use an in-memory test sink, but must not implement a filesystem
fallback.

## Files and bounded discovery

Change:

- `src/application/convertCatalog.ts`
- `src/application/types.ts`
- `src/application/outputPlan.ts`
- `src/application/stagingBudget.ts`
- `src/profiles/rawProfile.ts` only if the session metadata shape requires it
- `src/hashing/sha256.ts` and provenance helpers as needed
- `src/serialization/canonicalJson.ts`
- `src/serialization/jsonArrayWriter.ts`
- `src/serialization/jsonLinesWriter.ts`
- `src/serialization/index.ts`

Create or extend:

- `tests/cli/serialization.test.ts`
- `tests/cli/conversionLifecycle.test.ts`
- `tests/cli/stagingReservations.test.ts`

Inspect only the existing serializer APIs, staging tracker, conversion service,
exit-state type, and the raw session contract. Do not pass a raw `Writable` into
profile/domain code.

## Implementation tasks

### 3.1 Define the writer-neutral boundary

Use a small interface that accepts encoded UTF-8 chunks and owns lifecycle, for
example:

```ts
interface OutputWriter {
  write(chunk: Uint8Array): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  readonly committed: boolean;
}
```

The exact names may vary, but it must expose write/flush/close/abort and make
commit ownership explicit. Domain/application modules receive this interface or
a destination factory, not `Writable`, absolute filesystem paths, or process
streams. A stdout implementation may adapt an injected stream at the edge.

### 3.2 Make encoding deterministic and bounded

- `canonicalJson.ts` emits UTF-8, LF-only, compact JSON by default, and two-space
  pretty JSON where allowed. Preserve caller-controlled object property order;
  keep sorted-key hash serialization separate. Reject non-finite values and
  circular data. Count `Buffer.byteLength(encoded, "utf8")`, not JS code units.
- `jsonLinesWriter.ts` emits one compact record plus LF and rejects pretty mode.
  For raw Phase 2 it receives one complete envelope per database, never rows.
- `jsonArrayWriter.ts` streams prefix/separators/suffix, handles zero/one/many
  records, and is ready for later card/source profiles without collecting the
  array. Keep aggregate schema semantics as arrays, not wrapper objects.
- Before every encoded chunk, reserve against `maxOutputBytes` for the logical
  unit and reconcile the actual output count after the write. A private file or
  directory writer also reserves/reconciles that chunk against aggregate
  `maxStagingBytes`; the stdout writer does not charge encoded chunks to private
  staging because stdout is non-atomic. Snapshot, materialization, spool,
  reservation, lock, and destination temporary files remain aggregate-budgeted.
  A rejected reservation emits `RESOURCE_LIMIT_EXCEEDED` before write.
  Writer failure emits `OUTPUT_WRITE_FAILED`, aborts the writer, and does not
  alter a pre-existing final.
- Ensure reservation handles are unique and release the actual private file
  exactly once. Do not reuse the current map behavior where a second reservation
  can overwrite an entry or release a stale reserved amount.

### 3.3 Orchestrate one active database

Refactor `convertCatalog.ts` to:

1. validate the structural plan and discover deterministic inputs;
2. build concrete outputs before any snapshot/open;
3. create one collector, reader session, and envelope builder for the active
   database;
4. await verified metadata and append rows; then close the reader-owned SQLite,
   materialized-snapshot, copied-bundle, and private reader-staging resources,
   while transferring the still-open SourceHandle to the conversion transaction;
5. serialize through the output writer and run all pre-commit checks;
6. retain SourceHandle plus the required trusted destination ParentHandle and
   LeaseHandle through the native final source/output identity recheck and commit
   barrier; release/close those handles in `finally` only after publication is
   definite or indeterminate reconciliation;
7. transition `READING -> READY -> COMMITTING -> COMMITTED`, or `ABORTED`; and
8. aggregate source reports and diagnostics independently of successful sources.

Do not call `computeFileHash(input.path)` in this service. The session's physical
bundle hash is the only source provenance. Do not retain a collection of all
input envelopes. In no-continue mode, stage all required logical units before
publication; with unmerged `--continue-on-error`, each database has independent
staging and can commit only after its own envelope succeeds. Raw has no merge map.

Keep stdout streaming explicitly non-atomic and single-output-only. File and
split-directory destinations will supply atomic commit ownership in Phase 4.
For a split directory, the application stages every successful child in one
private `0700` stage directory and asks the destination to publish that directory
once; it must never publish children one by one. No-continue requires every
logical unit ready before that barrier. With `--continue-on-error`, only
input/database failures are retained in the stage and the one directory commit
returns exit 7; writer, destination, lease, or publication failures abort the
whole stage with exit 6. An indeterminate native publish result is reconciled by
opaque descriptor identity once and never retried.
The application must stop iteration and close/flush the writer before the
publication barrier, close reader-owned SQLite/session and private snapshot
resources after reading, then retain SourceHandle, its source-parent handle, the
trusted destination ParentHandle, and LeaseHandle through the final native
identity recheck and commit call. Those retained handles are released/closed in
`finally` after `COMMITTED`, `NOT_COMMITTED`, or one-time `INDETERMINATE`
reconciliation. Cancellation and writer failure must follow the same ownership
order; lifecycle tests must assert that no retained handle is closed before the
recheck. Cleanup may remove only handles owned by the current conversion; it must
not recursively delete an adopted or attacker-modified tree.

### 3.4 Keep semantic hashes separate

If this phase updates conversion options/provenance hashes, hash only normalized
semantic options: locale, source namespace, registry versions/hashes, text
normalization version where applicable, and every limit. Exclude input absolute
path, output path, format, pretty, diagnostics rendering, timing, and lock tokens.
Keep physical `bundleSha256`/`sourceRevisionId` separate from semantic options.

## Tests and acceptance criteria

Add tests for:

- canonical compact/pretty JSON, LF endings, UTF-8 Unicode, nulls, empty strings,
  CRLF/CR/LF, signed-int64 strings, non-finite/circular rejection;
- JSONL final newline and one complete envelope per line;
- array writer empty/one/many records and no collection of all records;
- per-output and private-staging reservations at zero/equal/over-limit
  boundaries; stdout enforces `maxOutputBytes` without consuming aggregate
  private-staging budget;
- injected writer failure, abort/close idempotence, late stdout failure, and
  pre-existing-final preservation through the destination test double;
- sequential multi-database processing, no all-input accumulator, continue-on-
  error per-database isolation, and exit-state precedence; and
- cancellation before iteration, during a 256-row checkpoint, before commit,
  during final identity recheck, and after the commit transition; the lifecycle
  double asserts that reader/materialization resources close after reading but
  SourceHandle/parent/lease handles remain open until the recheck and barrier.

Run:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli -- --run tests/cli/serialization.test.ts tests/cli/conversionLifecycle.test.ts tests/cli/stagingReservations.test.ts
```

**Stop condition:** any writer bypasses reservation, raw JSON and JSONL disagree,
application provenance uses a live main hash, or a pre-commit failure can publish
partial output.

## Rollback

Remove only the new writer/orchestration layer and restore the prior application
entry point. Keep the session tests and reader fixes from Phase 2; rerun build,
reader, compatibility, and package checks before retrying.

## B2-R5 implementation amendment — ownership and uncertain publication

The application state machine must distinguish publication from cleanup:

```text
Temp: OPEN -> CLOSED -> PUBLISHED | ABORTED
Stage: OPEN -> VERIFIED -> TRANSFERRED | ABORTED
StageChild: OPEN -> CLOSED -> TRANSFERRED | ABORTED
Lease: HELD -> RELEASE_PENDING -> RELEASED | RELEASE_FAILED
Source/Parent: OPEN -> CLOSED
```

For a split directory, each child is created and written through a
`StageChildHandle`; closing it leaves the child in the private stage. The
application passes the exact closed child identities to stage verification and
invokes one directory publication. It must never manufacture a sibling path or
publish children individually. An unknown stage entry causes verification
failure; cleanup removes only exact owned children and removes the stage only
when an exact-empty check succeeds.

After a native `INDETERMINATE`, reconcile exactly once using this matrix:

| Observation | Application state/action |
|---|---|
| final identity equals owned published temp/stage | `COMMITTED`; preserve final, transfer ownership, release lease only |
| final absent with owned temp/stage live | `ABORTED`; clean only owned artifacts |
| expected incumbent remains with owned temp/stage live | `ABORTED`; preserve incumbent, clean only owned artifacts |
| both final and temp/stage names exist | remain output-failed/indeterminate unless native identity proves an owned disposable alias; never recursive cleanup |
| mismatched/attacker final, symlink, directory, or source identity | output failure if uncertain; preserve final and clean only provable ownership |
| final committed but lease release fails | remain `COMMITTED` with cleanup diagnostic; no retry or destructive cleanup |
| unknown stage entry | output failure; leave unknown entry/stage in place |

Only a proven final enters `COMMITTED`. A cleanup failure after that transition
cannot relabel it, trigger a retry, or delete the final. `cleanup(handle)` is
idempotent for the same handle, rejects token/identity mismatch, and closes
source/parent handles without deleting them. Add these cases to
`tests/cli/conversionLifecycle.test.ts` and the native race suite.
