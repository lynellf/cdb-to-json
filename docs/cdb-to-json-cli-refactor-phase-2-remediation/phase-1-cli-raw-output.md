# Phase 1 — Implement Phase 2 CLI/raw-output wiring

## Purpose

This phase is the implementation-ready translation of accepted Phase 2 tasks
**2.1–2.5**. It is deliberately ordered so each checkpoint leaves the previous
Phase 0–1 gates usable. Do not begin card/source normalization while executing
this phase.

## Dependency checkpoint

Before changing code, run:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run package:check
```

Record the baseline. Node major >=22 on Linux x64/arm64 is build-eligible, but
file/directory support is determined by the post-build capability manifest and
runtime primitive probe, not by a version string. The current Node 26 baseline
may legitimately produce an unsupported manifest; do not hard-code that outcome,
and never make an unsupported host pass file output by adding a JavaScript
fallback.

## Task 2.1 — Freeze parsing, normalized options, and pre-open output planning

**Depends on:** Phase 0–1 reader/compatibility checkpoint.

**Files to change/create:**

- `src/cli/parseArgs.ts`
- `src/cli.ts`
- `src/cli/exitCodes.ts`
- `src/cli/renderHelp.ts`
- `src/cli/renderDiagnostics.ts`
- `src/application/types.ts`
- `src/application/outputPlan.ts` (new)
- `src/application/commandValidation.ts` (new, or equivalent named module)
- `src/commands/convert.ts` (new)
- `src/commands/inspect.ts` (new)
- `src/commands/validate.ts` (new)
- `src/commands/schema.ts` (new)
- `src/diagnostics/codes.ts` to freeze `PROFILE_NOT_AVAILABLE` for the
  unavailable card/source capability
- `tests/cli/parseArgs.test.ts` (new)
- `tests/cli/commandMatrix.test.ts` (new)
- `tests/cli/exitCodes.test.ts` (extend existing)
- `tests/cli/limitRelations.test.ts` (extend the exact inherited R5.6 gate)

### Implementation contract

1. Replace permissive parsing with strict `node:util.parseArgs` definitions.
   Return a typed `CliArgs` plus a structured parse/usage diagnostic. Unknown
   options, missing option values, malformed numeric values, duplicate
   non-repeatable options, and invalid command positionals must not become help.
   Keep `help`, `--help`, `version`, and `--version` handling separate from
   conversion.
2. Define common options and convert options exactly once, including:
   `profile`, `format`, `output`, `split`, `merge`, `on-conflict`, `pretty`,
   `force`, `include-raw`, `locale`, `source-namespace`, `strict`, `recursive`,
   repeatable `exclude`, `follow-symlinks`, `diagnostics`,
   `continue-on-error`, and all six resource-limit flags.
3. Normalize all numeric limits as non-negative safe integers into one `LimitsV1`.
   Reject `maxSpoolBytes > maxStagingBytes` and
   `maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION`; never
   clamp. Pass this same object to reader, staging, diagnostics, and hashing.
4. `outputPlan.ts` must expose a pure structural planner, for example:

   ```ts
   type NormalizedConvertOptions = {
     profile: "raw" | "card" | "source";
     format: "json" | "jsonl";
     split: "none" | "database" | "card" | "auto";
     merge: boolean;
     onConflict: "error" | "first" | "last";
     destination: { kind: "stdout" | "file" | "directory"; path?: string };
     limits: LimitsV1;
     // semantic options and presentation options kept separate
   };

   type ConcreteOutput = {
     inputOrdinal: number;
     inputPath: string;
     relativeName: string;
     logicalOutputId: string;
   };
   ```

   The exact type names may vary, but the structural plan must be complete before
   `discoverInputs()` and no method may open SQLite. Use an internal `auto` mode
   if the public default must become `split=none` for one discovered input and
   `split=database` for multiple unmerged inputs.
5. Run structural destination preflight before `discoverInputs()` and before
   any snapshot/open: acquire a trusted existing parent descriptor, validate the
   destination leaf, reject an existing split root with `OUTPUT_DIRECTORY_EXISTS`,
   and run a side-effect-contained probe on the selected filesystem for
   no-symlink traversal, exclusive lease/temp creation, and no-replace publication.
   Failure returns `UNSAFE_DESTINATION_FILESYSTEM`. These checks do not call
   discovery. Then, after deterministic discovery but still before any snapshot/
   open, validate concrete output count, source/output identity, and filename
   collisions. Only cardinality-dependent checks belong in this second stage;
   fresh-root existence and capability MUST NOT be deferred to it. Hold the
   opaque lease through staging and repeat descriptor-based device/inode/type
   identity checks immediately before `COMMITTING`. Structural invalid cases must
   be tested with a discovery spy that proves the boundary was not crossed.
6. Validate profile capability before discovery: unavailable `card`/`source`
   conversion emits `PROFILE_NOT_AVAILABLE` (exit `2`) and never uses
   `INVALID_PATH` as a substitute. A non-UTF-8 database is diagnosed later by
   the reader as `UNSUPPORTED_DATABASE_ENCODING` (exit `4`); wrong text storage
   class is `INVALID_TEXT_VALUE` (exit `4`) before text-size checks.
7. Create command handlers. `convert` delegates only to the application service;
   it must not contain SQL, bitmask decoding, text segmentation, or destination
   publication details. `inspect`, `validate`, and `schema` delegate to their
   application modules. Keep stdout/stderr as injected writers.
8. Update exit-state construction to distinguish option, input, collision,
   output/cancellation, partial, and internal failures. Preserve precedence
   `2 > 3 > 4 > 5 > 6 > 7 > 1`. Ensure output/cancellation can override a pending
   partial result where the operational contract requires it.
9. Install exactly one SIGINT handler around `convert()` in `main()`, abort the
   passed signal, and remove the handler in `finally`. Never call global
   `console.error` from the catch path; use injected stderr.

### Tests and verification

Add matrix vectors for:

- raw one-input stdout/file, raw multi-input split directory;
- the exact inherited `tests/cli/limitRelations.test.ts` relation vectors;
- raw `--merge`, raw `--split card`, raw multi-input `split=none`;
- stdout with multiple logical outputs;
- file/directory destination mismatch;
- `pretty` plus JSONL;
- invalid enum values and repeated options;
- invalid negative/non-safe limits and both limit relations;
- unavailable card/source conversion with no reader invocation;
- existing/unsafe split roots and input/output path identity;
- `-o -`, bare `convert`, help/version, and diagnostics modes.

Run:

```bash
npm run build
npm run test:cli -- --run tests/cli/parseArgs.test.ts tests/cli/commandMatrix.test.ts tests/cli/exitCodes.test.ts tests/cli/limitRelations.test.ts
```

**Stop condition:** any invalid matrix test reaches discovery, snapshot, or SQLite;
any data/summary/diagnostic text reaches stdout; or a SIGINT handler remains
installed after command completion.

## Task 2.2 — Wire one-database raw envelopes and incremental serializers

**Depends on:** Task 2.1 normalized options/output plan.

**Files to change/create:**

- `src/application/convertCatalog.ts`
- `src/application/types.ts`
- `src/application/outputPlan.ts`
- `src/profiles/rawProfile.ts`
- `src/serialization/canonicalJson.ts` (new)
- `src/serialization/jsonArrayWriter.ts` (new)
- `src/serialization/jsonLinesWriter.ts` (new)
- `src/hashing/sha256.ts` and provenance helper(s) as needed
- `src/cdb/iterateRows.ts`, `src/cdb/snapshotBundle.ts`, or a new
  `src/cdb/readDatabase.ts` only to expose one reader-owned metadata-aware
  lifecycle; preserve `iterateRawCards()` behavior
- `schemas/cdb.raw.v1.schema.json`
- `schemas/cdb.card-array.v2.schema.json`
- `schemas/ygo.card-source-array.v1.schema.json`
- `tests/reader/walMaterialization.test.ts` (extend the exact R5.6 gate)
- `tests/reader/textByteFidelity.test.ts` (extend the exact R5.6 gate)
- `tests/reader/physicalSnapshotProvenance.test.ts` (extend the exact R5.6 gate)
- `tests/reader/stagingSnapshotBudget.test.ts` (extend the exact R5.6 gate)
- `tests/api/iterateRawCards.test.ts` (extend the exact R5.6 gate)
- `tests/api/iterateRawCards.types.test.ts` (extend the exact R5.6 gate)
- `tests/cli/rawProfile.test.ts` (new)
- `tests/cli/serialization.test.ts` (new)
- `tests/conformance/rawOutput.test.ts` (new)

### Reader/application boundary

The application needs the reader's verified physical bundle hash, source size, and
extra-table metadata without opening the source twice. Introduce one internal
metadata-aware session or callback, such as:

```ts
export interface RawDatabaseMetadata {
  sourcePath: string;
  fileName: string;
  sourceSizeBytes: number;
  bundleSha256: string;
  extraTables: readonly {
    name: string;
    columns: readonly string[];
    rowCount: number;
  }[];
}

export interface RawDatabaseRead {
  metadata: Promise<RawDatabaseMetadata>;
  rows: AsyncIterableIterator<RawCardRows>;
}
```

The implementation may select a different name, but it must use the existing
snapshot/materialize/open/close lifecycle once, retain reader-owned cleanup, and
make the bundle hash available only after source verification. Do not use
`readFile(inputPath)` in `convertCatalog.ts` as a substitute for the bundle hash.
If the existing reader sees an invalid UTF-8 BLOB, it must emit
`INVALID_TEXT_ENCODING` and fail; it must not return null and let raw output claim
lossless data.

### Raw profile contract

1. Replace the CLI path's current `mapRawCard()`/`mapDatabaseToRaw(cards: RawCardRows[])`
   collection with a database-envelope builder. It receives the one database's
   metadata and row stream, appends `datas` and `texts` rows to the current
   envelope only, and emits `extraTables` metadata. Retain old helper exports only
   for compatibility tests and mark their per-card shape as non-CLI.
2. Use fixed source property order and include `schema`,
   `integerEncoding: "signed-int64-decimal"`, source `{ fileName, sha256,
   sizeBytes, converter }`, `tables`, and `extraTables`. Do not add arbitrary
   tables/cells.
3. For one database, JSON writes one object. JSONL writes one object plus newline.
   Multiple raw databases are represented by multiple logical files in
   `split=database`, never one malformed array.
4. `convertCatalog.ts` must stream/append only the active database. In no-continue
   mode it stages all logical output units before publication. In unmerged
   `--continue-on-error`, each database has independent staging and can commit
   only after its own envelope succeeds. No raw merge map is allowed.
5. Keep conversion hashes semantic-only. Output path, format, pretty, diagnostic
   renderer, timing, and lock tokens are excluded. The physical bundle hash is
   retained separately in the source metadata.

### Serializer contracts

- `canonicalJson.ts`: deterministic JSON encoding with UTF-8, LF, compact default,
  two-space pretty mode, no non-finite values, and stable object-property order.
  Use a separate hash canonicalization path if sorted keys are required for hashes;
  do not let hash key sorting accidentally change the profile output contract.
- `jsonArrayWriter.ts`: write prefix, records, separators, and suffix without
  collecting the array. It must support zero records and one record and expose
  close/abort state.
- `jsonLinesWriter.ts`: write one compact JSON object per line; reject pretty mode.
- Every writer enforces `maxOutputBytes` before each encoded UTF-8 chunk and
  reconciles the actual output count. A private file/directory writer additionally
  reserves and reconciles its encoded chunks against aggregate `maxStagingBytes`;
  the stdout writer does not charge encoded chunks to private staging. Snapshot,
  materialization, spool, lock, and destination temporary files remain covered by
  the aggregate tracker. A failed write closes/aborts and reports
  `OUTPUT_WRITE_FAILED` or `RESOURCE_LIMIT_EXCEEDED` without changing an existing
  final. Stdout's already-written prefix is allowed to remain.

### Tests and verification

Use generated CDB fixtures plus `__tests__/input_dir/cards.cdb`. Assert:

- raw schema validation and exact all-column values, nulls, empty strings,
  Unicode, CRLF/CR/LF, signed-int64 extrema;
- verified bundle hash differs for physical snapshot changes while raw row content
  remains deterministic;
- JSON versus JSONL decoded envelopes are equal;
- empty/one/many writer cases, final newline rules, Unicode escaping, pretty JSON,
  byte limits, staging limits, injected writer failures, and pre-existing-final
  preservation;
- no all-database `RawCardRows[]` accumulator remains in the application path.

Run:

```bash
npm run build
npm run test:reader
npm run test:compat
npx vitest run tests/reader/walMaterialization.test.ts tests/reader/textByteFidelity.test.ts tests/reader/physicalSnapshotProvenance.test.ts tests/reader/stagingSnapshotBudget.test.ts tests/cli/limitRelations.test.ts tests/api/iterateRawCards.test.ts tests/api/iterateRawCards.types.test.ts
npm run test:cli -- --run tests/cli/rawProfile.test.ts tests/cli/serialization.test.ts
npm run test:conformance -- --run tests/conformance/rawOutput.test.ts
```

**Stop condition:** JSON and JSONL differ in source values, an INTEGER is rounded,
invalid UTF-8 becomes null, a writer bypasses reservation, or a failed write changes
a pre-existing final.

## Task 2.3 — Implement secure destinations, native boundary, staging, and lifecycle

**Depends on:** Task 2.1 output plan and Task 2.2 writer boundary.

**Files to change/create:**

- `src/destinations/secureDestination.ts`
- `src/destinations/nativeAdapter.ts` (new)
- `src/destinations/atomicFile.ts` (new)
- `src/destinations/fileDestination.ts` (new)
- `src/destinations/directoryDestination.ts` (new)
- `src/destinations/stdoutDestination.ts` (new)
- `src/application/stagingBudget.ts`
- `src/application/convertCatalog.ts`
- `src/cdb/iterateRows.ts`, `src/cdb/snapshotBundle.ts`, and
  `src/cdb/materializeSnapshot.ts` to thread aggregate reservations and cleanup
- `native/secure-destination/src/secure_destination.h`
- `native/secure-destination/src/secure_destination.cc`
- `native/secure-destination/binding.gyp`
- `package.json` and `package-lock.json` (exact build-time `node-addon-api` dependency)
- `scripts/build-native.mjs`
- `scripts/package-check.mjs`
- `tests/cli/destinationLifecycle.test.ts` (new)
- `tests/cli/freshSplitRoot.test.ts` (new)
- `tests/cli/secureDestinationRace.test.ts` (new)
- `tests/cli/nativeCapability.test.ts` (new; supported and unsupported manifest branches)
- `tests/cli/pathSafety.test.ts` (new)

### Native boundary contract

1. `nativeAdapter.ts` is the only module that loads `dist/native/secure_destination.node`,
   translates its return values, and maps `errno`/capability failures to stable
   diagnostics. TypeScript modules do not call native exports directly.
2. `package.json` and `package-lock.json` must add the exact build-time
   `node-addon-api@8.9.0` devDependency. `binding.gyp` must use
   `<!@(node -p "require('node-addon-api').include")` in `include_dirs` and
   `<!@(node -p "require('node-addon-api').gyp")` in `dependencies` (while
   preserving `NAPI_VERSION=9`) so a clean `npm ci && npm run build:native` can
   resolve the existing `<napi.h>` includes; the implementer must not assume
   headers are installed globally. `probeNativeCapability()` must trust a
   manifest only when it matches platform/arch, numeric
   `process.versions.modules` Node ABI, N-API version, and module SHA-256. A
   successful compilation is insufficient: required `openat2`, no-symlink,
   descriptor-relative lock/temp/cleanup, and no-replace primitives must be
   behaviorally probed on the selected parent filesystem during preflight.
   `ENOSYS`, `EOPNOTSUPP`, or failed probe cleanup returns
   `UNSAFE_DESTINATION_FILESYSTEM` before discovery.
3. `scripts/build-native.mjs` must treat every Node major >=22 on Linux x64/arm64
   as build-eligible (not only the string `v22`), remove stale binaries on every
   unsupported or failed build, and write an explicit unsupported manifest. The
   post-build load/probe result, manifest, and module hash are the support source
   of truth. A clean supported-candidate gate must build and load the module on
   Node 22+ and run the primitive probe. Node 26 is not a hard-coded policy case:
   retain the current unsupported manifest as a valid baseline branch when that
   build/probe fails, while a future hash-matching manifest may truthfully report
   support.
4. Replace path-based native lock/unlock/rename operations in the modern path
   with opaque native-owned parent/source/lease/temp/stage handles. Only initial
   trusted parent/source acquisition accepts a path; subsequent operations accept
   handles plus validated single leaf names. Native code rejects NUL, separators,
   absolute names, empty/`.`/`..` components. `AtomicRename` with flags `0` is
   not an acceptable no-clobber implementation: absent-final publication (with or
   without `--force`) must use `RENAME_NOREPLACE`; an existing regular final with
   `--force` is unsupported in this package and returns
   `UNSAFE_DESTINATION_FILESYSTEM` before discovery. No identity-check-plus-
   ordinary-rename fallback is permitted. Publish must return `COMMITTED`,
   `NOT_COMMITTED`, or `INDETERMINATE`. Never retry an indeterminate result or
   recursively delete an unproven tree. Do not rely on an unlinked `O_TMPFILE`
   unless descriptor-relative publication is proven.
5. `secureDestination.ts` exposes those opaque capability, root, source,
   reservation, temporary, stage, publish, and cleanup operations. The fixed
   lease record is `cdb-destination-lock/1` with token/PID/creation-time/scope/
   leaf, created `O_CREAT|O_EXCL|O_NOFOLLOW`; only `ESRCH` is stale, while `0`
   and `EPERM` are live. Malformed/partial/symlink/PID-present locks refuse even
   with force, and release requires the matching handle/token.
6. On unsupported hosts, the structural destination preflight returns
   `UNSAFE_DESTINATION_FILESYSTEM` before `discoverInputs()`, snapshot, or open.
   Stdout remains supported.

### Destination and budget contract

- `stdoutDestination` writes only through the injected stdout writer and is
  non-atomic by contract. It enforces `maxOutputBytes`, but does not reserve its
  encoded chunks against `maxStagingBytes`; that aggregate budget applies only to
  private files and private state.
- `fileDestination` stages a single file, holds its reservation, and publishes
  atomically. Its private encoded chunks enforce both `maxOutputBytes` and
  aggregate `maxStagingBytes`. No-force with an existing regular final reports
  the output conflict; force with such an incumbent takes the explicit
  `UNSAFE_DESTINATION_FILESYSTEM` unsupported branch before discovery. Force
  with an absent final uses `RENAME_NOREPLACE`, and a newly appearing final is
  preserved. Symlink, directory, source-identity, and input-hardlink finals are
  rejected regardless of force.
- `directoryDestination` never creates the final root during preflight. It holds
  a descriptor-relative lease, stages deterministic child files in a private `0700`
  sibling, verifies exactly the owned entries, and publishes the entire stage once
  with descriptor-relative `RENAME_NOREPLACE`. It rejects both empty and populated
  existing roots and never adopts a root created by a race. No-continue aborts
  without a final root after any pre-barrier failure; continue-on-error commits
  successful input children once and returns exit 7. Unknown entries are never
  recursively deleted.
- `atomicFile` owns temporary sibling creation, byte reservation, flush/close,
  pre-commit abort, publication, and cleanup. It must preserve a pre-existing
  final on every pre-commit error.
- Extend `StagingBudget` so snapshot main/WAL/SHM copies, materialized main,
  destination temporary files, lock/reservation records, and future private state
  reserve before growth and reconcile/release exactly once. Thread the tracker
  through the reader lifecycle; do not use `null` for Phase 2 destination runs.
  Do not route stdout encoded chunks through this tracker.
- Conversion owns cleanup order: stop iteration and close/flush the writer,
  close reader-owned SQLite/materialized/snapshot resources, and reconcile their
  private staging after reading. Retain SourceHandle, its source-parent handle,
  and the trusted destination ParentHandle/LeaseHandle through the final native
  source/output device/inode/type recheck and synchronous commit barrier; release
  or close those retained handles in `finally` after definite publication or
  one-time indeterminate reconciliation. Reject source/final symlinks and
  hardlinks even with force. A post-barrier signal cannot undo or relabel a
  committed file. Cleanup may remove only owned handles and never recursively
  deletes an adopted or attacker-modified tree; lifecycle tests must prove no
  retained handle closes before the final recheck.

### Tests and verification

- unsupported platform/manifest: exit 6 before a spy reader/snapshot call;
- supported capability matrix: descriptor-relative root, symlink rejection,
  parent-directory swap, input/output collision recheck, live/malformed/stale
  locks, no-force race, and absent-final force/no-force races; an existing regular
  final with `--force` must take the explicit `UNSAFE_DESTINATION_FILESYSTEM`
  unsupported branch before discovery, with no expected-present CAS or plain
  rename fallback, and no output may escape the trusted root;
- file writer failure, resource failure, cancellation before/during/after commit,
  and pre-existing-final byte preservation; lifecycle assertions prove reader-
  owned resources close after reading while SourceHandle, ParentHandle, and
  LeaseHandle stay open through final identity recheck and the commit barrier;

- fresh split root rejects existing empty/populated roots even with `--force`;
- aggregate staging rejects snapshot/materialized/private-output growth before
  a write, while stdout tests prove that `maxOutputBytes` is enforced without
  consuming private-staging budget;
- lease tests cover live, `EPERM`/live, stale/`ESRCH`, PID-present,
  malformed/partial, symlink, and token-mismatch records, and force never
  bypasses live or malformed state;
- negative traversal, symlinked parent/final, parent swaps, source hardlinks,
  and source/final identity checks cover lock, temp, no-force, absent-final force,
  unsupported expected-present force, and cleanup; and
- split-directory tests stage all children and publish once, inject final-root
  creation and failures before/during stage verification/publication, exercise an
  indeterminate result without retry, and prove no unknown recursive deletion
  with either no final root or a clearly committed root.

Run:

```bash
npm ci
npm run build
npm run test:reader
npm run test:cli -- --run tests/cli/nativeCapability.test.ts tests/cli/destinationLifecycle.test.ts tests/cli/freshSplitRoot.test.ts tests/cli/pathSafety.test.ts tests/cli/secureDestinationRace.test.ts
npm run package:check
```

Run `secureDestinationRace.test.ts` only when the capability manifest reports
supported; on an unsupported host, run the explicit unsupported-host test instead.
The supported branch is mandatory whenever support is truthfully reported; the
unsupported branch must prove no stale module and exit 6 before the reader.
The capability test must exercise both branches: support requires a
hash-matching module that loads on the running Node 22+ ABI and passes all
primitive probes; unsupported requires no stale module and exit 6 before the
reader boundary.

**Stop condition:** any modern file path uses a JavaScript/path-based fallback,
any split root is adopted, any concurrent process can clobber without authorized
force, or any private artifact bypasses aggregate reservation/cleanup.

## Task 2.4 — Add inspect, validate, and schema command services

**Depends on:** Task 2.1 parser/plan and the reader metadata boundary from Task 2.2.

**Files to change/create:**

- `src/application/inspectInputs.ts` (new)
- `src/application/validateInputs.ts` (new)
- `src/commands/inspect.ts`
- `src/commands/validate.ts`
- `src/commands/schema.ts`
- `src/cli.ts`
- `schemas/cdb.raw.v1.schema.json`
- `schemas/cdb.card.v2.schema.json`
- `schemas/ygo.card-source.v1.schema.json`
- `schemas/cdb.card-array.v2.schema.json`
- `schemas/ygo.card-source-array.v1.schema.json`
- `scripts/package-check.mjs`
- `tests/cli/inspectValidateSchema.test.ts` (new)
- `tests/conformance/schemaSelection.test.ts` (new)

### Command contracts

1. `inspect` returns stable JSON containing display-safe source identity, verified
   physical bundle hash and size, required/extra table names/columns/counts,
   orphan and duplicate summaries, and decoding/input warnings. It does not emit
   converted profiles or write output files.
2. `validate` runs the reader's schema, storage-class, signed-int64, text-byte/
   encoding, row, resource, and strict policy checks. It emits a deterministic
   validation report, closes all reader/snapshot/materialization resources, and
   never creates a converted output destination.
3. `schema` accepts `raw`, `card`, `card-array`, `source`, and `source-array`.
   `raw` prints `cdb.raw/1`; `card`/`source` print item schemas; array selectors
   print schemas with `type: "array"` and `items` references to the corresponding
   item schema. Schema selection reads packaged JSON only and never opens SQLite.
   `--output` uses the same safe atomic destination rules; `--output -` is stdout.
4. Update `cdb.raw.v1.schema.json` to require `integerEncoding`, exact supported
   tables/columns, nullability, decimal-string integer values, and metadata-only
   `extraTables`. Do not make aggregate schemas wrappers with `cards` or
   `documents` properties; the accepted aggregate contract is an array.
5. `package-check` must verify all item/aggregate schemas and must reject a
   supported capability manifest without a hash-matching native module while still
   accepting a truthful unsupported manifest with no stale module.

### Tests and verification

Assert that inspect/validate output is deterministic, schema output is identical
across invocations, schema does not invoke SQLite, and no command writes a final
converted file. Include missing table, orphan/duplicate, strict warning, invalid
text/integer, and unsupported destination cases.

Run:

```bash
npm run build
npm run test:reader
npm run test:cli -- --run tests/cli/inspectValidateSchema.test.ts
npm run test:conformance -- --run tests/conformance/schemaSelection.test.ts
npm run package:check
```

**Stop condition:** inspect/validate emits profile records, schema opens SQLite,
aggregate schema shape disagrees with the JSON/JSONL contract, or output is
non-deterministic.

## Task 2.5 — Compiled process smoke gate and documentation delta

**Depends on:** Tasks 2.1–2.4.

**Files to create/change:**

- `tests/cli/processSmoke.test.ts`
- `tests/cli/fixtures/` or `tests/fixtures/buildCdbFixture.ts`
- `README.md` for the raw CLI replacement workflow only
- `package.json` exports only if schema/package smoke exposes a missing public
  export (include `./schemas/*` as specified by the accepted package contract)

### Process-level scenarios

Spawn `dist/cli.js` rather than importing `main()` for these cases:

1. one-file raw JSON to stdout;
2. one-file raw JSONL to stdout;
3. raw file output on a supported native host, or explicit exit-6 unsupported
   destination on the current host;
4. multi-input raw `split=database` deterministic filenames and fresh-root rules;
5. `inspect` and `validate` machine output with diagnostics isolated to stderr;
6. `schema raw`, `schema card`, `schema card-array`, `schema source`, and
   `schema source-array` stdout output;
7. invalid option combinations fail without opening the fixture;
8. missing/no-usable input exit `3`, input/resource failure exit `4`, output/
   cancellation exit `6`, and unmerged continued mixed result exit `7`;
9. stderr text/JSON/JSONL/none and stdout containing no human diagnostics;
10. child-process SIGINT during row iteration and delayed write, with private
    artifact cleanup and pre-existing-final preservation.

Use a spy/injected reader for pre-open ordering tests and real child processes for
signals, stream behavior, and native races. Do not make unsupported-host tests
pass by writing files insecurely.

### Verification gate

Run the exact accepted Phase 2 gate in order:

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
```

Then run the full repository gate and report its complete result (a short command
timeout is not success):

```bash
npm test
```

If focused test scripts do not include newly created tests because of the Vitest
include configuration, update only the repository test configuration/scripts needed
to make the named gate execute them, then rerun the full gate.

**Stop condition:** process smoke cannot distinguish stdout data from stderr
Diagnostics, SIGINT leaves a temporary/lock artifact, or a supported-host
publication race is unproven.

## Task 2.6 — Archive superseded Phase 2 plan packages after implementation approval

**Depends on:** Tasks 2.1–2.5, the exact Phase 2 gate, the full-suite result,
and explicit implementation approval. This is a post-approval administrative
task, not an implementation or test step; do not archive either package while
Phase 2 work is still being reviewed or revised.

After approval, move both active Phase 2 plan directories as complete directories
under `docs/archive/`, preserving their directory names:

- `docs/cdb-to-json-cli-refactor-phase-2-remediation/` →
  `docs/archive/cdb-to-json-cli-refactor-phase-2-remediation/`;
- `docs/cdb-to-json-cli-refactor-phase-2-publication/` →
  `docs/archive/cdb-to-json-cli-refactor-phase-2-publication/`.

Use `git mv` (not a copy/delete), retain every file in each package, and update
only any active links that would otherwise point at the old paths. Do not move,
rename, or rewrite the normative source documents that the packages cite:
`docs/cdb-to-json-cli-refactor-spec.md`,
`docs/cdb-to-json-cli-refactor/spec.md`,
`docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`,
`docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md`, and
`docs/cdb-to-json-cli-refactor/phase-2-cli-raw-output.md`.

**Archive checklist:**

- [ ] Implementation approval is recorded before any move is made.
- [ ] Both source directories exist and the two archive destinations do not
      already exist.
- [ ] Both directories are moved with `git mv`, with no files omitted.
- [ ] No normative source document listed above was changed or moved.
- [ ] Active documentation no longer links to the removed pre-archive paths;
      historical links inside the archived package may be retained or adjusted
      only to point at the archived location.

**Verification (run after the approved move):**

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

## Final rollback checklist

- `npm run build` still succeeds with an honest native capability manifest.
- `npm run test:reader` and `npm run test:compat` remain green.
- Removing Phase 2 command/destination/serializer modules leaves the legacy bridge
  and Phase 0–1 reader behavior intact.
- No input CDB or pre-existing final was modified by a failed attempt.
- No temporary snapshot, materialized DB, output sibling, lock, or reservation
  remains after success, failure, writer error, or pre-commit cancellation.
