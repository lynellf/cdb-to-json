# Phase 3 — descriptor-relative native destinations and atomic publication

**Depends on:** Phases 1–2. **Security stop point:** do not implement a path
fallback if any acceptance property cannot be proven.

## Task 3.1 — Truthful native build and sole ABI loader

**Files:** `native/secure-destination/src/secure_destination.cc`,
`native/secure-destination/src/secure_destination.h`,
`native/secure-destination/binding.gyp`, `scripts/build-native.mjs`,
`package.json`, `package-lock.json`; create
`src/destinations/nativeAdapter.ts`, `tests/cli/nativeCapability.test.ts`.

Add the exact build-time `node-addon-api@8.9.0` include/GYP wiring and make
Node 22+ Linux x64/arm64 build-eligible. Build only a module that loads and
passes primitive probes; write a manifest containing platform, architecture,
numeric Node ABI, N-API, supported primitives, module hash, and probe result.
Unsupported/failed builds remove stale modules and write an explicit unsupported
manifest. `package-check` must reject a hash mismatch, missing module for a
supported manifest, or stale module for an unsupported manifest.

`nativeAdapter.ts` is the only TypeScript ABI caller. Validate the manifest and
module hash at load, then probe the selected parent filesystem for openat2
no-follow traversal, exclusive lease/temp creation, and no-replace publication.
Translate all failures to `UNSAFE_DESTINATION_FILESYSTEM` exit 6. Do not infer
support from Node version alone.

**Verification:** clean `npm ci`, build/load, supported candidate and current
unsupported Node 26 branches, manifest/package checks. Run
`tests/cli/nativeCapability.test.ts` and `npm run package:check`.

**Stop:** any supported manifest exists without a loaded/probed module, or a
native failure is hidden by a JavaScript filesystem fallback.

## Task 3.2 — Opaque handle ABI and leases

**Files:** native files from Task 3.1; `src/destinations/secureDestination.ts`,
`src/destinations/nativeAdapter.ts`; create
`tests/cli/pathSafety.test.ts`, `tests/cli/secureDestinationRace.test.ts`.

Replace raw fd/path operations with native-owned opaque ParentHandle,
SourceHandle, LeaseHandle, TempHandle, StageHandle, and StageChildHandle values.
Only trusted parent/source acquisition accepts a path. Later operations accept a
trusted handle and validated one-component leaf; independently reject NUL,
separators, absolute names, empty/`.`/`..`, and overlong names.

Implement fixed lease records (`cdb-destination-lock/1`, owner token, decimal
PID, creation time, scope, target), `O_CREAT|O_EXCL|O_NOFOLLOW`, matching-token
release, and stale handling where only `ESRCH` is stale; `0` and `EPERM` remain
live. Malformed/partial/symlink/PID-present/token-mismatched leases refuse even
with force. Parent identity/reachability is rechecked at preflight, lease,
stage, source/output, publication, and cleanup.

Remove modern path-based `LockFile`, `UnlockFile`, and old/new-path rename
exports. Native publication returns `COMMITTED`, `NOT_COMMITTED`, or
`INDETERMINATE` with owned temp/stage identity; no blind retry is allowed.

**Verification:** run traversal/symlink/parent-swap/lease vectors on supported
capability; on unsupported hosts assert pre-discovery exit 6. Include source
symlinks/hardlinks and source replacement races. A supported race failure blocks
release; it is not a reason to mark the manifest unsupported.

## Task 3.3 — Atomic file destination

**Files:** create `src/destinations/atomicFile.ts`,
`src/destinations/fileDestination.ts`; change
`src/destinations/stdoutDestination.ts`, `src/application/outputPlan.ts`,
`src/application/convertCatalog.ts`; create
`tests/cli/destinationLifecycle.test.ts`.

Implement stdout as the only cross-platform non-atomic destination. File output
must acquire a trusted existing parent and lease, stage through a native temp
handle with aggregate reservations, close/flush before publication, recheck
source/final identity immediately before the barrier, and publish absent finals
with descriptor-relative `RENAME_NOREPLACE`. Existing no-force finals remain
untouched; force against an expected regular incumbent is the explicit
unsupported identity-guarded-replace branch before discovery. Final appearance
after an absent reservation is never clobbered. A failed or cancelled
pre-commit preserves an incumbent byte-for-byte and removes only owned temp/
lease artifacts.

## Task 3.4 — Fresh split-directory transaction

**Files:** create `src/destinations/directoryDestination.ts`; change native
adapter, `outputPlan.ts`, `convertCatalog.ts`, and staging budget; create
`tests/cli/freshSplitRoot.test.ts` and extend race/lifecycle tests.

Require a nonexistent split root; existing empty/populated roots fail with
`OUTPUT_DIRECTORY_EXISTS`, including force. Hold the trusted parent and lease,
create one private `0700` sibling stage, and expose a destination API that
accepts caller-supplied, already validated single-component child names. The
directory destination must not derive names from card text, raw rows, source
ordinals, or paths. For database split, the Phase 1 concrete plan supplies
those names before reading. For card split, it may hold an empty private stage
while the selected profile phase maps records and performs merge conflict
selection; only the completed final-record name manifest may call
`create/write/flush/close` on
StageChildHandles. Verify an exact one-to-one set of owned child identities with
fresh enumeration, then perform one descriptor-relative no-replace rename to
the final leaf. Unknown/attacker entries are never recursively deleted. On
failure—including a late name collision or duplicate—clean only exact owned
children/stage/lease handles; an indeterminate publish is reconciled once and
leaves uncertainty machine-readable.

**Verification and rollback:**

```bash
npm run build
npm run test:reader
npm run test:cli -- --run tests/cli/nativeCapability.test.ts tests/cli/destinationLifecycle.test.ts tests/cli/freshSplitRoot.test.ts tests/cli/pathSafety.test.ts tests/cli/conversionLifecycle.test.ts
npm run package:check
```

The destination tests must include an empty-stage/late-name-plan failure and
prove that the final root remains absent and no attacker entry is removed. The
late-name allocator itself is verified with mapped/merged fixtures in Phase 5;
these destination tests verify that it receives opaque, already validated
leaves only.

If descriptor-relative no-clobber, source identity, stage ownership, or race
cleanup cannot be proven, stop modern file/directory work, retain stdout and
legacy compatibility, and do not add `fs.rename`, path locks, or recursive
fallback cleanup.
