# Phase 6 — compiled process gate and documentation delta

## Goal and dependency

Prove the complete raw Phase 2 path through `dist/cli.js`, including stream
separation, pre-open ordering, atomicity/cancellation, and the truthful native
support matrix. This phase depends on all prior phases and is the release gate;
it must not expand into card/source implementation.

## Files and bounded discovery

Create or extend:

- `tests/cli/processSmoke.test.ts`
- `tests/cli/fixtures/` or `tests/fixtures/buildCdbFixture.ts`
- `README.md` for the raw replacement workflow and destination caveat only
- `package.json` scripts/exports only if a named gate or checked-in schema is not
  currently included

Use the existing compiled CLI path and fixture builder. Use injected spies for
pre-open ordering and child processes for streams, signals, delayed writes, and
race behavior. Do not rely on a unit import of `main()` for process semantics.

## Process scenarios

Spawn `dist/cli.js` and cover:

1. one-input raw JSON to stdout and one-input raw JSONL to stdout;
2. one-input raw file output when the capability manifest is supported, or
   explicit exit-6 `UNSAFE_DESTINATION_FILESYSTEM` with zero reader/snapshot
   calls when it is unsupported; the current Node 26 result is only the baseline
   branch, not a hard-coded expectation;
3. multiple-input raw `split=database` deterministic filenames, fresh-root
   rejection for existing empty/populated roots, force non-override, and the
   one-directory transaction (all children staged, one descriptor-relative
   no-replace rename);
4. `inspect` and `validate` machine output with all diagnostics isolated to
   stderr;
5. `schema raw`, `schema card`, `schema card-array`, `schema source`, and
   `schema source-array` stdout output plus safe `--output` behavior;
6. invalid options, unavailable profiles, missing input, input/resource failure,
   output conflict, cancellation, and continued mixed database failure with
   exit codes 2/3/4/6/7 as applicable;
7. stderr text/json/jsonl/none modes, with stdout containing no human text;
8. child-process SIGINT during row iteration and delayed write, checking private
   artifact cleanup and pre-existing-final preservation; and
9. supported-host descriptor-relative parent swap/no-force/force races when the
   capability manifest is truthful, including final appearance after preflight,
   source hardlink/symlink identity, lock/temp/cleanup traversal, and lease
   liveness/malformed/token-mismatch cases; and
10. directory failures before and after every child, stage verification, and
    publication including an injected indeterminate result. Assert no blind
    retry, no recursive deletion of unknown entries, and either no final root or
    a clearly committed root.

Raw JSONL must parse as one complete `cdb.raw/1` object per line. File outputs
must be checked byte-for-byte before and after failed pre-commit attempts. Stdout
late failures are allowed to retain prior bytes but must report output failure on
stderr/exit state.

## Verification gate

Run the exact accepted Phase 2 sequence in order:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
```

Then run the complete repository gate with a timeout suitable for the reader
fixtures and report its full result:

```bash
npm test
```

If the test include configuration omits a new named test, update only the test
configuration or script required to execute it and rerun the full gate. The
native race suite is skipped only by an explicit unsupported capability
condition; the supported race branch is mandatory whenever the manifest reports
support, and the unsupported-host process branch is mandatory otherwise. The
clean-build gate must also prove that Node 22+ resolves `node-addon-api`, loads
its module, and records a truthful manifest on a supported candidate.

## Acceptance criteria and stop conditions

The phase is complete only when the compiled process gate proves:

- raw stdout JSON/JSONL is schema-valid, deterministic, and data-only;
- inspect/validate/schema are deterministic and diagnostics stay on stderr;
- invalid pre-open combinations do not touch discovery/snapshot/SQLite;
- file/directory outputs obey fresh-root, no-clobber, force, secure capability,
  staging, cleanup, and commit-barrier contracts; split directories commit once
  from an owned private stage and never adopt/recursively delete an existing
  tree; and
- reader, compatibility, CLI, package, and full-suite gates are recorded.

Stop release if stdout/stderr separation cannot be proven, SIGINT leaves an
owned private artifact, a pre-existing final changes after failure, or
supported-host publication races remain unproven. An unknown entry discovered
inside a private stage must remain untouched and be reported rather than removed
recursively. Do not waive a native failure by adding a path-based writer.

## Documentation and rollback

Document only the implemented raw CLI replacement workflow, explicit
`--profile raw` scope, stdout behavior, and Linux capability requirement. Do not
claim card/source conversion is complete.

Rollback removes Phase 2 command/destination/serializer wiring while retaining
Phase 0–1 reader and v1 compatibility. Verify build, reader, compatibility, and
package checks and confirm no input or pre-existing final was modified.

## B2 release-gate amendment

The compiled gate is not complete unless the supported native branch (when the
manifest is truthful) and the source-handle binding vectors are executable. Add
`tests/reader/sourceHandleBinding.test.ts` to the reader gate and run:

```bash
npx vitest run tests/reader/sourceHandleBinding.test.ts \
  tests/cli/nativeCapability.test.ts tests/cli/destinationLifecycle.test.ts \
  tests/cli/freshSplitRoot.test.ts tests/cli/pathSafety.test.ts \
  tests/cli/secureDestinationRace.test.ts
```

The process/race assertions must include: child creation/write/flush/close and
exact stage-entry verification; final appearance after reservation; force with an
expected regular incumbent must take the explicit
`UNSAFE_DESTINATION_FILESYSTEM` pre-discovery branch because
`identityGuardedReplace` is unsupported, while a newly appearing final in the
absent branch is never clobbered; source symlink/hardlink and source replacement
during snapshot; missing/absolute/relative parent policy; parent replacement at
preflight, lease, stage, publication, and cleanup; live, `EPERM`, `ESRCH`,
PID-present, malformed, partial, symlink, and token-mismatch leases; both names
present during indeterminate reconciliation; committed-final lease-release
failure; and unknown stage entries. It must prove no blind retry, no recursive
unknown-tree cleanup, and either a clearly committed result or no commit.
Unsupported native capability must fail before discovery/reader access with exit
6; a supported race failure is a release blocker, not a reason to change the
manifest. Lifecycle assertions must also prove SQLite/materialization cleanup
happens after reading while SourceHandle, trusted ParentHandle, and LeaseHandle
remain open through final identity recheck and the commit barrier, then close in
`finally`.

## Post-approval archive checklist

This older publication package remains an active reference until the Phase 2
implementation is explicitly approved. Do not perform this archive step as part
of implementation, review, or the verification gate. After approval, archive
both active Phase 2 packages as complete directories, retaining their names:

- `docs/cdb-to-json-cli-refactor-phase-2-remediation/` →
  `docs/archive/cdb-to-json-cli-refactor-phase-2-remediation/`;
- `docs/cdb-to-json-cli-refactor-phase-2-publication/` →
  `docs/archive/cdb-to-json-cli-refactor-phase-2-publication/`.

Use `git mv`, require both destination paths to be absent before moving, and
preserve every package file. Keep these normative source documents in place and
unchanged: `docs/cdb-to-json-cli-refactor-spec.md`,
`docs/cdb-to-json-cli-refactor/spec.md`,
`docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`,
`docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md`, and
`docs/cdb-to-json-cli-refactor/phase-2-cli-raw-output.md`. Update active links
that would otherwise point to the removed paths; historical links in the
archived copies may point to their new archive locations.

Run after the approved move:

```bash
set -euo pipefail
for name in \
  cdb-to-json-cli-refactor-phase-2-remediation \
  cdb-to-json-cli-refactor-phase-2-publication; do
  test ! -e "docs/$name"
  test -d "docs/archive/$name"
  test -n "$(find "docs/archive/$name" -type f -print -quit)"
done
for file in \
  docs/cdb-to-json-cli-refactor-spec.md \
  docs/cdb-to-json-cli-refactor/spec.md \
  docs/cdb-to-json-cli-refactor/senior-remediation-spec.md \
  docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md \
  docs/cdb-to-json-cli-refactor/phase-2-cli-raw-output.md; do
  test -f "$file"
done
find docs/archive/cdb-to-json-cli-refactor-phase-2-remediation \
     docs/archive/cdb-to-json-cli-refactor-phase-2-publication \
     -type f -print | sort
```
