# Phase P3 — CLI contract, raw profile, and secure publication (delivery Phase 2)

## Status and planning delta

This is the tactical Phase 2 plan for the accepted package in:

- `docs/cdb-to-json-cli-refactor/spec.md` (tactical source of truth);
- `docs/cdb-to-json-cli-refactor-spec.md` (product contract); and
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md` (normative D1–D8 delta).

Phase 0–1 reader/compatibility work is treated as the dependency checkpoint. This
phase must not begin card decoding or text segmentation. It is responsible for
making the raw profile and the four CLI commands usable while preserving the
physical-snapshot, resource, cancellation, and publication guarantees already
selected by the senior remediation.

### Verified repository checkpoint

The repository contains a TypeScript/ESM scaffold and Phase 0–1 implementation,
but not a working Phase 2:

- `src/application/convertCatalog.ts` currently collects `RawCardRows` in memory,
  does not map a profile, and does not publish output;
- `src/cli.ts` has partial argument handling and a placeholder `schema` response;
- `src/cli/parseArgs.ts` uses permissive parsing and does not implement the complete
  option/output matrix;
- `src/destinations/secureDestination.ts` is only a capability/interface
  placeholder and always reports unsupported;
- the native tree is present, but the current C++ surface includes path-based lock
  helpers and the rename implementation is not yet the audited no-clobber adapter;
- `schemas/cdb.raw.v1.schema.json` exists, but raw serialization and aggregate
  validation are not wired into the application;
- `package.json` already provides the focused Phase 2 test script names, while the
  current full suite is slow in this environment (an attempted `npm test` exceeded
  the 120-second command budget); `npm run package:check` passes on the current
  unsupported-host manifest.

These are implementation findings, not changes to the normative product contract.
The implementer must verify each item against the working tree before changing it.

## Outcome

Ship a CLI that can perform the replacement raw workflow:

```bash
node dist/cli.js convert __tests__/input_dir/cards.cdb \
  --profile raw --format json --output - > /tmp/cards.raw.json
node dist/cli.js inspect __tests__/input_dir/cards.cdb --diagnostics json \
  > /tmp/cards.inspect.json
node dist/cli.js validate __tests__/input_dir/cards.cdb --strict
node dist/cli.js schema raw > /tmp/cdb.raw.schema.json
```

The output stream contains converted data only. Human diagnostics and progress are
on stderr. Library/application modules accept injected writers and an optional
`AbortSignal`; they never use process-global `console.*` or terminal state.

## Fixed behavior and scope

### Command and option validation

`convert`, `inspect`, `validate`, and `schema` must return stable exit `2` for
invalid command/option combinations without discovering or opening an input. Use
`node:util.parseArgs`, but retain parse errors as structured usage diagnostics
rather than silently turning them into help.

Implement the complete matrix from `spec.md` §“Revision-3 output contract”: raw
produces one `cdb.raw/1` envelope per database; card/source aggregate JSON produces
arrays; JSONL produces one item per line; `split=database` is for unmerged inputs;
`split=card` requires a merged card/source directory; raw cannot merge or split by
card. The public registry controls `--setcode-registry` and
`--availability-registry` must parse as explicit options, reject invalid values
before discovery or SQLite access, and carry their selected content hashes into the
later card normalization/provenance context. Reject before input access:

- multiple unmerged inputs with `split=none`;
- merge with raw or `split=database`;
- split-card without card/source, merge, and a directory destination;
- stdout when more than one logical output exists;
- file/directory destination mismatches;
- `pretty` with JSONL;
- invalid profile/format/split/conflict/diagnostics or registry-option values;
- unsafe or existing split roots; and
- `maxSpoolBytes > maxStagingBytes` or `maxSnapshotBytes > maxStagingBytes`.

Normalize defaults and semantic options once. The normalized limits object must be
`LimitsV1`, must reject negative/non-safe integers, and must be passed unchanged to
reader, staging, diagnostics, and hashing. Presentation options (format, pretty,
output path, diagnostics rendering) do not enter semantic hashes.

### Raw profile and serialization

Implement `cdb.raw/1` as a database envelope with stable property order:

- `schema` and `integerEncoding: "signed-int64-decimal"`;
- source filename, verified physical bundle SHA-256, source size, and converter;
- supported `datas` and `texts` rows with all fixed columns, nulls, empty strings,
  and exact decoded UTF-8 line endings retained; and
- explicit extra-table metadata only (names, columns, counts), never an unbounded
  arbitrary-table value dump.

Raw JSON is one envelope, not an array. Raw JSONL is one complete envelope per
line. Card/source profiles are not implemented in this phase; their command paths
must fail as an explicit not-yet-available application capability or remain outside
Phase 2's gate rather than emitting a fake card/source record.

Serialization must be canonical and deterministic: fixed key order, UTF-8 output,
newline rules, compact JSON by default, and pretty JSON only where allowed. JSON
arrays and JSONL writers must write incrementally. Before each encoded write, reserve
against both the logical `maxOutputBytes` and aggregate `maxStagingBytes`; reconcile
actual growth and remove private state on error. A late stdout failure may leave
already-written bytes by contract; a file/directory logical unit may not publish a
partial final.

### Secure destinations and lifecycle

The destination boundary is:

- `src/destinations/secureDestination.ts`: typed public boundary, capability
  probing, trusted-root acquisition, relative path operations, reservation, temp
  creation, publication, and cleanup;
- `src/destinations/nativeAdapter.ts` (or an equally named adapter module): the
  sole loader/translator for the native ABI and stable error mapping;
- `native/secure-destination/src/secure_destination.{cc,h}`: audited descriptor
  relative primitives; and
- `scripts/build-native.mjs`: reproducible build and capability manifest.

On supported Linux (Node 22+, x64/arm64, kernel/filesystem providing `openat2`
with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow traversal, descriptor-relative
named `openat(O_CREAT|O_EXCL|O_NOFOLLOW)` temporary/lock creation, and separate
`renameat2` no-replace/force operations), file and directory destinations must use
the native adapter. This is the selected equivalent under the senior D5 decision;
`O_TMPFILE`, `linkat`, and path-based lock/rename helpers are not used. Acquire the
trusted destination root once, reject symlinked components, and perform lock,
temporary-file, no-force publication, force replacement, and cleanup relative to
that descriptor. No unchecked string path may be resolved after root acquisition.
A no-force publication must be no-clobber; `--force` only authorizes replacement of
an existing final after the reservation is held. A competing live or malformed lock
fails; only an explicitly stale lock may be removed according to the contract.

This is the `P3-AC3`/`INV-006` capability gate. On unsupported hosts or when any
required primitive/flag fails its probe, the operation is `UNSAFE_DESTINATION_FILESYSTEM`
(exit 6), before input snapshot/open, and there is no path-based fallback.

On unsupported hosts or when a required primitive/capability probe fails, file and
directory output fails with `UNSAFE_DESTINATION_FILESYSTEM` (exit `6`) before input
snapshot/open. There is no path-based fallback. Stdout remains supported and
non-atomic because it has no filesystem destination.

For `split=database` and `split=card`, `--output` must be a nonexistent fresh root.
Reject an empty or populated existing root with `OUTPUT_DIRECTORY_EXISTS` before
input access; `--force` does not override this. Legacy `<basename>.json`
replacement remains isolated to `src/legacy.ts` and is not a Phase 2 CLI shortcut.

Conversion owns the state machine
`READING -> READY -> COMMITTING -> COMMITTED` or `ABORTED`. The application owns
spools, reservations, locks, commit journals/backups, and temporary siblings. For a
no-continue run with multiple finals, it holds every final reservation and writes a
descriptor-relative commit journal before the first publication. Publication is
ordered; a failure between finals rolls back already-published entries in reverse
order, removing only this run's no-force finals and restoring force backups
byte-for-byte. A successful set removes journal/backups only after every final is
visible. `--continue-on-error` unmerged `split=database` remains per-database
atomic and is the explicit exception; merged output remains one final transaction.
Cleanup order is: abort row iteration; close writer; close SQLite; verify source
snapshot; rollback or retain recovery journal as needed; delete spool/index,
temporary files, backups, and reservations only after the commit outcome is known.
A signal before the synchronous commit-set barrier returns exit `6` without
publication. A signal during a completed barrier cannot roll back or misreport a
committed final. The CLI installs/removes one SIGINT handler around `convert()` and
passes its signal.

## Ordered implementation tasks

### 2.1 Freeze command parsing and pre-open validation

**Files:**

- `src/cli.ts`;
- `src/cli/parseArgs.ts`;
- `src/cli/renderHelp.ts`;
- `src/cli/renderDiagnostics.ts`;
- `src/cli/exitCodes.ts`;
- new `src/commands/convert.ts`, `inspect.ts`, `validate.ts`, `schema.ts`;
- new `src/application/commandValidation.ts` (or a clearly named equivalent);
- `tests/cli/parseArgs.test.ts`, `tests/cli/exitCodes.test.ts`, and
  `tests/cli/commandMatrix.test.ts`.

Tasks:

1. Make parse failures, unknown options, repeated options, `-o -`, command aliases,
   and positional inputs explicit in the parsed result. Keep help/version handling
   separate from conversion.
2. Normalize profile/format/split/merge/output defaults and build a logical-output
   plan before `discoverInputs()`. Include deterministic database/card filenames
   and sanitized stems in that plan.
3. Validate all matrix rules, destination kind rules, limit relations, fresh split
   roots, native capability requirements, and input/output identity rules before
   snapshot acquisition or SQLite opening.
4. Map diagnostics through the single explicit predicate matrix in `src/cli/exitCodes.ts`: option (`2`), `!hasUsableInput && !inputAccessStarted` with no input/strict/resource/collision/output/cancellation/internal failure (`3`), output/cancellation (`6`), input/schema/strict/resource/integer without output failure (`4`), merge collision without output/input failure (`5`), mixed continuation (`7`), internal (`1`), then success (`0`). Preserve source phase and stable machine envelopes.
5. Render data only to the injected stdout writer and diagnostics only to injected
   stderr. Add SIGINT ownership in `main()` with cleanup in `finally`.

**Stop condition:** a negative command-matrix test observes a reader/snapshot call,
or any diagnostic/progress text appears in stdout.

### 2.2 Build the raw conversion pipeline

**Files:**

- `src/application/convertCatalog.ts`;
- `src/application/types.ts`;
- new `src/application/outputPlan.ts`;
- new `src/profiles/rawProfile.ts`;
- new `src/cdb/iterateRawTables.ts` (or a bounded equivalent behind the raw profile);
- new `src/serialization/canonicalJson.ts`;
- new `src/serialization/jsonArrayWriter.ts`;
- new `src/serialization/jsonLinesWriter.ts`;
- `src/hashing/sha256.ts` and provenance helpers as needed;
- `schemas/cdb.raw.v1.schema.json` plus aggregate schemas where needed; and
- `tests/cli/rawProfile.test.ts`, `tests/cli/serialization.test.ts`,
  `tests/conformance/rawOutput.test.ts`, `tests/cli/rawMemoryBound.test.ts`;
- `tests/fixtures/buildHighCardinalityRawCdb.ts`.

Tasks:

1. Replace the in-memory `RawCardRows[]` path for raw output with a sequential
   reader-to-profile-to-writer pipeline. The raw envelope writer must emit
   `tables.datas` and `tables.texts` arrays incrementally from fixed table/branch
   iterators ordered by canonical signed-int64 ID and per-table ordinal; it may use
   a bounded two-pass table iterator but MUST NOT accumulate `RawCardRows[]`, a
   `datas[]`/`texts[]` collector for the complete database, or any equivalent
   all-record structure. Do not retain all databases or merged card records. The
   writer enforces `maxOutputBytes` for every encoded chunk; private file/directory
   destinations also reserve `maxStagingBytes`, while stdout reserves only
   `maxOutputBytes` because it is non-atomic. If the configured limit cannot be
   satisfied, fail before publication.
2. Add a raw envelope mapper that keeps decimal-string INTEGER values as strings,
   preserves all supported null/text values, records verified physical source
   facts, and emits complete source diagnostics. Validate incomplete join behavior
   against the established raw boundary rather than inventing placeholders.
3. Implement canonical JSON and incremental writers. Cover empty arrays, one record,
   Unicode/line endings, signed-int64 extrema, write failure, output byte limits,
   and JSONL newline behavior. Raw JSONL must emit complete envelopes, not row
   records. Add `tests/cli/rawMemoryBound.test.ts` and a generated high-cardinality
   raw fixture; run conversion in a child process with `--max-old-space-size=256`,
   compare streamed output to an independently collected reference, and assert by
   spy/inspection that the raw writer never calls an all-record collector.
4. Create an application destination interface for stdout, one file, per-database
   directory outputs, and future split-card outputs. It must expose write, flush,
   close, abort, and commit ownership without leaking a `Writable` into domain
   modules.
5. Compute `conversionOptionsHash` only from the shared semantic options object;
   retain the physical snapshot bundle hash separately. Do not hash local absolute
   paths, output presentation, process timing, or lock tokens.

**Stop condition:** JSON and JSONL differ in decoded record content, an INTEGER is
rounded/coerced, the raw writer materializes a complete database table array in
memory, or a failed writer changes a pre-existing final.

### 2.3 Implement destination lifecycle and native boundary

**Files:**

- `src/destinations/secureDestination.ts`;
- new `src/destinations/nativeAdapter.ts`;
- new `src/destinations/atomicFile.ts`;
  `fileDestination.ts`; `directoryDestination.ts`; `stdoutDestination.ts`;
- `src/application/stagingBudget.ts`;
- `native/secure-destination/src/secure_destination.{cc,h}`;
- `native/secure-destination/binding.gyp`;
- `scripts/build-native.mjs`, `scripts/package-check.mjs`;
- new `tests/cli/destinationLifecycle.test.ts`;
  `freshSplitRoot.test.ts`; `secureDestinationRace.test.ts`;
  `commitSetRollback.test.ts`; `commitSetRecovery.test.ts`; and
  `pathSafety.test.ts`.

Tasks:

1. Freeze the native ABI in one small adapter. Remove path-based lock and rename
   helpers and the current `O_TMPFILE` implementation. The adapter must expose
   capability probe, trusted-root FD, descriptor-relative component traversal,
   exclusive lock/reservation using visible `O_CREAT|O_EXCL|O_NOFOLLOW` leaves,
   named temp creation, separate no-replace (`renameat2` with `RENAME_NOREPLACE`)
   and force replacement (`renameat2` with flags 0), descriptor close, and cleanup.
   Ensure any native error maps to a stable destination diagnostic.
2. Correct the build matrix and manifest: Node 22+ Linux x64/arm64 is eligible,
   but a successful build must still functionally prove trusted-root traversal,
   named temp/lock creation, no-replace publication, force replacement, and cleanup.
   Unsupported, failed, or malformed-probe builds remove stale binaries and publish
   an explicit unsupported manifest. `package:check` must reject a manifest that
   claims support without a hash-matching module and reject any unsupported manifest
   beside a module.
3. Implement fresh split-root checks and destination path identity checks before
   opening an input. Test parent-directory replacement during lock, temp creation,
   no-force publish, and force publish; prove no output escapes the selected root.
4. Add reservations for locks, temp files, commit journals/backups, merge-private
   state, snapshots, and materialized files to one aggregate staging budget. Keep the
   dedicated `maxSnapshotBytes` counter for copied source members, materialized main,
   and generated private SQLite files; reserve every snapshot/materialization chunk
   before writing and reconcile growth. Reserve before each private file/directory
   write, reconcile actual growth, and clean reservations on every exit path. Do not
   charge stdout against `maxStagingBytes`; it remains subject to `maxOutputBytes` and
   explicitly non-atomic.
5. Implement the commit-set journal and reverse rollback. Add
   `tests/cli/commitSetRollback.test.ts` with injected failure after each publication
   position for no-force and force, proving removal/restoration, byte-identical prior
   finals, lock/journal/backup cleanup, and a successful rerun. Add
   `tests/cli/commitSetRecovery.test.ts` for rollback failure: retain the recovery
   journal/backups, identify them in diagnostics, refuse an unsafe rerun, and return
   exit `6`.
6. Test state transitions and cancellation before, during, and after the commit-set
   barrier. Keep prior finals byte-identical on pre-commit abort or writer failure;
   post-barrier cancellation must leave the committed set and successful status intact.

**Stop condition:** any filesystem path fallback is used when native capability is
unavailable, an existing split root is adopted, or a concurrent invocation can
clobber a final without the authorized force path.

### 2.4 Add inspect, validate, and schema commands

**Files:**

- new `src/application/inspectInputs.ts`;
- new `src/application/validateInputs.ts`;
- `src/commands/inspect.ts`, `validate.ts`, `schema.ts`;
- `schemas/*.json` and `scripts/package-check.mjs`;
- `tests/cli/inspectValidateSchema.test.ts`;
  `tests/conformance/schemaSelection.test.ts`.

Tasks:

1. `inspect` reports display-safe source path, physical bundle SHA-256 and size,
   required/extra tables and columns, row counts, orphan/duplicate summaries, and
   decoding warnings without producing card output.
2. `validate` runs schema, storage-class, row, text, limit, and strict policy checks
   without creating converted output. It must close all snapshot/materialization
   resources.
3. `schema raw` emits `cdb.raw/1`; add deterministic `schema card-array` and
   `schema source-array` selection for later profiles while retaining distinct item
   schemas. Schema output may be written atomically with `--output` and must use the
   same destination rules.
4. Ensure raw schema permits exactly the supported null states and signed-int64
   strings required by the Phase 0 reader; do not broaden it to arbitrary table
   values.

**Stop condition:** inspect/validate emits converted records, schema output is
non-deterministic, or schema selection opens SQLite.

### 2.5 Compiled CLI and process smoke gate

**Files:**

- new `tests/cli/processSmoke.test.ts`;
- generated fixtures under `tests/cli/fixtures/` or reuse
  `tests/fixtures/buildCdbFixture.ts`;
- `README.md` and migration documentation only for the Phase 2 workflow.

Spawn `dist/cli.js` and cover:

- one-file raw JSON stdout and raw JSONL;
- one database per-directory output and deterministic filenames;
- inspect, validate, and all schema selectors;
- invalid matrix options and limit relations failing before SQLite;
- missing input (exit `3`), input/schema/resource failure (exit `4`), output conflict
  or cancellation (exit `6`), and partial unmerged continuation (exit `7`);
- no-force/force conflicts, fresh split roots, pre-existing-final preservation;
- stdout/stderr separation and late non-atomic stdout failure; and
- SIGINT during iteration, delayed write, and commit-barrier tests.

Use a spy reader for pre-open ordering tests and real child processes for signal,
stream, and two-process race tests. Do not make an unsupported host pass by using
an insecure file writer; run native destination tests only when the capability
manifest says supported and run the explicit unsupported-host failure test
otherwise.

## Verification commands and gates

Focused implementation gates, in dependency order:

```bash
npm run build
npm run test:fixtures
npm run test:unit
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
```

The phase gate is the exact sequence:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
```

A full repository gate remains:

```bash
npm test
```

The current environment's full suite may exceed a short command timeout; an
implementer must report the complete command result rather than treating a timeout
as success. `npm run package:check` must pass on both the unsupported-host manifest
and the native-supported release matrix.

## Acceptance criteria

1. Every invalid command/output/profile/format/split/merge/limit combination fails
   with exit `2` before discovery, snapshot acquisition, or SQLite opening.
2. The raw replacement command emits schema-valid `cdb.raw/1` data to stdout, with
   no human diagnostics in stdout, and raw JSONL emits complete envelopes.
3. Supported source integers remain exact signed-int64 decimal strings, supported
   text/null values retain exact decoded content, and malformed values fail with
   stable diagnostics rather than coercion.
4. JSON and JSONL writers are incremental and deterministic; raw envelope table
   arrays are streamed without a complete per-database collector; output limits and
   private aggregate staging limits are enforced before writes, while stdout is
   charged only to `maxOutputBytes`, and all private state is cleaned up.
5. File and split-directory outputs are atomic per logical unit; no-continue
   multi-output runs use the commit-set journal and reverse rollback to restore
   force backups/remove new no-force finals after an injected between-final
   failure. Rollback cleanup is proven, rollback failure retains explicit recovery
   state and returns exit `6`, existing split roots remain rejected, and the
   documented continue/merge semantics remain intact.
6. On a supported Linux capability matrix, all destination operations are
   descriptor-relative and pass parent-swap, symlink, stale/live-lock, force, and
   no-force race tests. On unsupported hosts, file/directory output fails with
   `UNSAFE_DESTINATION_FILESYSTEM` while stdout remains available.
7. Snapshot/materialization, output staging, locks, commit journals/backups, and
   merge-private state share finite reservation accounting; `maxSnapshotBytes` is
   enforced as a chunk-level aggregate snapshot/materialization budget (not only a
   pre-copy sum), limit relations are enforced before input access, raw
   high-cardinality envelopes stay bounded, and stdout is charged only to
   `maxOutputBytes`.
8. `inspect`, `validate`, and `schema` produce deterministic machine-readable
   output, never create converted output, and expose item versus aggregate schemas.
9. SIGINT and writer failures close readers/writers and remove private artifacts;
   pre-commit cancellation returns exit `6`, while a post-barrier committed result
   remains successful.
10. The compiled process smoke gate and `npm run package:check` pass, and the
    Phase 0–1 reader/compatibility tests remain green.

## Risks, unknowns, and stop/rollback rules

- **Native adapter risk:** the current native source is not yet an audited secure
  adapter. If descriptor-relative no-replace publication or capability probing
  cannot be proven, stop Phase 2 and retain stdout plus the v1 compatibility path;
  do not introduce a path-based fallback.
- **WAL/staging accounting risk:** if materialized files or sidecars bypass the
  aggregate reservation, stop before enabling output publication and add a fixture.
- **Streaming/atomicity tension:** stdout is intentionally non-atomic and consumes
  only `maxOutputBytes`; file and directory outputs are private-staged, consume
  aggregate `maxStagingBytes`, and use a commit-set transaction when a no-continue
  conversion has multiple finals. Do not weaken one contract to simplify the other.
- **Commit-set rollback risk:** a sequential native rename can fail after an earlier
  final is visible, especially with `--force`. Hold all reservations, journal every
  publication, use descriptor-relative reverse rollback and force backups, and
  retain recovery state if rollback itself fails; never leave this behavior
  undocumented or call it all-or-nothing without the gate.
- **Schema drift:** if raw nullability or integer encoding requires a schema change,
  update the named schema and conformance fixtures together; do not add an implicit
  alias or broaden the raw contract.
- **Cancellation race:** if a signal can leave a temp/lock or alter a pre-existing
  final, stop release work until cleanup and the commit barrier are observable.
- **Unsupported host:** do not mark the current Node/OS as supported merely because
  the native module compiles; the capability manifest must prove the required
  primitives and ABI.

Rollback removes only Phase 2 command handlers, profiles, serializers, and
publication adapters while retaining the Phase 0–1 reader, schemas, and legacy
bridge. No rollback path modifies an input CDB. There are no unresolved user
questions; the senior remediation explicitly selected the Linux-only hardened
file-destination scope.

## Handoff notes

This is a Phase 2 follow-up to the accepted tactical package, not a new product
specification. Plan review should check the concrete current-code gaps above and
verify that every D1–D8 requirement has a named source module, diagnostic path, and
focused or process-level test before implementation starts.

## Revision-12 publication and dispatch correction

The commit-set tasks above are superseded where they omit identity guards or
crash semantics. Use `phase-r11-enforcement-and-gates.md` R12.3: fsync the
canonical descriptor-relative journal before and between publications, record
complete staged/published/backup identities, remove or restore only an exact
identity, and refuse an orphaned non-committed journal with
`OUTPUT_RECOVERY_REQUIRED` (exit 6). Add inter-final mutation and child-process
interruption tests; a rollback failure retains recovery state.

Modern and legacy file publication both require the declared native capability;
there is no path fallback. P3 dispatch is blocked by
`scripts/phase-dispatch-check.mjs` until the authoritative P1/P2 scripts fail on
missing suites (no `--passWithNoTests`) and a fresh P1/P2 evidence record passes.
