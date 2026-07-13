# Phase 4 — hardened destinations and atomic publication

## Goal and dependency

Implement the Linux-only secure destination boundary and wire stdout, file, and
fresh split-directory sinks to the Phase 3 writer/commit contract. This is the
highest-risk phase. It depends on the pure plan, reader session, writer-neutral
interface, and staging reservations. It must not introduce a JavaScript/path-based
fallback.

## Files and bounded discovery

Change:

- `src/destinations/secureDestination.ts`
- `src/application/convertCatalog.ts`
- `src/application/outputPlan.ts`
- `src/application/stagingBudget.ts`
- `src/diagnostics/codes.ts` (add stable `OUTPUT_CLEANUP_FAILED` output diagnostic)
- `native/secure-destination/src/secure_destination.cc`
- `native/secure-destination/src/secure_destination.h`
- `native/secure-destination/binding.gyp`
- `package.json` and `package-lock.json` (exact build-time `node-addon-api` dependency)
- `scripts/build-native.mjs`
- `scripts/package-check.mjs`

Create:

- `src/destinations/nativeAdapter.ts`
- `src/destinations/atomicFile.ts`
- `src/destinations/fileDestination.ts`
- `src/destinations/directoryDestination.ts`
- `src/destinations/stdoutDestination.ts` (replace the current string-only
  adapter if necessary)
- `tests/cli/destinationLifecycle.test.ts`
- `tests/cli/freshSplitRoot.test.ts`
- `tests/cli/pathSafety.test.ts`
- `tests/cli/nativeCapability.test.ts` (supported and unsupported manifest branches)
- `tests/cli/secureDestinationRace.test.ts` (gated on truthful support)
- `tests/reader/sourceHandleBinding.test.ts` (reader/destination race fixture)

Inspect the existing native ABI, manifest, output-plan destination types, and
package-check script first. The current C++ `LockFile`/`UnlockFile` string-path
helpers and `AtomicRename` flags `0` are specifically not acceptable modern-path
operations.

## Implementation tasks

### 4.1 Make `nativeAdapter.ts` the sole ABI boundary

- Load `dist/native/secure_destination.node` only in `nativeAdapter.ts`.
  Translate native return values, errno, capability failures, and missing/invalid
  manifests to stable diagnostics. No other TypeScript module may call native
  exports or inspect native paths.
- Verify the manifest's platform, architecture, numeric
  `process.versions.modules` Node ABI, N-API version, supported primitive probe,
  and module SHA-256 before reporting support. A successful compilation alone is
  not support. During each structural destination preflight, run a
  side-effect-contained probe on the selected parent filesystem for
  `openat2`, `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, descriptor-relative
  exclusive lock/temp creation, and no-replace publication; clean probe handles
  descriptor-relatively. `ENOSYS`, `EOPNOTSUPP`, failed cleanup, or an invalid
  manifest means `UNSAFE_DESTINATION_FILESYSTEM`. The current Node 26 result is
  only a baseline manifest state, not a hard-coded support policy.
- Add exact build-time `node-addon-api@8.9.0` to `package.json` and
  `package-lock.json`; configure `binding.gyp` with
  `<!@(node -p "require('node-addon-api').include")` in `include_dirs` and
  `<!@(node -p "require('node-addon-api').gyp")` in `dependencies` (preserving
  `NAPI_VERSION=9`) so a clean `npm ci` resolves the existing `<napi.h>` includes.
  Change `scripts/build-native.mjs` to treat every Node major >=22 on Linux
  x64/arm64 as build-eligible, remove stale binaries for unsupported/failed
  builds, and write a truthful manifest only after a load and primitive probe.
  `package-check` accepts a hash-matching supported module, rejects a supported
  manifest with a missing/mismatched module, and rejects an unsupported manifest
  that leaves a stale module. A Node 22+ clean build/load gate must exercise the
  supported branch when its manifest is truthful; the current Node 26 baseline
  exercises the unsupported branch unless its own probe produces a valid
  supported manifest.

### 4.2 Define the concrete descriptor-relative ABI

The native ABI is an opaque-handle transaction boundary. `nativeAdapter.ts` is
its sole caller; TypeScript never receives forgeable raw fd integers and no
modern operation accepts a pathname after trusted-parent acquisition. The ABI
must provide these operations (names may vary, semantics may not):

```text
acquireTrustedParent(path, createMissingParents=false) -> ParentHandle
probeFilesystem(parent, probeToken) -> FilesystemProbe
inspectLeaf(parent, validatedLeaf) -> LeafState
openSourceIdentity(path, followSymlinks) -> SourceHandle
acquireLease(parent, validatedLeaf, scope, authorization) -> LeaseHandle
createFileTemp(parent, lease) -> TempHandle
createDirectoryStage(parent, lease) -> StageHandle
createStageChild(stage, validatedLeaf) -> StageChildHandle
verifyDirectoryStage(stage, ownedChildHandlesAndExpectedIdentities) -> StageVerified
recheckSourceOutputIdentity(sourceHandles, parent, leaf, lease) -> IdentityCheck
publishFile(lease, temp, leaf, absentAuthorization) -> PublishResult
publishDirectory(lease, stage, leaf) -> PublishResult
reclaimStaleLease(parent, expectedLockIdentity, replacementRecord) -> LeaseHandle
cleanup(handle) -> CleanupResult
```

Only the two initial acquisition calls accept user paths. They reject NULs,
absolute/invalid component forms as applicable, symlinked parents under the
selected policy, and traversal; all later calls accept a trusted parent/stage
handle plus one validated leaf name only. Native validation rejects empty names,
NUL, `/`, `\\`, `.`, `..`, and absolute names before lock, temp, rename, or
cleanup. `renameat2`, `unlinkat`, lock creation, and cleanup are descriptor-
relative. Delete/rename helpers that accept old/new raw paths are removed from
the modern ABI, not retained as fallback exports. Do not depend on `O_TMPFILE`
unless the ABI proves descriptor-relative publication of that handle.

`publishFile` uses `RENAME_NOREPLACE` for an absent final, with or without
`--force`. This package's capability manifest reports
`identityGuardedReplace: false`; an existing regular final with `--force`
returns `UNSAFE_DESTINATION_FILESYSTEM` before discovery, and no expected-present
CAS or identity-check-plus-ordinary-rename operation exists. Both definite
publication outcomes and `INDETERMINATE` carry the native temp/stage identity.
Never retry `INDETERMINATE`; reconcile descriptor-relatively, preserve an
unproven final, and clean only handles proven to be owned by this conversion.

The lease record is fixed (`cdb-destination-lock/1`, owner token, decimal PID,
creation time in nanoseconds, scope, and validated target leaf) and is written
with `O_CREAT|O_EXCL|O_NOFOLLOW`. A complete, well-formed record is stale only
when `kill(pid, 0)` returns `ESRCH`; `0` and `EPERM` are live. Malformed,
partial, symlinked, or PID-present records refuse acquisition even with force.
Release requires the matching opaque handle and token and is descriptor-relative.
A committed final with a stale lease is still an existing final: it is never
adopted or recursively cleaned.

### 4.3 Implement file and directory destinations

- `stdoutDestination` adapts only the injected stdout stream and remains
  intentionally non-atomic. It is selectable only for one logical output and
  enforces `maxOutputBytes` without reserving encoded chunks against private
  `maxStagingBytes`.
- `atomicFile` owns temporary sibling creation, byte reservation, flush/close,
  pre-commit abort, publication, and cleanup. No-force checks no-clobber only
  after reservation. Force never bypasses a live/malformed lock; it may publish
  only an absent final with `RENAME_NOREPLACE`. An existing regular final with
  force is the explicit `identityGuardedReplace: false` unsupported branch and
  returns `UNSAFE_DESTINATION_FILESYSTEM` before discovery. A pre-commit error
  leaves an old final byte-identical.
- `fileDestination` acquires one trusted parent/root descriptor, stages one
  output, rechecks source/output identity after reservation, and publishes only
  at the synchronous commit barrier. It never performs an identity check
  followed by ordinary rename.
- `directoryDestination` requires a nonexistent split root, but does not create
  that final root during preflight. It holds a descriptor-relative lease on the
  final leaf, stages all children in a private `0700` sibling directory, verifies
  that every stage entry is owned by this conversion, then publishes the stage
  directory once with descriptor-relative `RENAME_NOREPLACE`. Existing empty and
  populated roots both fail with `OUTPUT_DIRECTORY_EXISTS`; `--force` does not
  change that. A concurrent creator therefore yields no commit and is never
  adopted or clobbered. In no-continue mode any read, writer, resource,
  cancellation, or verification failure removes only owned stage/lease handles
  and leaves no final root. With unmerged continue, only input/database failures
  leave successful children in the single staged directory; it commits once
  after all inputs and returns exit 7. Destination/lease/publication failure
  aborts the whole directory transaction with exit 6. Unknown or attacker-
  inserted entries are never recursively deleted.
- Keep all temporary, lock, reservation, materialized, and snapshot bytes under
  the same `StagingBudget`; private destination encoded chunks reserve there too.
  Reserve before growth, reconcile actual growth, and release exactly once. Do
  not use `null` to skip the tracker for destination runs, and do not charge
  stdout encoded chunks to it.

### 4.4 Wire capability and publication ordering

- File/directory capability failure returns `UNSAFE_DESTINATION_FILESYSTEM` exit
  6 in structural destination preflight before `discoverInputs()`, snapshot, or
  open. Preflight acquires the trusted existing parent, rejects an existing
  split leaf, and runs a side-effect-contained probe on that actual filesystem
  for no-symlink traversal, exclusive lock/temp creation, and no-replace
  publication. Add a discovery/reader spy proving this ordering whenever the
  manifest is unsupported or the selected filesystem probe fails.
- Fresh-root existence is rejected as `OUTPUT_DIRECTORY_EXISTS` in that
  pre-discovery structural preflight, including empty roots and `--force`, but
  the preflight check is not treated as the publication guarantee: a concurrent
  creator is rejected by the final no-replace rename. Source/output identity is
  acquired through opaque source handles and the trusted parent descriptor,
  checked once before staging and again after lease acquisition immediately
  before `COMMITTING`; hardlinks, source/final symlinks, and parent swaps are
  rejected. Logical output count and filename collisions remain post-discovery
  concrete-plan checks, still before opening an input.
- Set conversion state to `COMMITTING` immediately before the synchronous native
  publication barrier. A signal before it aborts; a definite commit after it
  leaves the committed result successful and never deletes it. A native
  `INDETERMINATE` result is reconciled once by descriptor identity, never blindly
  retried, and reports output failure without deleting an unproven final.

## Tests and acceptance criteria

On every host, run:

```bash
npm ci
npm run build
npm run test:reader
npm run test:cli -- --run tests/cli/nativeCapability.test.ts tests/cli/destinationLifecycle.test.ts tests/cli/freshSplitRoot.test.ts tests/cli/pathSafety.test.ts
npm run package:check
```

Always assert:

- `nativeCapability.test.ts` loads only through `nativeAdapter.ts`, verifies
  manifest/platform/arch/ABI/hash/probe agreement, and exercises the supported
  and unsupported branches without a path fallback;
- unsupported platform/manifest returns exit 6 before reader/snapshot calls;
- a clean Node 22+ Linux candidate build resolves `node-addon-api`, loads the
  compiled N-API module, and records a truthful manifest; the current Node 26
  baseline is tested through whichever truthful manifest branch it reports;
- existing empty/populated split roots fail even with force;
- file no-force preserves an existing final; force with an existing regular
  incumbent returns `UNSAFE_DESTINATION_FILESYSTEM` before discovery because
  identity-guarded replacement is unsupported, while force with an absent final
  uses no-replace publication;
- writer/resource/cancellation failures clean temp, lock, reservation, and
  staging state; and
- aggregate snapshot/materialized/private-output reservations reject growth
  before write, while stdout enforces `maxOutputBytes` without consuming private
  staging budget;
- lease vectors cover live, `EPERM`/live, stale/`ESRCH`, PID-present,
  malformed/partial, symlink, and token-mismatch records; force never bypasses a
  live or malformed lease;
- negative traversal and symlink tests cover lock, temporary, no-force, force,
  cleanup, and final leaves; hardlink/source identity and source/final symlink
  collisions are rejected through opaque descriptor identities; and
- directory publication stages all children then performs one no-replace rename.
  Tests inject final-root creation, parent replacement, child/stage failures,
  and an indeterminate publish result, asserting no blind retry, no unknown
  recursive deletion, and either no final root or a clearly committed root.

Run `secureDestinationRace.test.ts` only when the capability manifest reports
supported. On supported Linux, it must cover descriptor-relative root traversal,
symlink rejection, parent-directory replacement during lock/temp/no-force/force,
source/output recheck, live/malformed/stale locks, and no output escape. A
supported race failure is a release blocker; do not skip it by changing the
manifest.

**Stop condition:** any modern file path invokes a JavaScript filesystem fallback,
an existing split root is adopted, no-force can clobber, or a private artifact
bypasses aggregate reservation/cleanup.

## Rollback

If native or race acceptance fails, disable only modern file/directory publication
and retain stdout plus the legacy compatibility output. Do not mark the manifest
supported and do not replace the failed implementation with `fs.rename` or path
based locks. Remove only newly created artifacts proven to be owned by the
conversion; leave any unknown/attacker-inserted entry untouched and report the
cleanup failure. Rerun package, reader, and compatibility checks.

## B2 remediation addendum — implementation-exact native contracts

This addendum is normative and supersedes the generic ABI and force/cleanup
wording above. It is the implementer-facing companion to the B2 section in the
controlling publication spec.

### Stage child ABI and ownership

`createFileTemp(parent, lease)` is for a non-split file only; it cannot populate
a split stage. Directory output uses these native-owned opaque handles:

```text
createDirectoryStage(parent, lease) -> StageHandle
createStageChild(stage, validatedLeaf) -> StageChildHandle
writeStageChild(child, Uint8Array) -> WriteResult
flushStageChild(child) -> FlushResult
closeStageChild(child) -> StageChildIdentity
abortStageChild(child) -> CleanupResult
verifyDirectoryStage(stage, readonly {
  handle: StageChildHandle,
  expectedLeaf: ValidatedLeaf,
  expectedIdentity: StageChildIdentity,
}[]) -> StageVerified
publishDirectory(lease, stage, finalLeaf) -> PublishResult
```

`createStageChild` performs
`openat(stageFd, leaf, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC, 0600)`.
A leaf is one component, at most 200 UTF-8 bytes, with no NUL, `/`, `\\`, `.`,
or `..`; native code validates it independently. `write`, `flush`, and `close`
use the opaque handle, not a path or exposed fd. A closed child remains at its
stage entry and returns `(leaf, device, inode, regular-type, size)`; that entry,
not a sibling, becomes a final child when the stage directory is renamed.

`verifyDirectoryStage` requires each supplied child handle to be closed and
fresh-enumerates the stage descriptor for a one-to-one match between expected
leaf/identity pairs and all entries. Missing, duplicate, symlink, directory, or
unknown entries fail verification. Unknown
entries are never opened or removed. Child states are `OPEN -> CLOSED ->
TRANSFERRED` or `OPEN -> ABORTED`; stage states are `OPEN -> VERIFIED ->
TRANSFERRED` or `OPEN -> ABORTED`. The single publication is
`renameat2(parentFd, stageLeaf, parentFd, finalLeaf, RENAME_NOREPLACE)` (or a
proven equivalent), so no child rename/link is deferred until publication.

### Source-handle binding and source race fixture

`openSourceIdentity` returns a `SourceHandle` containing the opened regular
main descriptor, source parent descriptor/main leaf, and original
(device,inode,type,size) identity. The default source policy is no-follow;
explicit follow-symlinks resolves once and binds that resolved descriptor. The
reader passes this handle to `acquireSnapshotBundle(sourceHandle, ...)`; main,
WAL, and SHM bytes are read from descriptors held by the handle/parent, never
from `sourcePath` strings. Identity and bytes are checked before and after each
copy. Immediately before publication, native `fstatat` rechecks the held
source-parent/main-leaf against the SourceHandle identity and then performs the
source/output comparison. The handle remains live through that check and the
native commit barrier. The reader-owned SQLite connection, materialized main,
copied WAL bundle, and private reader staging close after metadata/row iteration;
they do not close the SourceHandle or its source-parent handle. The conversion
retains SourceHandle plus the trusted destination ParentHandle and LeaseHandle
through final recheck and publication, then releases/closes them in `finally`
after definite or one-time indeterminate reconciliation. Lifecycle tests must
prove no retained handle closes before the final recheck.

Required bounded changes are `src/cdb/sourceHandle.ts` (or an equivalent),
`src/cdb/snapshotBundle.ts`, `src/cdb/iterateRows.ts`, the metadata-aware reader
session, and `tests/reader/sourceHandleBinding.test.ts`. The fixture swaps the
main path and any sidecars between planning, snapshot copy, materialization, and
commit. It must prove replacement bytes are never read; stable original-handle
output or definite source-mutation rejection are valid, while an evadable path
recheck is not.

### Force publication truth table

`--force` is an authorization, not unconditional replacement. This package
explicitly does not support the expected-present replacement branch: Linux
`RENAME_NOREPLACE` proves an absent-final commit, but an identity check followed
by ordinary rename is racy and `RENAME_EXCHANGE` is not an inode compare-and-
swap. The capability manifest MUST report `identityGuardedReplace: false`; no
`replaceIfIdentityMatches` ABI or TypeScript placeholder is permitted.

| Authorization | Required publication check | Race/result |
|---|---|---|
| `ABSENT` (with or without `--force`) | `RENAME_NOREPLACE` | final appearing after reservation/recheck => `NOT_COMMITTED`, never clobber |
| `EXPECTED_PRESENT(E)` regular final without `--force` | output-conflict rejection | incumbent remains untouched |
| `EXPECTED_PRESENT(E)` regular final with `--force` | structural preflight returns `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) before discovery; no staging or input open | incumbent remains untouched; no compare/publish is attempted |
| unsafe final type/source identity | reject before staging | output conflict/identity failure; force does not bypass |

`publishFile` accepts only an absent-final authorization in this package. A
final appearing after preflight or lease recheck is never an authorized
incumbent, even with force. An unprovable no-replace result is
`INDETERMINATE`, reconciled once with no retry. The race suite explicitly tests
force against an expected regular incumbent and asserts the unsupported
pre-discovery branch, alongside absent-final, symlink, directory, and
hardlink/source-identity races and definite outcomes.

### Parent policy and replacement result

`createMissingParents` is removed from the modern operation or fixed to `false`;
missing parents are rejected. Every component must already be an existing,
non-symlink directory; empty/trailing/`.`/`..` components are invalid. Absolute
paths are supported only by opening `/` as a trusted anchor and traversing
no-follow with `openat2`; relative paths use a held process-cwd directory fd.
Every later call receives only `ParentHandle` plus a validated final leaf. No
`AT_FDCWD` or path fallback is allowed after acquisition.

`ParentHandle` records anchor and parent identities. Preflight, lease, stage,
source/output check, publication, and cleanup revalidate reachability. A changed
parent path returns `NOT_COMMITTED/PARENT_REPLACED`. A replacement after the
final check may result in a safe commit to the already-held old parent, which
must be reported `COMMITTED` with `SAFE_OLD_PARENT` and the old identity; it
must never follow the replacement. Tests inject replacement at every boundary
and accept only no commit or a safe old-inode commit.

### Lease grammar, stale reclaim, and cleanup states

The lock leaf is `.cdb-destination-lock-<sha256(scope + NUL + targetLeaf)>`
(64 lowercase hex). The maximum 512-byte UTF-8 record is exactly:

```text
cdb-destination-lock/1
owner=<32 lowercase hex>
pid=<1..10 decimal>
createdNs=<1..20 decimal>
scope=file|directory
target=<base64url-no-padding UTF-8 leaf>
```

The target leaf is <=200 UTF-8 bytes. Overlong, partial, malformed,
non-canonical, non-regular, symlinked, target-mismatched, or token-mismatched
records are refused even with force. Only a complete record whose `kill(pid, 0)`
returns `ESRCH` is stale; `0` and `EPERM` are live. A final plus stale lease is
still an existing destination, never an adopted tree.

Stale reclaim is one native identity-guarded operation:
`reclaimStaleLease(parent, expectedLockIdentity, replacementRecord)`. It
revalidates identity/bytes and `ESRCH`, removes only that exact record, creates
the replacement with `O_CREAT|O_EXCL|O_NOFOLLOW`, flushes and reads it back, and
returns a lease only after success. Any race or unsupported identity primitive
returns `REFUSED`/`INDETERMINATE`, leaves unknown entries untouched, and never
performs a JavaScript unlink/create sequence.

Native handle states are fixed:

```text
Parent OPEN->CLOSED; Source OPEN->CLOSED;
Lease HELD->RELEASE_PENDING->RELEASED|RELEASE_FAILED;
Temp OPEN->CLOSED->PUBLISHED|ABORTED;
Stage OPEN->VERIFIED->TRANSFERRED|ABORTED;
StageChild OPEN->CLOSED->TRANSFERRED|ABORTED.
```

`cleanup(handle)` closes first and removes only exact owned temp/child identities;
it removes a stage only after exact-empty verification, releases only a matching
lease token, and only closes parent/source handles. Transferred/published cleanup
is a no-op. Unknown entries, identity mismatches, and post-commit lease cleanup
failure produce `OUTPUT_CLEANUP_FAILED` without retry, relabeling, or recursive
deletion.

Reconcile an uncertain publication exactly once with this matrix:

| Observation | Result/action |
|---|---|
| final identity equals owned published temp/stage | `COMMITTED`; preserve final, transfer ownership, release lease only |
| final absent with owned temp/stage live | `NOT_COMMITTED`; remove only owned temp/stage |
| expected incumbent remains with owned temp/stage live | `NOT_COMMITTED`; preserve incumbent and remove only owned temp/stage |
| both final and temp/stage names exist | `INDETERMINATE` unless identity proves an owned disposable alias; preserve final and never recursively clean |
| mismatched/attacker final, symlink, directory, or source identity | `INDETERMINATE` if uncertain, else `NOT_COMMITTED`; preserve final |
| final committed but lease release fails | `COMMITTED` plus cleanup diagnostic; no retry/destructive cleanup |
| unknown stage entry | verification failure/`INDETERMINATE`; leave unknown entry/stage in place |

Only a proven final enters `COMMITTED`; otherwise return `OUTPUT_WRITE_FAILED`
(exit 6), preserve every unproven final, and do not retry. Add these vectors to
`tests/cli/secureDestinationRace.test.ts` and
`tests/cli/destinationLifecycle.test.ts`; run them with the source binding test
using the focused gate in the controlling spec.
