# Phase 2 raw publication — tactical remediation specification

## Status and lineage

**Request class:** remediation.

This package translates the accepted Phase 2 contract into bounded implementation
phases. It does not reopen the product design or the senior remediation decisions.
The controlling sources are:

- `docs/cdb-to-json-cli-refactor-phase-2-remediation/spec.md`;
- `docs/cdb-to-json-cli-refactor-phase-2-remediation/phase-1-cli-raw-output.md`;
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`;
- `docs/cdb-to-json-cli-refactor/spec.md`; and
- `docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md`.

The prior accepted package names tasks 2.1–2.5, but leaves implementation spread
across the parser, reader lifecycle, serializer, native adapter, destinations,
commands, and process gate. This package is the fresh-context sequencing and file
boundary for that remediation.

## Concrete planning need

Planning is required because one database read must own a verified physical
snapshot, WAL materialization, UTF-8/integer validation, metadata, async row
cleanup, and cancellation, while output must independently own finite staging,
exclusive publication, and a synchronous commit barrier. The native destination
boundary is security-sensitive and cannot be implemented as an incremental
JavaScript fallback. The implementation order below prevents these subsystems
from each opening or hashing the source independently and prevents a writer from
publishing before input/resource checks finish.

## Verified repository findings

At the planning checkpoint:

- `src/application/convertCatalog.ts` computes a live-main hash, then invokes
  `iterateRawCards()` separately, accumulates a per-database envelope, writes only
  to the injected data stream, and has no atomic destination lifecycle;
- `src/cli/parseArgs.ts` passes `strict: false` to `node:util.parseArgs` and turns
  parse failures into a help result; destination and `auto` split decisions are
  made before discovery;
- `src/profiles/rawProfile.ts` has a current-database row accumulator but no
  verified reader metadata or `extraTables` metadata, and the raw schema does not
  require `integerEncoding`;
- `src/cdb/iterateRows.ts` owns snapshot/materialization cleanup but has no
  metadata-aware session, swallows read errors, returns `null` for invalid UTF-8,
  and does not share an aggregate staging tracker;
- `src/cdb/snapshotBundle.ts` reads members into memory, checks only size for
  stability, and does not reserve aggregate staging before copying;
- `src/cdb/materializeSnapshot.ts` creates a private materialized database but
  does not reserve/reconcile its growth under `maxStagingBytes`;
- `src/cdb/openDatabase.ts` validates encoding, but the reader still needs
  required-table, ID/storage-class, and strict failure classification;
- `src/destinations/secureDestination.ts` is a typed placeholder; the native
  source still exposes path-based lock operations and `AtomicRename` passes
  rename flags `0` instead of a no-replace flag;
- `src/commands/validate.ts` reports discovered filenames without validating a
  database, `src/application/inspectInputs.ts` opens the original path rather
  than the verified session, and `src/commands/schema.ts` prints to stdout even
  when a file destination is requested; and
- the aggregate schemas currently describe wrapper objects (`cards` or
  `documents`) rather than the accepted array contract.

These findings are implementation gaps, not permission to start card/source
normalization. Verify each target against the working tree before editing.

## Controlling behavior

### Phase 2 capability scope

- Only `convert --profile raw` converts data in this phase.
- Raw JSON emits one `cdb.raw/1` envelope per database.
- Raw JSONL emits one complete envelope and one LF newline per database; it never
  emits individual rows.
- One unmerged input may use `split=none` and stdout or one file.
- Multiple unmerged inputs require `split=database` and a directory. Raw does not
  support `--merge` or `split=card`.
- `card` and `source` conversion fail with one stable capability diagnostic before
  discovery, snapshot acquisition, or SQLite access. Their item and aggregate
  schemas remain selectable through `schema`.
- Data is stdout-only when stdout is selected; all diagnostics, progress, and
  summaries go to the injected stderr writer.

### Input and raw envelope

The reader must acquire a stable physical bundle before opening any source:

```text
source main + present -wal/-shm
  -> verify member identities and bytes
  -> copy private bundle (bounded staging)
  -> open copied bundle with WAL-capable access
  -> VACUUM INTO private main-only database
  -> close copied bundle
  -> open materialized database read-only/immutable
  -> preflight and async raw-row join
  -> close and remove all private artifacts
```

The source bundle hash is a physical identity over the present main/WAL/SHM
bytes. It is not a logical row hash. Reordered physical SQLite layouts may yield
the same canonical rows, ordinals, and merge decisions but must yield a different
physical bundle hash. Raw source metadata uses the verified hash with the
`sha256:` prefix and the original main-file size.

The raw envelope has this fixed insertion order:

```text
schema
integerEncoding
source { fileName, sha256, sizeBytes, converter }
tables { datas, texts }
extraTables
```

Every supported fixed column is present. SQLite INTEGER values are exact signed
64-bit decimal strings; SQLite NULL remains null; TEXT values are selected as BLOB,
strictly decoded with fatal UTF-8, and retain empty strings and line endings.
Datas-only and texts-only joins retain the present raw row and emit the existing
missing-partner diagnostic; no placeholder data is fabricated. `extraTables` is
metadata only: table name, ordered columns, and row count.

### Limits, diagnostics, and exit behavior

All six limits are non-negative safe integers. Before discovery, reject rather
than clamp `maxSpoolBytes > maxStagingBytes` and
`maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION` and exit 2.
Snapshot member size sums are checked against both `maxSnapshotBytes` and the
aggregate `maxStagingBytes` before the first copy. Snapshot members, the
materialized main, destination temporaries, locks/reservations, and any spool
reserve once per physical private file, reconcile actual growth, and release in
`finally`.

Freeze these diagnostic mappings and exit paths: a non-UTF-8 database emits
`UNSUPPORTED_DATABASE_ENCODING` (input/encoding failure, exit 4) before text
selection; a non-TEXT/non-NULL supported text cell emits `INVALID_TEXT_VALUE`
(input/schema failure, exit 4) before its byte-size check; invalid bytes in a
valid TEXT cell remain `INVALID_TEXT_ENCODING`. An unavailable `card` or
`source` conversion emits `PROFILE_NOT_AVAILABLE` (option/capability failure,
exit 2) before discovery, snapshot acquisition, or SQLite access, never the
generic `INVALID_PATH` diagnostic. An unsupported file/directory destination
uses `UNSAFE_DESTINATION_FILESYSTEM` (output failure, exit 6).

Preserve exit precedence `2 > 3 > 4 > 5 > 6 > 7 > 1`: input/schema/resource/
integer errors are 4; collision is 5; output conflict/write/cancellation is 6;
continued mixed input failure is 7 only when no output failure or cancellation
occurred.

The public raw row API is an asynchronous iterator. It checks cancellation per
row and yields to the event loop at least once per 256 rows. A direct consumer
owns `return()`/`finally` cleanup; `convert()` uses the same reader-owned
lifecycle. A signal before the publication barrier aborts and cleans private
artifacts. A signal after the barrier cannot relabel a committed output.

#### Pre-discovery destination preflight

After parsing and normalization, structural destination preflight MUST run before
`discoverInputs()` and before snapshot/open. It must determine destination kind
and path shape, reject an existing split root with `OUTPUT_DIRECTORY_EXISTS`,
and require a truthful native capability manifest for file/directory output,
returning `UNSAFE_DESTINATION_FILESYSTEM` when unsupported. These checks use no
input discovery and return exit 6. Only discovered-cardinality checks—logical
output count, deterministic filenames/filename collisions, and source/output
identity—are deferred to the concrete planner, which runs after discovery but
still before any snapshot, reader, or SQLite call. Add a discovery-spy assertion
for each structural failure and for the unavailable-profile path.

## Destination behavior

Stdout is intentionally non-atomic and permitted only for one logical output.
Modern file and directory output requires a truthful native capability manifest
and a descriptor-relative Linux adapter. There is no path-based fallback.
Unsupported host, ABI, kernel, filesystem, or primitive returns
`UNSAFE_DESTINATION_FILESYSTEM` (exit 6) before source snapshot/open.

A split directory is fresh and exclusive: `--output` must name a nonexistent
root; an existing empty or populated root returns `OUTPUT_DIRECTORY_EXISTS`, and
`--force` does not override it. A non-split existing file is preserved unless
`--force` is supplied. This package deliberately does not support replacing an
existing regular final: its capability manifest reports
`identityGuardedReplace: false`, and `--force` against such an incumbent fails
`UNSAFE_DESTINATION_FILESYSTEM` (exit 6) during structural preflight, before
input discovery. `--force` remains accepted for an absent final, where
publication is still descriptor-relative `RENAME_NOREPLACE`; a final appearing
after reservation is never clobbered. No `replaceIfIdentityMatches` operation
is part of this package's ABI. All relative traversal, lock/reservation, temp
creation, publication, and cleanup stay bound to the trusted root descriptor.
Parent replacement, symlink, lock, and publication races must not escape that
root or clobber without authorization.

## Constraints and non-goals

- Do not implement card bitfield mapping, text segmentation, source mapping,
  merge semantics, or any Phase 3/4 profile conversion.
- Do not read a live source main file for provenance or bypass snapshot/WAL
  materialization.
- Do not coerce numeric-looking TEXT/REAL/BLOB/NULL IDs or invalid text bytes.
- Do not dump arbitrary extra-table cell values.
- Do not use `console.*` in library, reader, application, serializer, or
  destination modules.
- Do not use a path-based output fallback when native capability is unavailable.
- Do not adopt or clean an existing split root automatically.
- Do not add a bundler or runtime dependency and do not modify input CDB files.
  The native build may add the exact `node-addon-api@8.9.0` devDependency and
  matching `binding.gyp` include/GYP configuration required by the existing
  `<napi.h>` source; it is build-time tooling, not a runtime dependency.
- Do not infer native support from a Node version alone. The current Node 26
  unsupported manifest is a baseline branch; a later hash-matching manifest may
  report support only after the module loads and all primitive probes pass.

## Dependency graph

```text
phase 1: strict parse + normalized structural/concrete output plan
       |
phase 2: one reader-owned metadata session + raw envelope + provenance
       |
phase 3: writer-neutral serialization + aggregate budget + application states
       |
phase 4: native adapter + stdout/file/directory destinations + commit barrier
       |
phase 5: inspect/validate/schema services and schema/package wiring
       |
phase 6: compiled process smoke, cancellation/race gates, README delta
```

Each phase ends with a runnable focused checkpoint. Phase 4 is the security stop
point: if descriptor-relative no-clobber publication cannot be proven, stop file
and directory work and retain stdout/legacy behavior rather than weakening the
contract.

## Acceptance criteria

1. Strict parser and output-plan tests prove invalid matrix, profile capability,
   destination, cardinality, fresh-root, and limit-relation failures occur before
   discovery, snapshot, or SQLite access where the plan claims pre-open ordering.
2. A single reader-owned session supplies verified bundle metadata, extra-table
   metadata, raw rows, WAL materialization, strict UTF-8/integer validation, and
   cleanup without a second live database open.
3. Raw JSON and JSONL are schema-valid, deterministic, exact for signed-int64
   extrema, nulls, empty strings, Unicode, and line endings; invalid bytes and
   storage classes fail without null substitution.
4. Every writer enforces `maxOutputBytes` per encoded chunk. Private file and
   directory writers additionally reserve/reconcile those chunks against
   aggregate `maxStagingBytes`; stdout remains non-atomic and does not charge
   encoded chunks to private staging. All snapshot, materialization, spool,
   lock, reservation, and temporary-file bytes remain aggregate-budgeted. Writers
   abort safely on failure and never alter a pre-existing final before the
   publication barrier.
5. Split roots are fresh, non-split files are no-clobber unless force is held,
   and unsupported hosts fail file/directory output with exit 6 and no input open.
6. Native-supported tests prove trusted-root traversal, symlink rejection,
   parent-directory replacement resistance, lock/reservation behavior, force and
   no-force races, and descriptor-relative cleanup.
7. `inspect`, `validate`, and all five schema selectors emit deterministic
   machine-readable output, use no converted records for schema selection, and
   never make schema selection open SQLite.
8. SIGINT and writer failure close the writer and reader-owned SQLite,
   materialization, snapshot, and private staging resources after reading, while
   retaining SourceHandle, trusted ParentHandle, and LeaseHandle through the
   final identity recheck and commit barrier. Those retained handles are
   released/closed in `finally`; tests prove none closes before recheck. The
   flow removes only owned private artifacts, preserves old finals, and respects
   the commit barrier; an indeterminate publication never triggers blind retry
   or recursive cleanup of an unknown tree.
9. The exact Phase 2 gate passes: `npm run build`, `npm run test:reader`,
   `npm run test:compat`, `npm run test:cli`, and `npm run package:check`; then
   the full `npm test` result is recorded without treating timeout as success.
10. The inherited R5.6 fixture gates remain named and runnable in this package:
    `tests/reader/walMaterialization.test.ts`,
    `tests/reader/textByteFidelity.test.ts`,
    `tests/reader/physicalSnapshotProvenance.test.ts`,
    `tests/reader/stagingSnapshotBudget.test.ts`,
    `tests/cli/limitRelations.test.ts`,
    `tests/api/iterateRawCards.test.ts`, and
    `tests/api/iterateRawCards.types.test.ts`.
    The focused command is:

    ```bash
    npx vitest run tests/reader/walMaterialization.test.ts tests/reader/textByteFidelity.test.ts tests/reader/physicalSnapshotProvenance.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/cli/limitRelations.test.ts tests/api/iterateRawCards.test.ts tests/api/iterateRawCards.types.test.ts
    ```

## Verification baseline

At planning time on Node `v26.5.0`/Linux x64:

- `npm run build`: passed; build wrote an explicit unsupported native manifest.
- `npm run test:compat`: passed, 22 tests.
- `npm run test:cli`: passed, 38 tests.
- `npm run package:check`: passed with no native module and an unsupported
  manifest.
- `npm run test:reader`: the command exceeded the 120-second observation window
  after reporting all five reader files green; a complete run remains required.

## Risks, assumptions, and rollback

| Risk | Stop condition and mitigation |
|---|---|
| Native ABI cannot prove descriptor-relative no-replace publication | Stop Phase 4 file/directory publication. Do not add a path fallback. |
| Reader metadata requires a second live open | Introduce one session that owns snapshot, materialization, metadata, rows, and cleanup; stop if duplication remains. |
| Snapshot/materialized/output bytes bypass aggregate accounting | Add reservation/reconcile fixtures before enabling publication; stop on any untracked private file. |
| Fatal UTF-8 or ID/storage validation changes the existing reader contract | Add conformance fixtures and preserve existing Phase 0–1 gates before proceeding. |
| Stdout streaming is confused with atomic files | Keep separate destination interfaces and test late stdout failure versus file pre-commit failure. |
| Runtime support is inferred from a version string or stale manifest | Require the exact build-time N-API dependency, a module that loads on the running ABI, a hash-matching manifest, and all primitive probes; execute either the supported or unsupported test branch according to that manifest. |

Rollback removes only Phase 2 command handlers, serializers, raw application
wiring, and modern destination adapters. It leaves the Phase 0–1 reader,
compatibility bridge, schemas, and legacy output behavior intact. Rollback never
removes input files or pre-existing finals.

## User decisions

None. Linux-only hardened publication, fresh split roots, physical snapshot
provenance, strict UTF-8, finite staging, and asynchronous cancellation were
selected by the accepted senior remediation.

## Adversarial publication amendment (B2-1 through B2-5)

This section is normative and supersedes any less-specific wording above or in
Phase 4. It is the required remediation for the plan-reviewer-b change request.
It does not add a path-based fallback or broaden Phase 2 beyond raw output.

### A. Concrete native ABI and handle boundary

`src/destinations/nativeAdapter.ts` is the only loader and caller of the native
module. The modern ABI exposes opaque, native-owned handles, never forgeable raw
file-descriptor integers and never a pathname after the initial trusted-parent
acquisition. The minimum operations are:

```text
acquireTrustedParent(path, createMissingParents=false) -> ParentHandle
probeFilesystem(parent, probeToken) -> FilesystemProbe
inspectLeaf(parent, leafName) -> ABSENT | REGULAR | DIRECTORY | SYMLINK | OTHER
openSourceIdentity(path, followSymlinks) -> SourceHandle
acquireLease(parent, leafName, scope, authorization) -> LeaseHandle
createFileTemp(parent, lease) -> TempHandle
createDirectoryStage(parent, lease) -> StageHandle
createStageChild(stage, validatedLeaf) -> StageChildHandle
verifyDirectoryStage(stage, ownedChildHandlesAndExpectedIdentities) -> StageVerified
recheckSourceOutputIdentity(sourceHandles, parent, leafName, lease) -> IdentityCheck
publishFile(lease, temp, leafName, absentAuthorization) -> PublishResult
publishDirectory(lease, stage, leafName) -> PublishResult
reclaimStaleLease(parent, expectedLockIdentity, replacementRecord) -> LeaseHandle
release/cleanup(handle) -> CleanupResult
```

The exact TypeScript names may differ, but the ownership and argument rules may
not. Only `acquireTrustedParent` and `openSourceIdentity` accept an input path,
and they validate NULs, platform path shape, and every component while opening
with `openat2`/no-follow semantics. After that boundary, operations accept a
trusted parent or stage handle plus one validated leaf name. A leaf is a nonempty
single component: it contains no NUL, `/`, `\\`, `.`, or `..`, and is neither
absolute nor implicitly relative. `renameat2`, `unlinkat`, lock creation,
temporary creation, and cleanup receive no unchecked string path. The old
path-based `LockFile`, `UnlockFile`, and `AtomicRename` exports are removed from
the modern ABI rather than retained as dormant fallbacks.

`PublishResult` is one of `COMMITTED`, `NOT_COMMITTED`, or `INDETERMINATE` and
carries the native identity of the temp/stage handle. The adapter never retries a
publication after `INDETERMINATE`. It reconciles by descriptor-relative identity
comparison; if commitment cannot be proven, it reports machine-readable
`OUTPUT_WRITE_FAILED` (exit 6) with an indeterminate-publication detail, leaves
any possibly committed final untouched, and cleans only handles it can prove it
owns. No retry or cleanup may recursively remove an unknown directory.

### B. Fresh split-directory transaction protocol

A split-directory conversion is one directory transaction, not a sequence of
child renames:

1. Before discovery, acquire the trusted existing parent descriptor, inspect the
   requested final leaf without following symlinks, and reject any existing leaf
   (empty or populated) as `OUTPUT_DIRECTORY_EXISTS`. Hold a descriptor-relative
   exclusive lease for the leaf. A concurrent creator is still allowed to race;
   the final no-replace publication is the authoritative barrier.
2. Create a private sibling stage directory under that held parent/lease with
   `mkdirat(..., O_EXCL)` and mode `0700`. Write each successful database output
   into owned child temp handles. The stage is never treated as the final root.
3. Before publication, verify the stage contains exactly the child handles owned
   by this conversion and no attacker-inserted or unknown entry. Recheck every
   source identity against the trusted parent and lease. If verification fails,
   abort without publishing and leave unknown entries untouched.
4. Publish the stage directory itself once with
   `renameat2(parentFd, stageName, parentFd, finalLeaf, RENAME_NOREPLACE)` (or a
   behaviorally proven descriptor-relative equivalent). A final root created
   after preflight therefore causes `NOT_COMMITTED`/`OUTPUT_DIRECTORY_EXISTS`,
   never adoption or clobber. `--force` never overrides the fresh-root rule.
5. On definite commit, transfer ownership of the directory to the caller and
   release only the lease record; on definite non-commit, remove only this
   conversion's stage/lease handles. On an indeterminate result, reconcile the
   stage handle and final leaf; do not blindly retry or recursively delete either
   side.

Without `--continue-on-error`, every database must reach the ready state before
step 4. Any read, validation, resource, writer, cancellation, or stage-verification
failure leaves no final root. With `--continue-on-error`, only input/database
failures are retained as failed reports: successful children are staged, the
single directory commit publishes them after all inputs are attempted, and the
command returns exit 7. A writer, destination, lease, or publication failure
aborts the whole directory transaction and returns exit 6 rather than publishing
an ambiguous mixed root. If no child succeeds, no final root is created. After
step 4, a signal cannot relabel the committed result or trigger cleanup of the
committed directory.

### C. Lease/lock state machine and cleanup

Every file lease and fresh-root lease is an exclusive descriptor-relative record
created with `O_CREAT|O_EXCL|O_NOFOLLOW`. The record format is fixed and fully
validated (`cdb-destination-lock/1`, owner token, decimal PID, creation time in
nanoseconds, scope, and validated target leaf); truncated, malformed, symlinked,
PID-present, or token-mismatched records are never overridden by `--force`.

Acquisition is `ABSENT -> HELD`, or `STALE -> REMOVED -> HELD` only when the
well-formed owner PID probe returns `ESRCH`. `kill(pid, 0)` returning `0` or
`EPERM` is live and refuses acquisition. A PID-present record is live even when
its final is already present; a committed final plus a stale lease is treated as
an existing/committed destination, never as permission to adopt or recursively
clean it. Release requires both the opaque lease handle and matching owner token
and occurs in `finally`; a second release is a no-op owned by the same handle,
while a different token cannot unlink the record. Lock names and all cleanup are
relative to the held parent descriptor.

### D. Capability and identity proof

The capability manifest records numeric `process.versions.modules` (Node module
ABI), N-API version, platform, architecture, module SHA-256, the complete
primitive-probe result, and `identityGuardedReplace: false`. The latter is a
normative unsupported capability for expected-present `--force` in this
package; no identity-check-plus-ordinary-rename substitute is allowed.
`nativeAdapter` rejects a stale/mismatched module or manifest. During each
structural destination preflight it also runs a side-effect-contained probe on
the selected parent filesystem: no-symlink traversal, descriptor-relative
exclusive lock/temp creation, and no-replace publication are exercised and then
cleaned by owned handles. `ENOSYS`, `EOPNOTSUPP`, failed probes, inability to
prove cleanup, or a forced expected-present regular final produce
`UNSAFE_DESTINATION_FILESYSTEM` before discovery. A successful compile or Node
version alone never reports support. The clean-build gate covers a Node 22+
Linux candidate; the current Node 26 unsupported manifest remains a valid branch.

Source/output identity is a descriptor check, not a string comparison. The
adapter keeps opaque source handles and compares device, inode, and regular-file
type against the destination leaf using the trusted parent descriptor, once
before staging and again after the lease is held immediately before `COMMITTING`.
It rejects a source symlink under the default no-follow policy, rejects a final
symlink, and rejects a final regular file or hardlink whose identity matches any
input, including under `--force`. Parent replacement cannot redirect either
identity check because the parent handle is held.

### E. Required adversarial verification

The native test suite must cover traversal/leaf validation for lock, temp,
no-force, force, and cleanup; symlinked parents and finals; parent replacement
at every preflight, lease, stage, no-force, force, and cleanup boundary; live,
`EPERM`/live, stale/`ESRCH`, PID-present, malformed/partial, symlink, and token
mismatch leases; and final appearance between reservation and publication. It
must assert no-force never clobbers, force never bypasses a live/malformed lease,
hardlink/source identity is rejected, and no output escapes the trusted parent.
Directory tests inject failures before stage creation, after each child, during
stage verification, at no-replace publication, and with an indeterminate result.
They assert either no final root or a clearly committed root, never recursive
delete of an adopted/attacker-modified tree, and no blind retry. The required
focused gate is:

```bash
npx vitest run tests/cli/nativeCapability.test.ts \
  tests/cli/destinationLifecycle.test.ts tests/cli/freshSplitRoot.test.ts \
  tests/cli/pathSafety.test.ts tests/cli/secureDestinationRace.test.ts
```

## Reviewer-B remediation freeze (B2-R1 through B2-R5)

This section is normative and supersedes every earlier generic reference in this
package to a stage child, source identity, force replacement, missing-parent
creation, lease reclaim, cleanup, or indeterminate publication. It is a delta to
the accepted Phase 2 request, not a new product decision.

### R1. Owned stage children are concrete handles

The modern native boundary is handle-only after acquisition. The minimum
stage-child operations are:

```text
createDirectoryStage(parent: ParentHandle, lease: LeaseHandle) -> StageHandle
createStageChild(stage: StageHandle, leaf: ValidatedLeaf) -> StageChildHandle
writeStageChild(child: StageChildHandle, bytes: Uint8Array) -> WriteResult
flushStageChild(child: StageChildHandle) -> FlushResult
closeStageChild(child: StageChildHandle) -> StageChildIdentity
abortStageChild(child: StageChildHandle) -> CleanupResult
verifyDirectoryStage(
  stage: StageHandle,
  ownedChildren: readonly {
    handle: StageChildHandle,
    expectedLeaf: ValidatedLeaf,
    expectedIdentity: StageChildIdentity,
  }[],
) -> StageVerified
publishDirectory(lease: LeaseHandle, stage: StageHandle, leaf: ValidatedLeaf)
  -> PublishResult
```

`createStageChild` opens exactly `stage/leaf` natively with
`O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC`, mode `0600`, and rejects every
leaf that is empty, absolute, contains NUL, `/`, `\\`, `.`, or `..`. The leaf is
validated again inside native code. `writeStageChild`, `flushStageChild`, and
`closeStageChild` operate on the opaque native handle; TypeScript never receives
an fd integer or constructs a stage path. Closing leaves the owned regular file
entry in the stage, and returns its device/inode/type/size identity. That entry
is the one that will become a final child when the stage directory itself is
renamed; there is no later child rename, link, or parent-sibling temp.

A child state is `OPEN -> CLOSED -> TRANSFERRED` or `OPEN -> ABORTED`.
`verifyDirectoryStage` requires every supplied child handle to be `CLOSED`,
checks each expected leaf and identity against a fresh descriptor-relative
enumeration, and requires the stage to contain exactly those owned
regular-file entries. It returns `StageVerified` only when there are no missing, duplicate, symlink,
directory, or unknown entries. An unknown entry is never opened, recursively
removed, or adopted. Directory publication performs one
`renameat2(parentFd, stageLeaf, parentFd, finalLeaf, RENAME_NOREPLACE)` (or a
native equivalent with the same guarantee); the stage's existing child entries
therefore become final entries as part of that single directory rename.

The directory destination must keep the `StageHandle` and every
`StageChildHandle` until verification. After definite commit, ownership of the
stage and its children transfers to the committed final and cleanup is a
no-op for those handles. On a definite non-commit, only closed children and the
stage name owned by this transaction may be removed, and the stage directory is
removed only after a fresh exact-empty check. If unknown entries remain, the
stage is left in place and cleanup reports `OUTPUT_CLEANUP_FAILED` rather than
recursively deleting it.

### R2. The source handle owns the snapshot input

`openSourceIdentity(path, followSymlinks)` is not an identity-only probe. It
returns an opaque `SourceHandle` containing the opened regular main-file
descriptor, its device/inode/type/size identity, and the trusted source-parent
handle plus validated main leaf needed to acquire present `-wal`/`-shm`
members. The default is `followSymlinks=false`: a source symlink is rejected.
When the explicit follow policy is enabled, the resolved regular target is
opened once and the handle, not the spelling of the path, is authoritative.

Change the reader contract to:

```text
acquireSnapshotBundle(source: SourceHandle, budget, limits, signal)
  -> SnapshotBundle
materializeSnapshot(bundle: SnapshotBundle, budget, signal)
  -> MaterializedSnapshot
openMaterializedSnapshot(materialized: MaterializedSnapshot)
  -> ReaderDatabase
```

After deterministic discovery, the concrete planner acquires one
`SourceHandle` per input before any snapshot/open call and retains it in the
concrete transaction plan. `iterateRawCards` and the internal metadata-aware
session consume that handle and pass the same handle through snapshot capture,
member copy,
post-copy identity/byte verification, WAL materialization, metadata queries,
row iteration, and final source/output recheck. No reader or application path
may call `acquireSnapshotBundle(sourcePath)`, `computeFileHash(input.path)`, or
open the live source by path. Main and sidecar bytes are read from descriptors
opened relative to the source handle's held parent and validated by descriptor
identity plus before/after byte/hash checks; replacement of a pathname cannot
change the bytes read by the session. The source handle remains owned until the
publication transaction has completed its final identity check and commit
barrier, and is then closed in `finally`. Reader-owned resources have a separate
lifetime: after row iteration and metadata are complete, close the SQLite
connection, materialized snapshot, copied WAL bundle, and their private staging
artifacts, but do not close the `SourceHandle`, its source-parent handle, the
trusted destination parent, or the destination lease. The application performs
that close/cleanup split explicitly, retains those handles through the native
final source/output identity recheck and publication call, and releases/closes
them in `finally` after `COMMITTED`, `NOT_COMMITTED`, or `INDETERMINATE`
reconciliation. Cancellation tests MUST assert that no required source/parent/
lease handle is closed before the final recheck.

The final check first performs a descriptor-relative `fstatat` of the
SourceHandle's held source-parent/main-leaf and compares it with the handle's
original identity, then compares that identity and the destination leaf
identity. A source replacement that remains in place is rejected. If an
adversary swaps the source and swaps it back before the final check, the output
is still provably from the originally opened handle; the replacement was never
read. The race fixture must assert that property, not merely perform a
string-path recheck. `sourceHandleBinding.test.ts`
must swap the input between planning, snapshot copy, materialization, and commit,
and assert either a stable-original read or a definite rejection; output from a
replacement inode is forbidden.

### R3. Force is explicitly limited to the no-incumbent branch

`--force` never means unconditional replacement. This package freezes the
identity-guarded replacement branch as unsupported: Linux `renameat2` with
`RENAME_NOREPLACE` proves an absent-final commit, but an identity check followed
by ordinary `renameat` is racy and `RENAME_EXCHANGE` is not an inode compare-and-
swap. The capability manifest therefore includes
`identityGuardedReplace: false` for this package, and no native
`replaceIfIdentityMatches` export or TypeScript operation may be added as an
implementation-defined placeholder.

A file transaction uses this executable truth table:

| State at structural preflight/recheck | Required behavior | Race outcome |
|---|---|---|
| `ABSENT` (with or without `--force`) | acquire the lease and publish with descriptor-relative `RENAME_NOREPLACE` | any final appearing after reservation/recheck is `NOT_COMMITTED`; it is never clobbered |
| `EXPECTED_PRESENT(E)` regular final with no `--force` | reject as the documented output conflict | incumbent remains untouched |
| `EXPECTED_PRESENT(E)` regular final with `--force` | return `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) before discovery; do not stage or open input | incumbent remains untouched; no compare/publish is attempted |
| symlink, directory, other type, source identity, or input hardlink | reject as output/identity conflict before staging | force does not bypass it |
| a final appears after an absent preflight | retain the final and return definite `NOT_COMMITTED` when the native no-replace result proves it; otherwise `INDETERMINATE` | never clobber or adopt the final |

`inspectExpectedFinal(parent, leaf)` may report `ABSENT`, a safe regular
incumbent, or `UNSAFE_FINAL`, but an expected regular incumbent is only used to
select the conflict/unsupported branch above. `publishFile` accepts only an
`Absent` authorization in this package. The selected filesystem probe MUST
verify the no-replace primitive and MUST report the unsupported
`identityGuardedReplace` capability; a plain descriptor-relative rename after a
JavaScript identity check is prohibited. Tests explicitly cover force against
an expected regular incumbent and assert `UNSAFE_DESTINATION_FILESYSTEM`
before discovery, plus absent-final races, symlink/dir/hardlink races,
source/final identity collisions, and definite versus indeterminate results.

### R4. Existing trusted parents only; absolute paths are anchored

`createMissingParents` is fixed to `false` for this package. Every component of
the destination parent must already exist as a directory, and every component is
opened with no-follow descriptor-relative traversal. Missing parents, an empty
component, a trailing separator, `.`/`..`, NUL, and unsupported platform path
shapes are rejected before discovery with `UNSAFE_DESTINATION_FILESYSTEM` (exit
6); no native operation creates a parent.

Absolute output paths are supported only through a native trusted anchor: the
adapter opens `/` as an anchor and traverses every component with
`openat2`/no-follow semantics. Relative paths are anchored to a directory fd
captured for the process working directory, never to a later path lookup. The
adapter returns `ParentHandle { anchorIdentity, parentIdentity, finalLeaf }` and
all later operations accept only that handle plus the validated one-component
leaf. Thus there is no `AT_FDCWD` path fallback and no unchecked path after
acquisition.

The parent handle records the identity of the resolved parent and the anchor
identity. Native preflight, lease acquisition, stage creation, source/output
checks, publication, and cleanup each revalidate parent reachability where the
operation requires the user-visible path. If the parent path resolves to a
different inode, the operation returns `NOT_COMMITTED`/`PARENT_REPLACED` and
cleans only owned handles. If replacement occurs after the final reachability
check, the operation may safely commit to the already-held old parent inode,
but must return `COMMITTED` with `parentIdentity`/`SAFE_OLD_PARENT` detail; it
must never follow the replacement. Race tests assert both outcomes are safe and
never treat an old-parent commit as a commit into the replacement tree.

### R5. Lease grammar, ownership, and reconciliation are executable

The lock leaf is deterministic and bounded:

```text
.cdb-destination-lock-<64 lowercase hex SHA-256(scope + NUL + targetLeaf)>
```

The UTF-8 record is exactly these LF-terminated lines, in this order, with no
extra bytes and a maximum total length of 512 bytes:

```text
cdb-destination-lock/1
owner=<32 lowercase hex characters>
pid=<1..10 decimal digits>
createdNs=<1..20 decimal digits>
scope=file|directory
target=<base64url-no-padding UTF-8 target leaf>
```

The target leaf is at most 200 UTF-8 bytes and is decoded and revalidated
before use. A record that is overlong, truncated, malformed, non-canonical,
symlinked, non-regular, or has a mismatched scope/target is `REFUSED`, even with
force. Acquisition is `ABSENT -> HELD`, or
`STALE -> REVALIDATED -> REMOVED -> HELD` only when the complete record's PID
probe returns `ESRCH`. `kill(pid, 0)` returning `0` or `EPERM` is live and
refuses acquisition. A PID-present record remains live regardless of final
existence.

Stale reclaim is one native operation, not a JavaScript unlink/create pair:
`reclaimStaleLease(parent, expectedLockIdentity, replacementRecord) ->
HELD | REFUSED | INDETERMINATE`. It reopens the lock leaf with no-follow,
confirms the exact expected device/inode/type/record bytes and `ESRCH`, removes
only that exact stale record using the platform's identity-guarded primitive,
then creates the replacement with `O_CREAT|O_EXCL|O_NOFOLLOW`, writes and flushes
the canonical record, and returns a lease handle only after an exact read-back.
If any identity or absence check races, it returns `REFUSED`/`INDETERMINATE` and
leaves the unknown entry untouched; it never falls back to path-based force or
blind unlink/recreate. If the selected filesystem cannot prove this sequence,
its capability probe is unsupported for modern output.

Opaque handle states are fixed:

```text
Parent:     OPEN -> CLOSED
Source:     OPEN -> CLOSED
Lease:      HELD -> RELEASE_PENDING -> RELEASED | RELEASE_FAILED
Temp:       OPEN -> CLOSED -> PUBLISHED | ABORTED
Stage:      OPEN -> VERIFIED -> TRANSFERRED | ABORTED
StageChild: OPEN -> CLOSED -> TRANSFERRED | ABORTED
```

`cleanup(handle)` is type- and-state-aware. It closes an owned descriptor first;
for an untransferred temp/child it unlinks only the exact owned regular-file
identity; for an untransferred stage it enumerates and removes only owned child
identities and removes the stage directory only when exactly empty; for a lease
it releases only the matching owner token; for parent/source it only closes.
Cleanup of `PUBLISHED`/`TRANSFERRED` handles is a no-op and can never delete or
relabel a final. A second cleanup by the same handle is idempotent. A different
handle/token, an identity mismatch, an unknown stage entry, or a failed
read-back returns `OUTPUT_CLEANUP_FAILED` and leaves the entry in place.
Cleanup failure after `COMMITTED` reports the cleanup diagnostic but cannot
retry publication, change the committed state, or recursively delete anything.

The one-time indeterminate reconciliation matrix is:

| Observed final/staging state | Result | Required action |
|---|---|---|
| final identity equals this transaction's published temp/stage identity | `COMMITTED` | preserve final; transfer ownership; release lease only |
| final absent and owned temp/stage is live | `NOT_COMMITTED` | abort and remove only the owned temp/stage after exact identity checks |
| expected incumbent still present and owned temp/stage live | `NOT_COMMITTED` | preserve incumbent; remove only owned temp/stage |
| final absent and stage/temp is absent | `NOT_COMMITTED` | release lease; no retry |
| both final and temp/stage names present | `INDETERMINATE` unless native identities prove the final is the published owned object and the remaining name is an owned disposable alias | preserve final; never recursively clean; report output failure if unproven |
| final is mismatched, attacker-created, symlink, directory, or source identity | `INDETERMINATE` when commit was uncertain; otherwise `NOT_COMMITTED` | preserve the observed final; clean only provably owned artifacts |
| commit is proven but lease release fails | `COMMITTED` plus cleanup failure | preserve final; no retry and no destructive cleanup; return output-cleanup diagnostic |
| stage contains an unknown entry | `INDETERMINATE`/verification failure | leave unknown entry and stage untouched except for separately owned children |

`INDETERMINATE` is reconciled once, never retried. The application records the
commit barrier as `COMMITTED` only for a proven final; otherwise it returns
`OUTPUT_WRITE_FAILED` (exit 6), preserves every unproven final, and emits no
claim that a retry is safe.

### Required cross-phase edits and gates

- Phase 1 must pass `ParentHandle`/lease handles, not destination paths, from
  structural preflight into the concrete plan and must include the parent policy,
  force truth table, and parent-replacement vectors.
- Phase 2 must add `src/cdb/sourceHandle.ts` (or an equivalent bounded module),
  thread `SourceHandle` through `snapshotBundle.ts`, `iterateRows.ts`, and the
  metadata-aware reader session, and add
  `tests/reader/sourceHandleBinding.test.ts` with planning/snapshot/commit swaps.
- Phase 3 must model `COMMITTED` separately from cleanup failure and must close
  reader, writer, child/stage, lease, and source handles in the stated ownership
  order. It must include the reconciliation matrix in
  `tests/cli/conversionLifecycle.test.ts`.
- Phase 4 must implement the complete native ABI in
  `native/secure-destination/src/secure_destination.{h,cc}` and expose it only
  through `src/destinations/nativeAdapter.ts`; add stage-child, force-CAS,
  parent-replacement, lease, cleanup, and indeterminate vectors to
  `tests/cli/secureDestinationRace.test.ts` and
  `tests/cli/destinationLifecycle.test.ts`.
- Phase 6 must run the native race gate when support is truthful and must run
  the unsupported branch otherwise. The focused gate is:

  ```bash
  npx vitest run tests/reader/sourceHandleBinding.test.ts \
    tests/cli/nativeCapability.test.ts tests/cli/destinationLifecycle.test.ts \
    tests/cli/freshSplitRoot.test.ts tests/cli/pathSafety.test.ts \
    tests/cli/secureDestinationRace.test.ts
  ```

The package remains blocked from modern file/directory implementation if any
identity-guarded primitive, source-handle binding, stage-child ownership check,
parent policy, lease reclaim proof, or indeterminate outcome cannot be proven.
Stdout and the legacy compatibility bridge remain the rollback surface; no
path-based fallback may be introduced.
