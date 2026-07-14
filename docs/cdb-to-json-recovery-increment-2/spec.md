# Recovery increment 2 — writer-neutral boundary and staging budget

## Status and lineage

**Request class:** follow-up to the accepted recovery increment 1.

Increment 1 (`cdb-to-json-recovery-increment-1`, revision 1) corrected the two
aggregate schema artifacts and is represented by baseline commit `0ff06c8`.
This package does not revise that accepted phase. It gives the next dependency-
ordered writer/budget slice its own contract so the mixed working tree cannot be
committed as one Phase 3–5 change.

The contract is revision 7 of
`docs/cdb-to-json-recovery-increment-2/execution-contract.json`. Revision 7
retains the revision-6 writer failure/order proofs and closes three review
findings: it records the post-increment-1 repository baseline, binds a complete
before/after preservation and no-commit gate for the mixed tree, and adds a
source-level proof that stdout has no hidden private staging owner. The entire
conversionLifecycle candidate remains deferred and excluded from this phase.
The explicit JsonLinesWriter / JsonArrayWriter boundary remains. The validator at
`/home/lynellf/.pi/roles/validate-execution-contract.py` confirms the contract
is structurally valid (it is not part of the project tree and is intentionally
not staged). The JSON contract is the binding artifact; this document explains
its grounding and rationale.

## Goal and current request

The contract preserves the original orchestration goal verbatim. Its embedded
run-memory snapshot records `6cfb9bc` as the state at the predecessor handoff.
That snapshot predates the accepted increment-1 commits now visible in the
repository: `16d28cf` and then `0ff06c8`. Revision 7 uses direct repository
verification, not that historical snapshot, for the active baseline. Current
state is verified below.

The bounded request remains:

> Draft a new bounded execution contract for the Phase 3 writer/budget
> foundation, with a clear plan-review path. P1 of
> `cdb-to-json-recovery-increment-1` is complete; the next slice needs its own
> contract per the recovery pattern.

Plan-reviewer-a rejected revision 2 with five plan-origin gaps and three
newly-discovered risks. Revision 3 originally closed those gaps by adding
explicit acceptance criteria and tightened invariant statements; revision 4
resolved two additional plan/package contradictions. The follow-up review then
identified one impossible TestOutputSink event-trace proof and three missing
failure/isolation verification cases; revision 5 closed those findings, and
revision 6 closes the conversionLifecycle path-boundary finding so the package
is self-consistent. Revision 7 closes the stale-baseline, mixed-tree
preservation/no-commit, and stdout-hidden-budget findings identified by the
next plan-review.

## Verified repository state at revision 7 planning

The commands below were run against the current working tree on 2026-07-13:

- `git rev-parse HEAD origin/publish` returned the same current commit:
  `0ff06c8a4dc4994852112ebde59f6eff`.
- The first-parent history shows `6cfb9bc` as the predecessor-handoff
  ancestor, followed by accepted commits `16d28cf` and `0ff06c8`. Thus the
  trusted predecessor snapshot was historical at this planning visit; direct
  repository verification makes `0ff06c8` the active baseline.
- The tree contains 24 changed or untracked paths. The implementation allowlist
  is the five Phase 3 foundation paths in the contract; the recovery plan
documents are planning artifacts, not implementation paths.
- Before P1 dispatch, an outside-the-repository snapshot must capture complete
  status, binary diffs, and per-path hashes. At handoff, the exact deferred
  implementation set must compare byte-for-byte and status-for-status; refs
  must remain unchanged and no P1 path may be staged, committed, or pushed.

| Classification | Current paths | Revision 6 decision |
|---|---|---|
| Writer/budget foundation | `src/application/stagingBudget.ts`, `src/serialization/outputWriter.ts`, `src/serialization/index.ts`, `tests/cli/serialization.test.ts`, `tests/cli/stagingReservations.test.ts` | **In scope.** One closed writer/budget boundary; no conversion-lifecycle path or orchestration change. |
| Deferred orchestration | `convertCatalog.ts` and the entire `tests/cli/conversionLifecycle.test.ts` candidate | **Deferred.** The candidate's constructor migration and all simulated conversion-lifecycle tests require a separate contract. |
| Deferred native/publication | `scripts/build-native.mjs`, `src/destinations/handles.ts`, `src/destinations/nativeAdapter.ts`, `src/destinations/secureDestination.ts`, `src/commands/convert.ts`, `tests/cli/processSmoke.test.ts`, `tests/fixtures/tempDir.ts` | Deferred; the typed native ABI still has unsupported/unimplemented operations and is not secure publication. |
| Deferred inspect/validate | `src/application/inspectInputs.ts`, `src/application/validateInputs.ts`, `src/commands/validate.ts`, `tests/cli/inspectValidateSchema.test.ts`, `tests/fixtures/tempDir.ts` | Deferred; real validation and command wiring require their own phase. |
| Deferred status prose | `docs/implementation/current.md` | Deferred; it contains unsupported completion claims. |
| Recovery package artifacts | `docs/cdb-to-json-recovery-increment-1/*`, `docs/cdb-to-json-recovery-increment-2/*` | Planning artifacts only; never include them in the five-path implementation commit. |

The duplicated `tests/fixtures/tempDir.ts` classification is intentional: it is
shared by deferred process/command candidates and is not an allowed path for
this phase.

### Preservation and process boundary

P1 may change only the five active implementation paths. The deferred
implementation set is exactly:

- `docs/implementation/current.md`;
- `scripts/build-native.mjs`;
- `src/application/inspectInputs.ts`;
- `src/application/validateInputs.ts`;
- `src/commands/convert.ts`;
- `src/commands/validate.ts`;
- `src/destinations/handles.ts`;
- `src/destinations/nativeAdapter.ts`;
- `src/destinations/secureDestination.ts`;
- `tests/cli/conversionLifecycle.test.ts`;
- `tests/cli/inspectValidateSchema.test.ts`;
- `tests/cli/processSmoke.test.ts`; and
- `tests/fixtures/tempDir.ts`.

This set must be snapshotted outside the repository before implementation
(status lines and SHA-256 content hashes), then compared at handoff. A change,
delete, rewrite, or status change is an escalation, not a cleanup opportunity.
The five active paths remain unstaged and uncommitted; HEAD and
`origin/publish` remain the current `0ff06c8` commit, and no commit or push is
permitted before the later implementation-review gate. The plan-package files
are intentionally excluded from this preservation set because revision 7
updates the package itself.

## Measured telemetry

These measurements are from the actual mixed tree, not inherited claims:

- `npx vitest run tests/cli/serialization.test.ts tests/cli/stagingReservations.test.ts`:
  2 files, 71 tests passed on the unfixed source tree.
- `npm run build`: passed; the native build wrote the expected unsupported
  manifest for Linux x64 Node `v26.5.0`.
- `npm run test:cli`: 8 files, 218 tests passed.
- `npm run test:reader`: 8 files, 62 tests passed.
- `npm run test:compat`: 3 files, 22 tests passed.
- `npm run package:check`: passed, including the truthful unsupported-native
  capability branch.
- `npm test -- --reporter=dot`: 29 files, 408 tests passed.

The focused tests currently pass because the candidate tests do not yet prove
every revision-5 behavior (notably adapter-specific sink ordering for
TestOutputSink, injectable sink failure, direct close-path flush failure,
terminal flush behavior across all adapters, the independent zero-limit stdout
sentinel, OutputWriterOptions re-export, named reconcile invocation,
reconcile-before-byte-counter ordering, flush-before-close, boolean reconcile,
stdout flush backpressure, and the conversionLifecycle path-boundary exclusion).
The implementer must add the contract-required tests; the reviewer
must record the post-change counts and must not treat 71 or 408 as fixed
targets.

## Behavior in scope

This increment establishes only a destination-neutral output foundation:

1. `OutputWriter` accepts already encoded UTF-8 `Uint8Array` chunks and owns
   asynchronous `write`, `flush`, `close`, and `abort` operations. It exposes
   `committed`, `state`, and `bytesWritten`. `WriterState` is exactly `OPEN`,
   `CLOSED`, or `ABORTED`.
2. `OutputWriterOptions` is a concrete exported interface with exactly two
   optional members, `reserve(bytes): boolean` and `reconcile(bytes): void`.
   `TestOutputSink`, `CallbackOutputWriter`, and `StdoutOutputWriter` use that
   single option shape. The `JsonLinesWriterOptions` and
   `JsonArrayWriterOptions` interfaces are unrelated and remain on their own
   files. Only the stdout edge adapter accepts an injected `Writable`.
3. `OutputWriter`, `WriterState`, `OutputWriterOptions`, and the three adapter
   classes are re-exported from `src/serialization/index.ts`. Each adapter
   constructor accepts the named `OutputWriterOptions` argument, not a bare
   `reserve` callback.
4. For every write, `reserve(chunk.byteLength)` runs before the sink. A false
   result causes no sink, reconciliation, or byte-count side effect and leaves
   the writer open. After a sink succeeds, the writer invokes `reconcile(bytes)`
   exactly once if configured and increments `bytesWritten` by `chunk.byteLength`
   only after that callback returns. Sink or reconciliation failure cannot commit
   the writer and leaves `bytesWritten` at its pre-write value; flush failure
   cannot commit and does not change the prior byte count. All such failures
   transition the writer to `ABORTED` and leave it uncommitted. A sink may
   already have accepted external bytes when reconciliation throws; the counter
   intentionally does not advance for that failed write. Ordering verification
   is adapter-specific: TestOutputSink proves its stored chunk is present from
   inside reconcile, while CallbackOutputWriter and StdoutOutputWriter expose
   their underlying sink to direct event recording. No sink callback is added to
   the exactly two-member `OutputWriterOptions` interface.
5. `close()` performs/awaits a successful `flush()` before setting `CLOSED`
   and `committed=true`. A flush that rejects on the close path transitions
   the writer to `ABORTED` with `committed=false` and propagates the error.
   `StdoutOutputWriter.flush()` awaits every pending Writable write completion
   callback plus any required drain/finish signal, rejects on an observed write
   or stream error, and returns immediately after CLOSED without installing
   listeners or changing commitment. Terminal operations are monotonic and
   same-terminal calls are idempotent. Stdout remains non-atomic: bytes
   already accepted by its stream cannot be rolled back.
6. `StagingBudget` tracks aggregate private bytes. A positive active key is
   unique. `reserve(path, bytes <= 0)` returns true as a no-op without creating
   an entry; a duplicate active key is rejected before that no-op. Reconcile
   tracks whether an actual size has been applied, so actual `0` is valid and
   distinct from the initial reservation. If a candidate reconciliation would
   exceed `maxBytes`, `StagingBudget.reconcile` returns `false`, emits
   `RESOURCE_LIMIT_EXCEEDED`, and preserves the prior accounting. Release
   subtracts the latest accounted amount exactly once.
7. The default stdout adapter does not charge an independent private
   `StagingBudget`. An explicit `reserve` callback can enforce a per-output
   limit but is not aggregate staging ownership. The focused proof constructs
   an independent `StagingBudget(0)` sentinel, performs default stdout
   write/close, and asserts the sentinel remains at zero. Because an
   independently constructed sentinel cannot detect a secretly constructed
   second budget, this runtime check is supplemented by binding source
   inspection: `outputWriter.ts` must contain no `StagingBudget` import or
   instantiation, hidden aggregate/private-budget tracker, or filesystem
   dependency; StdoutOutputWriter may use only its injected Writable and the
   caller-supplied reserve/reconcile callbacks.

The existing JSON serializers may be exercised for deterministic UTF-8, line,
array, and error behavior. Their source files and destination integration are
not part of this package; findings about `JsonLinesWriter` or `JsonArrayWriter`
belong to a separate focused phase.

## Constraints and non-goals

- Do not modify `convertCatalog.ts`, application state types, output planning,
  reader/session code, profiles, destinations, native sources, command
  handlers, package scripts, or status prose.
- Do not add a JavaScript `fs`/`path` fallback or claim file/directory
  publication. Do not make the writer accept a path, descriptor, or native
  handle.
- Do not add conversion orchestration, commit barriers,
  SourceHandle/ParentHandle retention, cancellation sequencing, or
  continue-on-error behavior.
- Do not add CLI `maxOutputBytes` parsing/wiring, `OUTPUT_WRITE_FAILED`
  mapping, private destination factories, or aggregate-staging destination
  integration. The callbacks are a foundation only.
- Do not edit `JsonLinesWriter` or `JsonArrayWriter` source files; they are
  focused serializer subjects only and their existing reserve/reconcile
  callsites are not part of this package. Reviewer findings against those
  files are recorded against their own future phase and must not block this
  contract.
- Do not edit, add, or review `tests/cli/conversionLifecycle.test.ts` in this
  increment. Its constructor migration and simulated conversion behavior are
  entirely deferred to a separately contracted conversion-lifecycle phase.
- Do not change schema identifiers, profile availability, raw reader behavior,
  native capability claims, or accepted product decisions.
- Do not create or stage a `roles/` directory inside the project tree. The
  contract validator lives outside the project (`/home/lynellf/.pi/roles/`)
  and is invoked by absolute path.

## Decisions and assumptions

1. One phase is sufficient because the three adapters and aggregate tracker
   have one focused verification boundary and no conversion dependency.
2. A single `OutputWriterOptions` interface is the named callback boundary so
   review can prove reservation and reconciliation ordering independently of
   the writer implementation.
3. Reservation denial is a recoverable pre-sink condition and leaves the
   writer `OPEN`; sink, flush, or reconciliation failure aborts the writer.
   The sink effect may be externally accepted before a later reconciliation
   notification throws, but the writer increments `bytesWritten` only after
   reconciliation returns, so the failed write keeps the counter at its
   pre-write value.
4. `close()` must await `flush()` so the only path to `committed=true` runs
   through successful persistence; close is not a no-op label.
5. A non-positive reservation request is a no-op and is not an active owner.
   Zero *actual* bytes after a positive reservation is different: it is a
   reconciled active entry and must release zero.
6. `StagingBudget.reconcile` returns `boolean` so the over-limit condition
   can be observed and recorded without a separate diagnostic probe. The
   previous void return hid that failure behind caller logging.
7. `StdoutOutputWriter.flush()` is a real flush, not a no-op: each successful
   write registers a completion callback; flush awaits pending callbacks and
   required backpressure signals, a broken Writable must reject before close
   commits, a healthy stream must resolve so close can commit, and flush after
   CLOSED must not revoke commitment or install listeners.
8. Stdout remains non-atomic; only flush failure is observed.
9. The current five-path allowlist is immutable for this phase. The entire
   `tests/cli/conversionLifecycle.test.ts` candidate is excluded; a required
   change outside the five paths is an escalation, not an implicit scope
   expansion.
10. Before P1 dispatch, snapshot the complete mixed-tree status, diffs, and
    per-path hashes outside the repository. Preserve every deferred
    implementation path byte-for-byte and status-for-status; keep HEAD and
    origin/publish unchanged, leave P1 work unstaged/uncommitted, and do not
    commit or push before the later implementation-review gate. The directly
    verified baseline for this visit is `0ff06c8`; `6cfb9bc` is historical.

## Remediation closure for revision-2 plan-reviewer findings

Plan-reviewer visit 3 against this contract surfaced five plan-origin gaps and
three newly-discovered risks. Revision 3 closed those original plan-origin gaps;
revision 4 resolves the two blocking contradictions identified in the revision-3
plan-review report.

### Plan-origin gaps (binding addition to contract rev 2 → rev 3)

| Plan-reviewer finding (rev 2) | Revision-3 closure |
|---|---|
| Missing `OutputWriterOptions` interface — the contract referenced the option name but never defined the interface or its members, and the source constructors took a bare `reserve` callback. | `INV-002` and `P1-AC10` require `OutputWriterOptions` to be declared in `src/serialization/outputWriter.ts` as an interface with exactly two optional members `reserve?: (bytes: number) => boolean` and `reconcile?: (bytes: number) => void`, to be re-exported from `src/serialization/index.ts`, and to be the actual constructor argument for all three adapters. Frozen decisions now list the exact constructor signatures. |
| Missing `reconcile` invocations in adapters — `INV-003` and `P1-AC3` implied the ordering but the source never assigned or called `reconcile`. | `P1-AC11` is a blocking criterion: each of the three adapters must invoke the optional `reconcile(chunk.byteLength)` exactly once after a successful sink, never on reservation or sink rejection; if reconciliation throws, the writer aborts and the counter remains at its pre-write value. Revision 5 makes the proof adapter-specific: TestOutputSink inspects its stored chunk inside reconcile, while CallbackOutputWriter and StdoutOutputWriter use direct sink traces, with reserve rejection, injectable sink failure, and reconciliation-throws cases. |
| `close()` does not flush — the source set state to `CLOSED` and `committed=true` synchronously without awaiting `flush()`. | `INV-004`, `P1-AC4`, and the new `P1-AC12` require `close()` to await a successful `flush()` before `CLOSED`/`committed=true`. Flush failure on the close path transitions the writer to `ABORTED` with `committed=false` and propagates the error. Idempotent close on `CLOSED` and rejection of close on `ABORTED` are part of the same criterion. |
| `StagingBudget.reconcile` returns `void` — over-limit rejection was unobservable because the source signature declared `: void`. | `INV-005`, `P1-AC9`, and the new `P1-AC13` require the TypeScript signature to read `reconcile(path: string, actualBytes: number): boolean`. Over-limit candidates return `false`, emit `RESOURCE_LIMIT_EXCEEDED` when a `DiagnosticCollector` is provided, and leave the entry's prior accounted amount and `currentBytes` unchanged. |
| `StdoutOutputWriter.flush` is a no-op — the contract implied backpressure awareness only in the phase-1 markdown, while the JSON contract had no binding requirement. | `INV-004` and the new `P1-AC14` require `StdoutOutputWriter.flush()` to observe the injected `Writable`'s pending state and reject on observed error so close cannot commit past a broken stream. A healthy stream resolves flush so close commits. Default construction continues to leave an independent `StagingBudget` at zero. |

### Newly-discovered risks (status and disposition)

| Newly-discovered risk | Disposition in revision 3 |
|---|---|
| `JsonLinesWriter.close` never calls `_writer.close`. | Out of scope for this increment. The contract explicitly lists `JsonLinesWriter` and `JsonArrayWriter` source edits under `non_goals` and `deferred`, and `P1` `bounded_discovery` tells the implementer to treat findings about those files as out-of-scope; the new `stop_conditions` item instructs any reviewer to record such a finding against the future JsonLinesWriter/JsonArrayWriter phase instead of blocking this contract. |
| `flush()` throws in `ABORTED` state instead of being idempotent. | Same disposition. `JsonLinesWriter.flush` is not part of the writer-budget foundation; if its failure semantics need to be revisited, that is a separate contract scoped to that file. |
| `validate-execution-contract.py` does not exist. | Environmental, not a contract defect. The validator is installed at `/home/lynellf/.pi/roles/validate-execution-contract.py` and was successfully executed against revision 3, returning `Validated execution contract cdb-to-json-recovery-increment-2 revision 3 with 1 phase(s).`. The `roles/` directory is intentionally **not** part of the project tree; the planner and reviewer must invoke the validator by absolute or PATH-resolved path. This specification now records the validator's location so that future reviewers do not search the project tree. |

## Revision-4 closure of plan-reviewer-a findings

| Finding | Contract/package resolution |
|---|---|
| `INV-003 / P1-AC3 / P1-AC11`: the package said a successful sink increments `bytesWritten` before reconciliation, but also required a throwing reconciliation callback to leave the counter unchanged. | Revision 4 freezes one rule across the JSON contract and both phase documents: reserve, sink, reconcile; only after reconcile returns does the counter increase. If reconciliation throws, the sink may have accepted external bytes, but the writer is `ABORTED`, uncommitted, and `bytesWritten` remains at its pre-write value. `INV-003`, `INV-004`, `P1-AC3`, and `P1-AC11` retain their IDs with normalized wording. |
| `INV-001 / INV-002 / P1-AC1 / P1-AC2 / P1-AC6`: the options-only constructor API conflicted with the required CLI/full-suite inclusion of `tests/cli/conversionLifecycle.test.ts`, whose existing calls used bare reserve callbacks. | Revision 4 recorded the temporary six-path migration boundary. Revision 6 supersedes it: the file is wholly deferred, P1-AC15 is retired, and P1-AC20 requires that no conversionLifecycle hunk or file be included in P1. |

## Revision-5 closure of follow-up plan-review findings

| Finding | Contract/package resolution |
|---|---|
| `INV-002 / INV-003 / P1-AC3 / P1-AC11`: the prior package required a literal `reserve -> sink -> reconcile` event trace from TestOutputSink even though its frozen `OutputWriterOptions` has no sink callback and the in-memory adapter has no injected sink boundary. | Revision 5 makes the evidence adapter-specific without expanding the interface: TestOutputSink's reconcile callback inspects `chunkCount`/`chunks` to prove the internal sink ran first; CallbackOutputWriter and StdoutOutputWriter retain direct sink event traces through their existing callback/Writable boundaries. |
| Missing executable sink-failure, direct close-path failure, terminal-flush, and independent stdout-isolation proofs. | Revision 5 adds blocking `P1-AC16` (injectable callback/stream sink failure), `P1-AC17` (direct `close()` against an error-emitting Writable), `P1-AC18` (OPEN/CLOSED/ABORTED flush matrix for all adapters), and `P1-AC19` (independent `StagingBudget(0)` sentinel). The phase document and contract evidence require these exact tests. |

The validator location remains external to the project tree. The planner ran
`python3 /home/lynellf/.pi/roles/validate-execution-contract.py docs/cdb-to-json-recovery-increment-2/execution-contract.json`
and received exactly: `Validated execution contract cdb-to-json-recovery-increment-2 revision 7 with 1 phase(s).`

## Revision-6 closure of P1-F-004

The post-implementation review classified P1-F-004 as a planning-origin
defect. Revision 5 listed `tests/cli/conversionLifecycle.test.ts` among the
active paths but limited it to a constructor-callsite migration, while the
untracked candidate is a 449-line file containing 23 simulated conversion
lifecycle tests. A reviewer cannot classify a whole untracked file as both
active and hunk-limited from the path-level contract.

Revision 6 resolves the boundary rather than accepting unrelated behavior. The
active allowlist is exactly the five writer/budget paths; the entire
conversionLifecycle candidate is deferred, P1-AC15 is retired, and fresh
criterion P1-AC20 requires the candidate to be absent from the P1 patch. A
future conversion-lifecycle phase must contract its constructor migration and
behavior independently. P1-F-001, P1-F-002, and P1-F-003 remain active
implementation/verification findings for the five-path writer phase.

### Revision-6 ID impact

- `INV-001` and `P1-AC1` retain their path-isolation meaning with the active
  allowlist narrowed from six paths to five.
- `P1-AC14` retains its Stdout flush meaning and is clarified to require
  pending-write completion and CLOSED-state stability, directly distinguishing
  the observed incorrect implementation.
- `P1-AC15` is retired because its constructor-migration obligation belonged to
  the now-deferred conversionLifecycle path; its meaning is not reused.
- `P1-AC20` is new and binds the replacement path-boundary proof: no
  conversionLifecycle file or hunk enters P1.

## Revision-7 closure of plan-reviewer-a findings

| Finding | Contract/package resolution |
|---|---|
| P1-F-005: stale repository baseline in the supporting package. | Revision 7 records the temporal transition explicitly: the predecessor handoff named `6cfb9bc`, then accepted commits `16d28cf` and `0ff06c8` landed. Direct commands at this planning visit verify `HEAD=origin/publish=0ff06c8`; the goal's embedded snapshot remains verbatim as historical context and is not reused as a current measurement. P1-AC1 and INV-001 now require the implementer and reviewer to verify that identity before path comparison. |
| P1-F-006: no binding preservation/no-commit gate for the mixed tree. | Revision 7 adds blocking P1-AC21. It names the exact deferred implementation set, requires an outside-repository status/diff/hash snapshot before dispatch and a byte/status comparison at handoff, requires unchanged HEAD/origin/remote publish refs, and forbids staging, commit, or push before implementation review. The new frozen decision and stop conditions make deletion, rewrite, cleanup, or early publication an escalation rather than an implicit scope change. |
| P1-F-007: an independent `StagingBudget(0)` sentinel cannot detect a secretly constructed private budget. | Revision 7 strengthens INV-006, P1-AC7, and P1-AC19 with binding source inspection of `outputWriter.ts`: no StagingBudget import/instantiation, hidden aggregate tracker, or filesystem dependency; StdoutOutputWriter may use only the injected Writable and supplied callbacks. The independent sentinel remains supplemental runtime evidence. |

### Revision-7 ID impact

- All accepted phase, invariant, and criterion IDs retain their meanings.
- `P1-AC21` is new and binds mixed-tree preservation, unchanged repository
  refs, and the pre-review no-stage/no-commit/no-push gate. It is not reused
  for another meaning.
- Revision increments from 6 to 7; no accepted phase is retired or broadened.

## System boundary

The active boundary is `serialized UTF-8 bytes -> writer lifecycle` and
`private-file key/byte count -> aggregate staging tracker`. It does not cross
SQLite, reader sessions, conversion planning, native publication, filesystem
identity, CLI command handling, rendered UI, or package-release boundaries.

## Review and next increment

The package is ready for `plan-reviewer-a` after the validator passes (confirmed:
`Validated execution contract cdb-to-json-recovery-increment-2 revision 7 with 1 phase(s).`).
After contract approval, one implementer may address only the five active paths;
the entire `tests/cli/conversionLifecycle.test.ts` candidate remains deferred.
The reviewer must report exact paths reviewed, actual commands and counts,
every criterion result including `P1-AC10` through `P1-AC14` and `P1-AC16`
through `P1-AC21`, blocking findings, and the next increment. Only an approval permits
a separate logical commit; the deferred mixed tree remains uncommitted. The
next dependency order is application conversion lifecycle, then real native
secure publication, then inspect/validate/schema wiring.
