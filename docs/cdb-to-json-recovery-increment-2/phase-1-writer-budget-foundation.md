# Phase P1 — writer-neutral boundary and staging budget

## Goal and dependency boundary

Deliver a reviewable byte-writer foundation and exact aggregate reservation
accounting without wiring either into conversion. Increment 1's schema commit
`0ff06c8` is the repository baseline; this phase has no runtime dependency on
Phase 4 native publication or Phase 5 command services.

This phase is independently dispatchable. The implementer should read this
document, the matching JSON phase, `outputWriter.ts`, `stagingBudget.ts`, the
nearest serializer callback types, and the two focused writer/budget test files.
Do not reinterpret the complete publication plan or the mixed status as an
implementation request.

## Repository grounding at revision 7

The predecessor handoff named `6cfb9bc`, but accepted commits `16d28cf` and
`0ff06c8` landed afterward. Direct verification for this planning visit gives
`HEAD=origin/publish=0ff06c8a4dc4994852112ebde59b1c35409f6eff`; this is the
active baseline, while `6cfb9bc` is historical only.
The five implementation paths are exactly:

- `src/serialization/outputWriter.ts` (untracked writer-neutral candidate);
- `src/application/stagingBudget.ts` (tracked candidate with incorrect
  zero-sentinel reconciliation/release behavior and a `void`-returning
  `reconcile` that hides over-limit rejections);
- `src/serialization/index.ts` (tracked export candidate that does not yet
  re-export the `OutputWriterOptions` interface);
- `tests/cli/serialization.test.ts`;
- `tests/cli/stagingReservations.test.ts`.

The working tree also contains deferred conversion behavior/orchestration,
native/publication, inspect/validate, process, fixture, and status-prose paths.
The complete classification is in `docs/cdb-to-json-recovery-increment-2/spec.md`.
Before implementation, snapshot the complete status, binary diffs, and per-path
hashes outside the repository. At handoff, preserve the exact deferred
implementation set from that spec byte-for-byte and status-for-status; do not
reset, clean, stage, commit, or push those paths. HEAD and origin/publish must
remain unchanged. The recovery documents themselves are plan artifacts and
are not part of the five-path implementation allowlist. The entire
`tests/cli/conversionLifecycle.test.ts` candidate is deferred and excluded from
this phase; it must be contracted separately before any conversion-lifecycle
behavior is reviewed.

The unfixed source confirms the writer/budget contract requirements are unmet
before the implementer starts:

1. `OutputWriterOptions` is not declared or exported anywhere.
2. Each adapter's constructor takes a bare `reserve` callback rather than the
   named `OutputWriterOptions` interface.
3. `_reconcile` is never assigned or invoked, so the `reserve -> sink ->
   reconcile` event order is impossible to observe in tests.
4. `close()` does not call `flush()`; commitment happens before the flush
   resolves.
5. `StagingBudget.reconcile` returns `void`, hiding the over-limit rejection
   required by `P1-AC9` and `P1-AC13`.
6. `StdoutOutputWriter.flush()` is a no-op, so the close path cannot detect a
   broken injected Writable.

These are binding gaps, not stylistic preferences. Revision 7 retains the
adapter-specific ordering proof, failure-path coverage, terminal flush matrix,
and stdout isolation sentinel, while resolving the prior path-boundary defect
by removing the entire conversionLifecycle candidate from this phase. It also
adds source inspection proving that stdout has no hidden private
`StagingBudget`, and criterion P1-AC21 proving mixed-tree preservation and the
pre-review no-commit gate.

## Frozen implementation decisions

All decisions below are binding in `execution-contract.json` (`INV-002` through
`INV-007`, `P1-AC2` through `P1-AC14`, `P1-AC16` through `P1-AC21`). Revision 7
resolves the conversionLifecycle path-boundary defect and the three subsequent
review findings; the file is wholly deferred and no constructor migration is
active here.

### Writer API and callback proof

Declare and export:

```ts
export type WriterState = "OPEN" | "CLOSED" | "ABORTED";

export interface OutputWriterOptions {
  reserve?: (bytes: number) => boolean;
  reconcile?: (bytes: number) => void;
}
```

`OutputWriter` remains asynchronous over encoded `Uint8Array` chunks and
exposes `write`, `flush`, `close`, `abort`, `committed`, `state`, and
`bytesWritten`. Constructor shapes are exactly:

- `new TestOutputSink(options?: OutputWriterOptions)`;
- `new CallbackOutputWriter(writeFn: (data: string) => void, options?: OutputWriterOptions)`;
- `new StdoutOutputWriter(stream: Writable, options?: OutputWriterOptions)`.

Only the last adapter may accept an injected `Writable`. No adapter accepts a
path, descriptor, native handle, or filesystem operation. The
`JsonLinesWriterOptions` and `JsonArrayWriterOptions` interfaces are unrelated
and remain in their own files.

`src/serialization/index.ts` must re-export `OutputWriter` (interface),
`WriterState` (type), `OutputWriterOptions` (interface), and the three adapter
classes. The `TestOutputSink`, `CallbackOutputWriter`, and `StdoutOutputWriter`
classes must take the named `OutputWriterOptions` argument, not a bare
`reserve` callback.

For each write, calculate `bytes = chunk.byteLength` and record this order:

1. verify `OPEN`;
2. call `reserve(bytes)` if configured;
3. if it returns false, reject with the resource-limit error without calling
   the sink, reconciliation callback, or incrementing `bytesWritten`; the
   writer remains `OPEN`;
4. perform the underlying sink effect;
5. after sink success, call `reconcile(bytes)` once if configured;
6. increment `bytesWritten` by `bytes` only after reconciliation returns; and
7. if the sink fails, the sink effect before that failure remains at zero
   bytes written; if a later reconciliation callback throws, the writer
   transitions to `ABORTED` and `bytesWritten` keeps its pre-write value even
   if the sink externally accepted the bytes.

Tests must use `TextEncoder`/`Uint8Array` and adapter-appropriate observable
proof rather than merely checking callback invocation. Unicode proves that byte
length is not JavaScript string length. CallbackOutputWriter uses its injected
write callback as the sink event, and StdoutOutputWriter uses a Writable
`write` spy plus the callback events, so those traces are `reserve`, `sink`,
`reconcile`. TestOutputSink has no sink callback in the frozen
`OutputWriterOptions` interface; its test records `reserve` and `reconcile` and
asserts from inside reconcile that the expected chunk is already present in
`chunks`/`chunkCount`. A rejection sequence has no sink or reconcile effect.
The same byte/order semantics apply to all three adapters without adding a
third options member or changing TestOutputSink's constructor.

### Flush, close, abort, and failure states

- `OPEN` permits write and flush. `ABORTED` rejects write/flush/close. `CLOSED`
  permits only idempotent close/flush and rejects write; abort after close is a
  no-op that cannot revoke commitment.
- `close` must perform/await a successful `flush` before changing state to
  `CLOSED` and `committed=true`. If `flush()` rejects on the close path, the
  writer transitions to `ABORTED` with `committed=false` and the error is
  propagated. Close is idempotent after `CLOSED`.
- A sink, flush, or reconciliation failure cannot produce commitment and
  leaves the writer `ABORTED`; abort remains safe/idempotent for cleanup.
- Callback and in-memory adapters may implement flush as a resolved no-op when
  the underlying sink is satisfied and the writer is healthy. Each successful
  stdout `write` must register its Writable completion callback;
  `StdoutOutputWriter.flush()` must await every pending write callback plus any
  required drain/finish signal, reject on an observed callback or stream error,
  and return immediately for `CLOSED` without installing listeners or changing
  commitment. Stdout is non-atomic: accepted earlier bytes are not rolled back.

Tests must cover write/flush after both terminal states for all three adapters,
close-after-abort, abort-after-close, repeated same-terminal operations,
callback and injected-stream sink failure, direct close-path flush failure,
reconciliation failure, a delayed Writable write callback even when
`write()` returns true, CLOSED flush stability, and explicit stdout flush
backpressure through an error-emitting Writable. The close-failure proof must
invoke `close()` directly against the failing stream rather than calling
`flush()` separately. They must assert state, commitment, and the pre-failure
byte count, not just rejection text.

### StagingBudget semantics

- `reserve(path, bytes <= 0)` returns true, changes no aggregate bytes, and
  creates no entry. Check for an existing active key first: a duplicate active
  key is rejected without mutating its original entry even when the duplicate
  request is non-positive.
- A positive reservation creates exactly one entry and is rejected without
  mutation when the aggregate limit would be exceeded.
- `reconcile(path, actualBytes): boolean`. After a positive reservation,
  reconcile to `0` subtracts the reservation; later growth is measured from
  `0`. Repeated reconciliation uses the latest actual amount. Unknown-key
  reconciliation is a no-op and returns `true`. A candidate whose aggregate
  would exceed `maxBytes` returns `false`, emits `RESOURCE_LIMIT_EXCEEDED`
  through the `DiagnosticCollector` if provided, and preserves the prior entry
  and aggregate amount. The caller must abort/treat this as a resource failure.
- Release subtracts the latest reconciled amount when reconciliation occurred,
  otherwise the original reservation; it deletes the entry. Repeated/unknown
  release is a no-op.

Tests must prove duplicate ownership, non-positive requests, zero actual,
repeated reconciliation in both directions, exact release, aggregate reserve
limits, over-limit reconciliation rejection returning `false` with diagnostic
emission, and an explicit TypeScript-level signature check.

### Stdout staging isolation

The default stdout adapter is non-atomic and does not capture or mutate a
private `StagingBudget`. Its optional `reserve` callback is only a caller-owned
per-output limit. The focused tests must construct an independent `const
privateBudget = new StagingBudget(0)` sentinel, write/close through a default
stdout adapter, and assert that the sentinel's `currentBytes` remains zero. A
separate explicit-reserve case must prove per-output rejection before
`stream.write`. Because that independent sentinel cannot detect a secretly
constructed second budget, source inspection must also prove that
`outputWriter.ts` has no `StagingBudget` import or instantiation, hidden
aggregate/private-budget tracker, or filesystem dependency, and that stdout
uses only the injected Writable and supplied callbacks. A separate stdout
flush-failure case must write to a Writable that emits an error and call
`close()` directly, observing the state transition `OPEN -> ABORTED` with
`committed=false` and no byte-counter advance after the close path's flush
rejects.

## Revision-5 review closure (historical findings retained)

The revision-3 plan-review report identified two package contradictions, and the
follow-up review identified one observability contradiction plus three missing
verification proofs. This phase document follows the JSON contract's exact
resolutions:

- **Reconcile failure (`INV-003`, `INV-004`, `P1-AC3`, `P1-AC11`):** the
  behavioral order is `reserve -> sink -> reconcile -> bytesWritten`.
  `bytesWritten` advances only after reconciliation returns. If reconciliation
  throws, the sink may have accepted external bytes, but the writer becomes
  `ABORTED`, remains uncommitted, and the counter stays at its pre-write value.
  The proof is adapter-specific: TestOutputSink's reconcile callback inspects
  the already stored chunk; CallbackOutputWriter and StdoutOutputWriter expose
  their sink effects directly to the recorder. `OutputWriterOptions` remains
  exactly the two-member reserve/reconcile interface.
- **Historical callsite decision (`INV-001`, `INV-002`, `P1-AC1`, `P1-AC2`, `P1-AC6`, `P1-AC15`):** revision 4 temporarily admitted `tests/cli/conversionLifecycle.test.ts` for a constructor-only migration. Revision 6 supersedes that decision: the candidate is wholly deferred, P1-AC15 is retired, and no conversion-lifecycle path is eligible for this phase.

### Follow-up review closure (revision 4 -> revision 5; retained)

- **TestOutputSink sink-event contradiction (`INV-002`, `INV-003`, `P1-AC3`,
  `P1-AC11`):** the prior criteria demanded a literal `reserve -> sink ->
  reconcile` event trace from all three adapters, but TestOutputSink has no
  sink callback and the frozen options interface cannot gain one. Revision 5
  removes that impossible proof. TestOutputSink now proves sink-before-reconcile
  by inspecting `chunkCount`/`chunks` inside reconcile; CallbackOutputWriter
  and StdoutOutputWriter retain direct sink event traces through their existing
  injected sink boundaries. No API expansion or source-file escape is allowed.
- **Missing failure and isolation proofs (`P1-AC4`, `P1-AC7`, `P1-AC12`,
  `P1-AC14`):** revision 5 adds `P1-AC16` for injectable callback/stream sink
  failures, `P1-AC17` for a direct `close()` call against an error-emitting
  Writable, `P1-AC18` for the OPEN/CLOSED/ABORTED flush matrix across all three
  adapters, and `P1-AC19` for an independently constructed
  `StagingBudget(0)` stdout isolation sentinel. These are executable blocking
  proofs rather than inferred coverage from generic lifecycle prose.

## Revision-6 closure of P1-F-004

The post-implementation review classified P1-F-004 as a planning defect: the
contract admitted `tests/cli/conversionLifecycle.test.ts` as a path while
allowing only a hunk-level constructor migration, but the candidate is an
untracked 449-line file containing 23 simulated conversion-lifecycle tests.
That boundary is not reviewable as a path-level implementation increment.
Revision 6 resolves the defect without accepting any of that behavior: the
contract now has exactly five active paths, removes the conversionLifecycle
file from `known_paths`, retires P1-AC15, and adds P1-AC20 requiring the entire
candidate to remain outside the proposed P1 patch. A future conversion-lifecycle
phase must contract that file and its behavior independently.

The three implementation/verification findings remain active under the same
phase: P1-F-001 (Stdout flush must await actual pending write completion and
remain stable after CLOSED), P1-F-002 (CLOSED flush must not revoke commitment),
and P1-F-003 (adapter-specific sink-order evidence). Their corrections map to
P1-AC3, P1-AC4, P1-AC11, P1-AC12, P1-AC14, P1-AC16, P1-AC17, P1-AC18, and the
focused tests named by the JSON contract.

## Revision-7 closure of plan-reviewer-a findings

- **P1-F-005 (stale baseline):** the predecessor handoff's `6cfb9bc` snapshot
  predates accepted commits `16d28cf` and `0ff06c8`. Revision 7 records this
  temporal distinction and uses direct verification of
  `HEAD=origin/publish=0ff06c8` as the active baseline. The implementer and
  reviewer must re-run the ref check; the historical goal text remains
  unchanged.
- **P1-F-006 (mixed-tree preservation/no-commit):** new blocking P1-AC21 names
  the exact deferred implementation set and requires an outside-repository
  status/diff/hash snapshot before dispatch and an identical status/hash
  comparison at handoff. It also requires unchanged local and remote refs,
  empty staged paths, and no commit or push before implementation review.
  Deleting, rewriting, cleaning, or publishing deferred work is an escalation.
- **P1-F-007 (stdout isolation):** the runtime zero-limit sentinel remains,
  but P1-AC7/P1-AC19 and INV-006 now also require source inspection proving
  that `outputWriter.ts` has no StagingBudget import/instantiation, hidden
  aggregate/private-budget tracker, or filesystem dependency; stdout uses only
  the injected Writable and caller-supplied callbacks.

## Implementation sequence

1. Outside the repository, snapshot the complete mixed-tree status, binary diffs, and per-path hashes; verify `HEAD=origin/publish=0ff06c8` and the exact deferred implementation set. Preserve that set byte-for-byte and status-for-status, do not reset or clean unrelated changes, and do not stage, commit, or push. Do not edit or add `conversionLifecycle.test.ts`; it is a deferred candidate outside this phase.
2. Declare `OutputWriterOptions` in `src/serialization/outputWriter.ts` with
   exactly two optional members, change each adapter constructor to take that
   named argument, and re-export `OutputWriter`, `WriterState`,
   `OutputWriterOptions`, and the three adapters from
   `src/serialization/index.ts`.
3. Implement all three adapters with identical byte accounting,
   reservation/reconciliation ordering, flush-before-close, terminal-state,
   and failure semantics. Keep stdout's `Writable` use at that edge only;
   register each write completion callback and make `StdoutOutputWriter.flush()`
   await all pending callbacks plus required drain/finish state, reject on
   observed error, and remain a no-op after CLOSED.
4. Correct `StagingBudget` with the explicit `boolean` reconcile return,
   duplicate-first checks, non-positive no-op semantics, atomic over-limit
   reconciliation rejection, diagnostics, and exact release.
5. Extend the two active focused suites with executable cases for adapter-specific callback/sink order, TestOutputSink chunk inspection, Unicode bytes, reservation rejection, injectable sink failure, direct stdout close-path flush failure, reconciliation failure, the OPEN/CLOSED/ABORTED flush matrix for every adapter, the independent zero-limit stdout sentinel, duplicate keys, non-positive requests, zero actuals, repeated reconciliation, exact release, and over-limit reconcile. Do not edit or add `conversionLifecycle.test.ts` and do not treat its simulated conversion behavior as P1 evidence.
6. Run the focused suite and required repository gates. Inspect the final
   proposed path list before handoff; do not include conversion orchestration,
   status prose, or Phase 4/5 candidates.

## Evidence design and criterion links

- `OutputWriterOptions` interface declaration, exact members, and
  `serialization/index.ts` re-export: `INV-002`, `P1-AC2`, `P1-AC10`.
- Adapter-specific reservation/sink/reconciliation ordering and byte
  accounting: `INV-003`, `P1-AC3`, `P1-AC11`.
- Flush-before-close, sink/flush/reconciliation failure, and monotonic
  terminal commitment: `INV-004`, `P1-AC4`, `P1-AC12`, `P1-AC16`, `P1-AC17`,
  `P1-AC18`.
- `StdoutOutputWriter.flush()` pending-write completion, CLOSED stability, and
  rejection on injected error: `INV-004`, `P1-AC14`.
- Normal reservation, duplicate ownership, zero actual, repeated reconcile,
  release, and `boolean` reconcile type: `INV-005`, `P1-AC5`, `P1-AC13`.
- Default stdout private-staging isolation: `INV-006`, `P1-AC7`, `P1-AC19`,
  including binding source inspection.
- Non-positive requests and over-limit reconcile: `INV-007`, `P1-AC8`,
  `P1-AC9`.
- Path isolation, current baseline, conversionLifecycle exclusion, mixed-tree
  preservation, and all repository gates: `INV-001`, `P1-AC1`, `P1-AC6`,
  `P1-AC20`, `P1-AC21`.

## Required verification

Focused:

```bash
npx vitest run tests/cli/serialization.test.ts tests/cli/stagingReservations.test.ts
```

The focused proof must include adapter-specific ordering (TestOutputSink
chunk/chunkCount inspection inside reconcile; direct sink traces for callback
and stdout), injected callback/stream sink failures, a direct stdout
`close()` against an error-emitting Writable, the OPEN/CLOSED/ABORTED flush
matrix for every adapter, and the independent `StagingBudget(0)` sentinel.
The reviewer must also inspect `outputWriter.ts` for the absence of a private
StagingBudget/aggregate tracker and verify the outside-repository preservation
snapshot and no-stage/no-commit/no-push gate.

Repository gates:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
npm test -- --reporter=dot
```

Record actual test files/counts and the unsupported-native manifest branch. A
timeout is not a passing result. The reviewer must inspect the proposed
implementation path list against `known_paths` and the full mixed-tree status.
The validator at `/home/lynellf/.pi/roles/validate-execution-contract.py`
must return a positive status against
`docs/cdb-to-json-recovery-increment-2/execution-contract.json` before
implementer dispatch resumes. The planner ran
`python3 /home/lynellf/.pi/roles/validate-execution-contract.py docs/cdb-to-json-recovery-increment-2/execution-contract.json`
and received exactly: `Validated execution contract cdb-to-json-recovery-increment-2 revision 7 with 1 phase(s).`

## Rollback and escalation

Rollback is path-local: remove or revert only the writer boundary, its exports, budget changes, and focused tests, leaving the P1 schema commit and all deferred working-tree candidates byte-for-byte and status-for-status untouched. Preserve the outside-repository snapshot and do not commit or push during rollback. The conversionLifecycle candidate remains outside rollback because it is not part of this phase. Escalate instead of editing if the
phase requires `convertCatalog.ts`, output-plan changes,
`JsonLinesWriter`/`JsonArrayWriter` source edits, a destination/native API, a
new diagnostic policy, or CLI `maxOutputBytes` wiring. Findings about
`JsonLinesWriter` or `JsonArrayWriter` belong to a separate phase and must not
block this contract's review.
