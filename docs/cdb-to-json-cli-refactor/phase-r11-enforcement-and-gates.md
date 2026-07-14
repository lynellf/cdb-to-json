# Revision-12 remediation phase — enforcement, rollback integrity, and phase gates

## Status and scope

This is a targeted remediation of the Revision-11 tactical package after the
independent plan-reviewer-b re-verification. It does not reopen the profile
matrix, frozen schema identifiers, raw fixed-column boundary, or the senior
D1–D8 decisions. It makes the four R11 closures executable and adds the legacy
publication and dispatch controls that the re-verification found missing.

The implementation must not be routed to P3/P4 until the P1/P2 acceptance gates
and the focused tests in this phase pass. Existing partial Phase-2/3 code and
historical evidence are scaffolding only; `docs/implementation/current.md` is
not acceptance evidence.

## Consolidated reviewer findings (verbatim)

> **REQUEST-CHANGES:** targeted R11 wording closes the four prior findings on
> paper, but adversarial re-verification finds residual enforcement,
> rollback-integrity, and phase-gate gaps that must be corrected before
> implementation routing.

The blocking findings are:

1. **B-REVERIFY-1R — descriptor-safe source acquisition.** R11.1 names held
   parent/member descriptors, `O_NOFOLLOW`, `fstat`, and copy/hash from the
   descriptor, but does not specify the absolute/relative path-resolution
   algorithm or require post-copy re-hash from the same held descriptor. The
   named member-swap test does not require a parent-component replacement or
   same-inode byte-mutation adversary.
2. **B-REVERIFY-3R — snapshot/materialization budget enforcement.** R11.3
   names a dedicated counter and chunk-level reserve/reconcile, but
   `VACUUM INTO` and SQLite-generated private files have no concrete write
   boundary. An injected reservation-event test could pass while real SQLite
   writes cross the selected limit.
3. **B-REVERIFY-4R — rollback integrity and crash recovery.** R11.4 names a
   journal, reverse rollback, force backups, and retained recovery state, but
   does not identity-guard rollback, specify durable journal/backup ordering or
   process-crash behavior, or test inter-final external mutation and
   interruption/recovery.
4. **B-GATE-1 — phase integrity and verification.** The machine contract keeps
   P1/P2 checkpoint-complete-but-not-contract-accepted with no completed phase
   IDs, while `docs/implementation/current.md` claims Phase 2 and a Phase-3
   writer/budget increment are complete. `test:cli` is broader than the
   documented pre-P3 scope, and `test:normalization`, `test:source`, and
   `test:streaming` use `--passWithNoTests`, allowing absent suites to report
   green.
5. **B-LEGACY-PUB-1 — legacy publication security.** The current legacy writer
   uses recursive path `mkdir`, path-derived temporary names, path `rename`, and
   a cross-device `copyFile` fallback. The plan does not freeze no-follow parent
   traversal, descriptor-relative temp/lock/force replacement, or identity
   checks for this user-controlled `outputDir` boundary.

No finding is rejected. The exact evidence and smallest corrections above are
preserved so a later reviewer can verify each closure independently.

## Decisions that supersede earlier wording

### R12.1 Source path resolution and held-descriptor verification

`src/cdb/sourceHandle.ts` MUST use this algorithm for both absolute and relative
input paths:

1. For an absolute path, acquire the platform root/anchor descriptor using the
   declared no-symlink primitive. For a relative path, open the process working
   directory once as the anchor descriptor. Split the path into components and
   traverse every component with descriptor-relative no-follow directory opens
   (`openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)` on the Linux capability
   path, or the platform's equivalent held-handle primitive). After the anchor
   is acquired, no operation may resolve an unchecked string through `AT_FDCWD`.
2. Hold the final parent directory descriptor. Observe `main`, `-wal`, and `-shm`
   with `fstatat(..., AT_SYMLINK_NOFOLLOW)` from that descriptor. An absent
   member contributes the explicit `{present:false, bytesBase64:null}` tuple
   entry; a symlink or non-regular member fails closed.
3. Open each observed member from the held parent descriptor with
   `O_RDONLY | O_NOFOLLOW | O_CLOEXEC` (or the equivalent). Keep that member FD
   open through the complete copy and hash. Compare `dev`, `ino`, regular-file
   mode, and observed size from `fstat` before copying. Copy and hash with
   `read`/`pread` on that FD only; path-based copy and path reopen are forbidden.
4. After the copy, rewind/read the same held FD again to compute a second digest
   and re-`fstat` it. The post-copy digest, size, regular mode, and identity must
   equal the pre-copy observation. Recheck sidecar presence and parent identity
   from held descriptors before any SQLite open. A parent replacement, same-inode
   content/size mutation, member appearance/disappearance, identity mismatch, or
   unstable second digest emits `SOURCE_MUTATED_DURING_READ`, closes every FD,
   and deletes private state. It never consumes replacement bytes.
5. Keep the source parent/member descriptors until the copied bundle's
   verification is complete. The extraction connection may open only the
   materialized private main URI. If the platform lacks a safe held-handle
   primitive, return `INVALID_PATH` with `details.reason:
   "UNSUPPORTED_SOURCE_TRAVERSAL"` before SQLite rather than using a path copy.
   Stdout is cross-platform as a destination; it is not a promise that an
   unsafe source filesystem can be read.

Add `tests/reader/sourceParentSwap.test.ts` and
`tests/reader/sourceSameInodeMutation.test.ts` (or combine them into
`sourceMemberSwap.test.ts` without weakening coverage). They must cover
absolute and relative input paths, replacement of a parent component after its
FD is held, mutation through the original inode while copying, all three
members, replacement symlinks, no replacement-target bytes in the copied
bundle, stable diagnostics, and complete cleanup.

### R12.2 Enforceable materialization quota

The implementation MUST NOT describe post-operation inventory or injected
budget callbacks as pre-write enforcement. Add
`src/cdb/materializationQuota.ts` and make it an admission gate before opening
the private copied bundle for any write or before invoking `VACUUM INTO`.

The quota module performs a read-only format preflight over the copied bundle and
computes a finite upper bound for every private file SQLite may create:

- target materialized-main bytes from the validated page size, current main page
  count, and the highest committed WAL frame page number;
- rollback journal bytes from the maximum changed-page count plus the SQLite
  journal header bound;
- WAL/SHM bytes from the validated frame/index counts and their fixed headers;
- SQLite temporary sibling bytes from the selected temp-store mode and the same
  validated page/frame bounds; and
- a fixed checked header/slack allowance for the pinned SQLite build.

The formulas and their file-format proof are documented in
`docs/cdb-to-json-cli-refactor/materialization-quota.md`. Unknown page sizes,
malformed WAL headers/checksums, overflow in the checked arithmetic, or an
unprovable SQLite version fails closed as `CDB_OPEN_FAILED`; the implementation
must not guess a bound. A generated sparse/high-page WAL fixture proves that a
small source bundle can have a large materialized bound and is rejected before
any writable SQLite operation.

`sourceHandle` acquires one reservation for the complete calculated bound before
opening the copied bundle writable. The reservation is charged once against
`maxSnapshotBytes` and once against `maxStagingBytes`; the same physical file is
not charged twice inside either counter. SQLite's internal writes are accepted
only when the bound fits the remaining counters, so no generated file can cross
the selected budget. After materialization, every observed private file is
reconciled against its bound and actual size; an unexpected file or size is a
fatal `RESOURCE_LIMIT_EXCEEDED` cleanup path, never a successful conversion.
The quota reservation is released only after all private SQLite handles and
sidecars are closed.

The real gate is not an injected event alone. Add
`tests/reader/materializationQuota.test.ts` with:

- an under-bound real WAL materialization proving the committed WAL-only row is
  extracted and all actual files stay within their pre-reserved bounds;
- a sparse/high-page or page-count fixture whose calculated bound exceeds the
  selected limit, proving `VACUUM INTO` is never invoked and no private write
  occurs;
- a generated-private growth case that exercises actual SQLite materialization
  and checks every file against its bound; and
- success, error, cancellation, and cleanup assertions for both snapshot and
  staging counters.

`tests/reader/stagingSnapshotBudget.test.ts` may retain injected reserve,
reconcile, and release vectors, but those are supplementary evidence and cannot
be the only proof of R12.2. If the bound cannot be derived for a supported
SQLite format, the implementation must stop and fail closed rather than claim
that `maxSnapshotBytes` is enforced.

### R12.3 Identity-guarded durable commit-set recovery

Add `src/destinations/commitJournal.ts` and
`src/destinations/recoverCommitJournal.ts`. The descriptor-relative journal is
canonical JSON with a version, run token, trusted-root identity, ordered final
relative names, reservation tokens, stage identities, prior-final identities,
force-backup identities, and one state per final:
`PLANNED`, `BACKUP_DURABLE`, `PUBLISHED`, `ROLLED_BACK`, or `RECOVERY_REQUIRED`.
Each identity includes device, inode, type, size, and a SHA-256 of the exact
staged/final bytes where a regular file is involved.

The durable ordering is fixed:

1. Reserve every final and create/write the complete `PLANNED` journal through
   the held root descriptor; `fsync` the journal and then the parent directory.
2. For force replacement, create the descriptor-relative backup, verify and
   record its identity, `fsync` the backup and parent, then mark
   `BACKUP_DURABLE` and `fsync` the journal.
3. Publish one stage at a time with descriptor-relative no-replace or force
   rename. `fsync` the published file/directory and parent, record its complete
   identity, mark `PUBLISHED`, and `fsync` the journal before proceeding.
4. On success mark the journal committed, `fsync` it and the parent, then remove
   backups/journal only after every final is durable. Cleanup is identity-checked
   and idempotent.

Rollback may remove a no-force final only when its current identity exactly
matches this run's recorded published identity. It may restore a force backup
only after the current final matches the recorded published identity and the
backup matches the recorded backup identity. If a final is missing or differs,
rollback does not remove or overwrite it; it marks that entry
`RECOVERY_REQUIRED`, retains the journal/backups/locks, and returns exit 6.
The same identity guard applies to stage and backup cleanup.

A process interruption is not silently treated as success. On the next
conversion or explicit recovery inspection, an orphaned non-committed journal
is detected before destination adoption. The operation refuses with
`OUTPUT_RECOVERY_REQUIRED` (exit 6), reports the exact trusted-root-relative
journal and affected finals, and leaves artifacts untouched. A committed
journal is safe to finish-clean only after identity checks. No automatic
rollback crosses an external mutation; the documented atomicity claim is
therefore exact for process-detectable failures and has explicit refusal/recovery
semantics for crashes or external interference.

Extend `tests/cli/commitSetRollback.test.ts` and
`tests/cli/commitSetRecovery.test.ts` with:

- an inter-final external replacement/mutation for no-force and force, proving
  the unexpected identity is never deleted or overwritten;
- a rollback failure that retains journal/backups and refuses a rerun;
- a child-process interruption after journal creation, after a force backup, and
  after one publication, followed by a fresh-process orphan-journal refusal;
- journal/backup fsync ordering assertions through the native test seam; and
- a successful rerun only after explicit recovery cleanup, with no stale lock or
  unrelated final touched.

### R12.4 Legacy publication uses the hardened boundary

`src/compatibility/legacyOutput.ts` is a compatibility adapter, not a security
exception. It MUST use the same Linux Node 22+ native capability matrix and
held-root/no-follow descriptor ABI as modern file output:

- create a missing output directory only through descriptor-relative no-follow
  `mkdirat`/equivalent operations, then hold its parent descriptor;
- create the lock and sibling temporary through descriptor-relative exclusive
  named opens; write and fsync the temporary;
- verify the prior final identity, perform force replacement only while the
  lease is held, fsync the final and parent, and remove the temporary/lock in
  `finally`; and
- preserve the prior final when any read, integer conversion, writer,
  cancellation, identity, or publication step fails.

Recursive path `mkdir`, path-derived temp names, path `rename`, and cross-device
`copyFile` fallback are forbidden. On a host/filesystem without the capability,
an output-bearing legacy call fails before creating the output directory with
`UNSAFE_DESTINATION_FILESYSTEM`; return-only legacy calls remain available.
The bridge wraps the original v1 error boundary exactly as already documented.

Add `tests/compatibility/legacyOutputSecurity.test.ts` for output-directory
symlinks, parent replacement, final replacement races, cross-device/unsupported
capability refusal, repeated writes, injected failure preservation, and cleanup.
Update `tests/compatibility/legacy-output.test.ts` to prove the same support
matrix and no path fallback; do not exempt legacy output from the native gate.

### R12.5 Phase-dispatch and authoritative gate corrections

Update `docs/implementation/current.md` so every Phase-2/3 completion claim is
explicitly `SCAFFOLDING — UNACCEPTED` while P1/P2 remain blocked. Historical
command counts may be retained only under a clearly labeled non-evidence
heading; they must not say that a phase gate passed.

Update `package.json` and its lockfile-independent scripts as follows before
implementation routing:

- `test:cli` is the pre-P3 list
  `tests/cli/exitCodes.test.ts tests/cli/limitRelations.test.ts
  tests/cli/nativeCapabilityCleanup.test.ts`; P3 may expand the same script only
  after P2 acceptance;
- `test:reader`, `test:compat`, and `test:api` name the required P2 files,
  including the source-parent/mutation, materialization-quota,
  extra-table-limit, and legacy-security tests; a missing named file fails the
  command;
- `test:normalization`, `test:source`, and `test:streaming` remove
  `--passWithNoTests`; an absent required suite is a failure; and
- add `phase:dispatch:p3` and `phase:dispatch:p4`, both invoking
  `scripts/phase-dispatch-check.mjs` with the target phase.

Create `scripts/phase-dispatch-check.mjs`. It must read
`execution-contract.json`, require all blocking P1/P2 criteria and the R12
focused evidence record, verify that every named test file and script exists,
reject `passWithNoTests` in authoritative scripts, and run the exact P1/P2
commands before allowing P3/P4. It writes a machine-readable
`docs/cdb-to-json-cli-refactor/evidence/p1-p2-gate.json` containing command,
exit status, test-file inventory, build identity, and timestamp. A stale or
missing record, a status claim that contradicts the machine contract, or a
missing named artifact exits nonzero. No implementer may use a later-phase test
as evidence for P1/P2.

## Ordered implementation tasks

### Task R12.1 — Freeze status, scripts, and dispatch guard

**Files:** `docs/implementation/current.md`, `package.json`,
`scripts/phase-dispatch-check.mjs`, `docs/cdb-to-json-cli-refactor/execution-contract.json`.

Change status and scripts first, add the guard, and update the machine contract
revision/source artifact list with this phase. Verify the guard fails closed
against the current stale status and absent named tests.

**Verify:** `node scripts/phase-dispatch-check.mjs P3` (must fail before the
remaining tasks), `git diff --check`, and JSON parsing of the contract.

### Task R12.2 — Implement descriptor-safe source lifecycle

**Files:** `src/cdb/sourceHandle.ts`, `src/cdb/snapshotBundle.ts`,
`src/cdb/materializeSnapshot.ts`, `src/cdb/openDatabase.ts`,
`tests/reader/sourceMemberSwap.test.ts`, `tests/reader/sourceParentSwap.test.ts`,
`tests/reader/sourceSameInodeMutation.test.ts`.

Implement the held absolute/relative anchors, held member FDs, same-FD second
digest/fstat, private WAL materialization, immutable extraction, and idempotent
cleanup. Preserve the fixed tuple hash and all prior reader contracts. Do not
claim the snapshot budget gate yet; that is the next task.

**Verify:**
`npm run test:reader -- tests/reader/sourceMemberSwap.test.ts tests/reader/sourceParentSwap.test.ts tests/reader/sourceSameInodeMutation.test.ts`
and `npm run build`.

### Task R12.3 — Enforce the real materialization quota

**Files:** `src/cdb/materializationQuota.ts`, `src/cdb/materializeSnapshot.ts`,
`src/application/stagingBudget.ts`, `tests/reader/materializationQuota.test.ts`,
`tests/reader/stagingSnapshotBudget.test.ts`,
`docs/cdb-to-json-cli-refactor/materialization-quota.md`.

Implement the checked page/WAL-derived bound and reserve the complete bound
before writable SQLite work. Reconcile every generated private file against its
admitted bound and preserve cleanup on success, failure, and cancellation.
Injected reservation events supplement the real SQLite under/over-bound vectors;
they cannot replace them.

**Verify:**
`npm run test:reader -- tests/reader/materializationQuota.test.ts tests/reader/stagingSnapshotBudget.test.ts`
and `npm run build`.

### Task R12.4 — Harden legacy output

**Files:** `src/compatibility/legacyOutput.ts`,
`tests/compatibility/legacyOutputSecurity.test.ts`,
`tests/compatibility/legacy-output.test.ts`, `src/legacy.ts`.

Route only the legacy replacement operation through the hardened adapter and
preserve the v1 emit/output/error matrix. Do not import the legacy adapter into
modern profile writers.

**Verify:** `npm run test:compat` and the parent/symlink race test in the named
security suite.

### Task R12.5 — Implement durable identity-guarded commit recovery

**Files:** `src/destinations/commitJournal.ts`,
`src/destinations/recoverCommitJournal.ts`,
`src/destinations/nativeAdapter.ts`,
`native/secure-destination/src/secure_destination.cc`,
`native/secure-destination/src/secure_destination.h`,
`tests/cli/commitSetRollback.test.ts`, `tests/cli/commitSetRecovery.test.ts`.

Implement the journal state machine, fsync order, identity-checked rollback,
orphan refusal, and recovery diagnostics before enabling the modern no-continue
multi-output claim. Keep capability failure as `UNSAFE_DESTINATION_FILESYSTEM`
and never add a path fallback.

**Verify:**
`npm run test:cli -- tests/cli/commitSetRollback.test.ts tests/cli/commitSetRecovery.test.ts`
and `npm run package:check` on supported and unsupported manifest vectors.

### Task R12.6 — Re-prove schemas and gates, then dispatch

**Files:** `schemas/ygo.card-source.v1.schema.json`,
`schemas/ygo.card-source-array.v1.schema.json`,
`tests/conformance/schemaValidation.test.ts`, all named source goldens,
`docs/implementation/current.md`, and the evidence record generated by the
dispatch guard.

Implement the already-accepted R11.2 schema shape rather than treating the
current stale `text.spans`/`begin` schema as evidence. Run the full P1/P2 gate,
record the result, and only then permit P3.

**Verify (exact order):**

```bash
npm run build:native && npm run build && npm run package:check
npm run test:fixtures
npm run test:unit
npm run test:reader
npm run test:api
npm run test:compat
npm run test:cli
npm run test:conformance
npm test
npm run phase:dispatch:p3
```

Every command must exit zero; a missing suite, historical status claim, stale
schema, failed identity guard, or quota-only injected test blocks dispatch.

## Acceptance criteria

1. Absolute and relative source paths use held no-follow anchors and parent/member
   descriptors; post-copy verification re-reads the same member FDs, and parent,
   same-inode, sidecar, and symlink mutations never feed replacement bytes to
   SQLite.
2. `maxSnapshotBytes` is admitted by a documented finite materialization bound
   before private SQLite writes; real under-bound materialization stays within
   both counters, over-bound inputs invoke no writable materialization, and all
   private files reconcile and clean up. Injected budget tests are supplementary.
3. Commit journals are durable before publication, per-final identities guard
   rollback, force backups restore byte-identically only when safe, external
   mutation leaves recovery state untouched, and an interrupted process causes
   explicit orphan-journal refusal rather than false success.
4. Legacy output has the same held-root/no-follow/descriptor-relative and
   capability-failure behavior as modern file output; no cross-device/path
   fallback can redirect or clobber a final.
5. Authoritative scripts fail on absent suites, pre-P3 `test:cli` scope is exact,
   status/evidence cannot claim P2/P3 completion prematurely, and the dispatch
   guard blocks P3/P4 until all P1/P2 and R12 focused gates pass.
6. Frozen source schema/item/aggregate `$ref` gates pass with `text.sections` /
   `text.sourceSpans`, copied slice fields, normalized UTF-16 metadata, and no
   `identity.databaseSha256`; stale schemas and historical evidence are not
   accepted.

## Stop, rollback, and assumptions

Stop immediately on any path-based source copy, path-based legacy publication,
quota enforcement that is only post-inventory, unguarded rollback, automatic
adoption of an orphan journal, missing test-file failure, or phase status that
claims acceptance without the evidence record. Roll back only this remediation's
scripts, guard, source/quota changes, legacy hardening, journal additions, and
named tests; preserve the frozen schema/product contract and never modify an
input CDB.

Assumptions used to close the handoff without a user question: output-bearing
legacy calls use the same Linux native secure-publication matrix as modern file
outputs (return-only legacy calls remain cross-platform), and unsupported
source-safe traversal fails closed before SQLite rather than weakening stdout
or path security. No external registry or downstream source-schema decision is
needed for this P1/P2 remediation.
