# Phase 2 implementation brief — CLI raw-output wiring remediation

## Status and lineage

**Request class:** remediation. This package translates the already accepted Phase 2
contract; it does not redesign the CLI product or reopen the senior remediation
choices.

**Accepted sources of truth:**

- `docs/cdb-to-json-cli-refactor/spec.md`
- `docs/cdb-to-json-cli-refactor/phase-2-cli-raw-output.md`
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`
- `docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md`
- `docs/cdb-to-json-cli-refactor-spec.md`

## Goal and current request

Implement the unwired Phase 2 path so the TypeScript/ESM package can execute the
raw-profile CLI workflow without weakening the Phase 0–1 reader, snapshot, integer,
UTF-8, diagnostics, cancellation, or safe-publication contracts.

The implementer must complete tasks **2.1–2.5** in the accepted Phase 2 plan:
command parsing and pre-open planning; raw envelope mapping, canonical/incremental
serialization, and application orchestration; hardened destinations and native
capability handling; `inspect`, `validate`, and `schema`; and the compiled process
smoke gate.

## What happened

Phase 0–1 reader and compatibility artifacts exist and their focused tests are the
current dependency checkpoint. Reconnaissance found that Phase 2 is still a
scaffold:

- `src/application/convertCatalog.ts` hashes the live main file, collects every
  `RawCardRows` value in memory, never maps a profile, and never writes output.
- `src/cli.ts` has only partial validation, a placeholder `schema` response, no
  command handlers, no SIGINT lifecycle, and renders only source-local
  diagnostics.
- `src/cli/parseArgs.ts` uses permissive parsing and has incomplete option
  definitions/defaults; invalid combinations can reach discovery/reader code.
- `src/profiles/rawProfile.ts` has a per-card mapper and an array collector, but no
  database envelope pipeline, verified snapshot provenance, or extra-table metadata.
- `src/serialization/` already contains partial canonical/array/JSONL placeholders and `src/commands/` contains partial convert/inspect/schema/validate handlers; these are incomplete Phase 2 surfaces. Task 2.1/2.2/2.4 must replace or extend them at the named boundaries, preserving existing imports only where compatibility tests explicitly require it.
- `src/destinations/secureDestination.ts` is a capability/interface placeholder;
  the native implementation still exposes path-based lock operations and its
  `AtomicRename` path does not implement the required no-replace operation.
- The existing schemas and package-check expectations are not fully wired to the
  command surface; aggregate schema files currently describe wrapper objects rather
  than the accepted aggregate-array contract.

These are wiring and implementation gaps, not permission to start Phase 3 card
normalization or Phase 4 source/text work.

## Consolidated remediation findings (verbatim handoff delta)

> Reconnaissance (assistant visit 9, this run) identified exact unwired modules.
> Prior 3 implementer cycles delivered Phase 0–1 + 3–4 libraries but not the Phase
> 2 CLI surface.
>
> Plan-level decomposition is needed for tasks 2.1 (commands/convert|inspect|
> validate|schema + application/outputPlan.ts), 2.2 (serialization/
> canonicalJson|jsonArrayWriter|jsonLinesWriter), 2.3 (destinations/stdout|file|
> directory|atomicFile|nativeAdapter), and the convert() pipeline that wires
> them. It must be implementer-ready (file paths, signatures, contract per-file).
>
> Native build unsupported-host means file/directory output must fail
> `UNSAFE_DESTINATION_FILESYSTEM` (exit 6); the runtime test surface is limited to
> stdout plus JSON/JSONL. The test budget is the build, reader, compatibility, CLI,
> and package checks plus `tests/cli/processSmoke.test.ts`.
>
> The Phase 2 plan was already senior-planner-accepted; this is gap-translation
> against an existing accepted plan, not re-design.

The package below addresses each finding 1:1 through tasks 2.1–2.5 and keeps the
accepted Phase 2 scope intact.

## Needed outcome

A fresh implementer must be able to implement the following end-to-end path:

```text
parse + normalize options
  -> reject invalid matrix/limits/destination before input snapshot/open
  -> discover deterministic .cdb inputs
  -> acquire verified physical snapshot and reader metadata
  -> stream raw rows for one database
  -> build one cdb.raw/1 envelope
  -> serialize JSON or one-envelope-per-line JSONL
  -> write stdout, one file, or fresh per-database directory atomically
  -> render diagnostics on stderr and select the documented exit code
```

`card` and `source` conversion profiles remain later-phase capabilities. Phase 2
must reject them explicitly without opening an input or emitting fabricated records;
the `schema` command may still print their frozen item/aggregate schemas.

## Fixed behavior

### Phase 2 profile/format matrix

- `convert --profile raw --format json` emits one `cdb.raw/1` object per database.
- `convert --profile raw --format jsonl` emits one complete `cdb.raw/1` object and
  newline per database; it never emits rows or cards as JSONL records.
- One unmerged input may use `split=none` and stdout (`-`) or one file.
- `split=auto` resolves to `split=none` for one discovered input or
  `split=database` for multiple discovered inputs. When an explicit output path is
  supplied, the structural preflight (parent/capability/leaf validation, fresh-root
  existence check for directory, native-capability probe for file/directory)
  runs before input discovery and cardinality selection; an unsupported host or
  existing split-root root therefore fails before the file-vs-directory determination
  is made.
- Multiple unmerged inputs require `split=database`; each database is an
  independent logical output in a directory. Input and output order is deterministic.
- Raw cannot use `--merge` or `split=card`.
- `--pretty` is valid only for JSON.
- Stdout is allowed only when there is one logical output. It is intentionally
  non-atomic; a late error may leave earlier bytes.
- File and directory destinations are atomic per logical output and require the
  native secure-destination capability. Structural destination-kind, split-root
  existence, and native-capability preflight run before `discoverInputs()`;
  unsupported hosts fail with `UNSAFE_DESTINATION_FILESYSTEM` and exit `6`. There
  is no path-based fallback.
- `split=database` requires a nonexistent fresh output directory. Existing empty
  and populated roots both fail with `OUTPUT_DIRECTORY_EXISTS` before discovery;
  `--force` does not override this.
- A non-split existing file without `--force` is preserved (exit `5` if the
  final is present and non-atomic output is requested). This Phase 2 package
  does not implement identity-guarded replacement: its capability manifest reports
  `identityGuardedReplace: false`, and `--force` against an existing regular final
  returns `UNSAFE_DESTINATION_FILESYSTEM` (exit `6`) during structural
  preflight, before discovery. `--force` with an absent final still uses
  descriptor-relative `RENAME_NOREPLACE`; a final that appears after
  reservation is never clobbered. No `replaceIfIdentityMatches` placeholder or
  identity-check-plus-ordinary-rename fallback is permitted.
- `convert` defaults to the product's `card` profile, but Phase 2's raw conversion
  gate requires an explicit `--profile raw`. `card`/`source` conversion returns a
  stable not-yet-available capability diagnostic and performs no input access.
- `inspect`, `validate`, and `schema` produce deterministic machine-readable data
  on stdout; diagnostics, warnings, and progress go only to stderr. `schema` never
  opens SQLite.

### Raw envelope contract

The raw mapper emits, in fixed property order:

```text
schema
integerEncoding
source { fileName, sha256, sizeBytes, converter }
tables { datas, texts }
extraTables
```

`datas` and `texts` contain every supported fixed column, including nulls, empty
strings, exact decoded UTF-8 line endings, and signed-int64 decimal strings for
SQLite INTEGER values. `extraTables` contains metadata only (table name, columns,
row count); it is not an arbitrary value dump. `sha256` is the verified physical
main/WAL/SHM source-bundle hash, not a hash of a live main file. `sizeBytes` remains
the source `.cdb` main-file size used by the existing envelope contract.

A raw envelope is accumulated only for the current database. The application must
not retain rows or envelopes for all databases. The reader's existing public
`iterateRawCards()` async iterator remains available and continues to own cleanup;
the application may add an internal metadata-aware reader/session or callback, but
must not open a second live database merely to obtain provenance.

### Diagnostics and exit behavior

Freeze the diagnostic mappings instead of selecting a generic path or profile
error at implementation time:

- a non-UTF-8 SQLite database emits `UNSUPPORTED_DATABASE_ENCODING` and follows
  the input/encoding error path (exit `4`), before text value selection;
- a supported text column whose SQLite storage class is not TEXT or NULL emits
  `INVALID_TEXT_VALUE` and follows the input/schema error path (exit `4`), before
  byte-limit checks; invalid bytes in an otherwise valid TEXT value remain
  `INVALID_TEXT_ENCODING`;
- `card` or `source` conversion in this Phase 2 package emits
  `PROFILE_NOT_AVAILABLE` and follows the unavailable-profile option path (exit
  `2`) before discovery, snapshot acquisition, or SQLite access. It MUST NOT be
  reported as `INVALID_PATH` or another generic destination/input diagnostic.

Keep `UNSAFE_DESTINATION_FILESYSTEM`, `OUTPUT_DIRECTORY_EXISTS`,
`INVALID_LIMIT_RELATION`, `RESOURCE_LIMIT_EXCEEDED`, `CANCELLED`, input/schema
errors, and raw UTF-8/integer diagnostics machine-readable. Preserve the accepted
precedence: option/matrix error `2`; no usable input `3`; input/schema/strict/
resource/integer error `4`; collision `5`; output/write/cancellation `6`; partial
continued execution `7`; unexpected failure `1`.

### Pre-discovery destination preflight

After parsing and normalization, the structural destination preflight MUST run
before `discoverInputs()` and before any snapshot, reader, or SQLite call. It
must determine the destination kind, reject an existing split root with
`OUTPUT_DIRECTORY_EXISTS`, and require a truthful native capability manifest for
file or directory destinations, reporting `UNSAFE_DESTINATION_FILESYSTEM` when
that capability is unavailable. These checks use no input discovery and return
exit `6`. Only checks that require discovered cardinality or source names—logical
output count, deterministic filename assignment/collisions, and source/output
identity—belong to the concrete post-discovery planner, which still runs before
snapshot/open. The phase tests must inject a discovery spy and assert it is not
called for each structural failure.

### Adversarial publication amendment (required before implementation)

The publication package's Phase 4 is the detailed implementation contract for
this amendment and controls over generic terms such as "lock", "reservation",
or "atomic directory output" in this package.

- The native ABI uses opaque native-owned `ParentHandle`, `SourceHandle`,
  `LeaseHandle`, `TempHandle`, and `StageHandle` values. Only initial trusted
  parent/source acquisition accepts a path. All subsequent lock, temp, identity,
  `renameat2`, `unlinkat`, and cleanup calls accept a trusted handle plus a
  validated single leaf name; native code rejects NUL, separators, absolute
  names, empty/`.`/`..` components. Raw fd integers and path-based `LockFile`,
  `UnlockFile`, and `AtomicRename` exports are not an acceptable boundary.
- Native publication returns `COMMITTED`, `NOT_COMMITTED`, or `INDETERMINATE`.
  The latter is reconciled once by descriptor identity and never blindly retried;
  an unproven final is left untouched and the result is machine-readable
  `OUTPUT_WRITE_FAILED` with exit 6 and an indeterminate-publication detail.
- A fresh split root is not created during preflight. The trusted parent and
  exclusive lease are held while all children are staged in a private `0700`
  sibling. The stage must contain exactly owned children, then it is published
  once with descriptor-relative `RENAME_NOREPLACE`. A root created by a race is
  not adopted or clobbered. No-continue publishes nothing after any pre-barrier
  failure. Continue-on-error stages only successful input units, commits once,
  and returns exit 7; writer/destination/publication failures abort the whole
  stage with exit 6. Unknown entries are never recursively deleted.
- Lease records are fixed (`cdb-destination-lock/1`, owner token, decimal PID,
  creation time, scope, target leaf) and created with `O_CREAT|O_EXCL|O_NOFOLLOW`.
  Only `ESRCH` makes a well-formed PID stale; `0` and `EPERM` are live.
  Malformed/partial/symlink/PID-present records refuse even with force, and
  release requires the matching opaque handle/token. A committed final plus a
  stale lease is still an existing destination, never an adopted tree.
- Capability is manifest-, module-hash-, numeric Node-module-ABI-, N-API-,
  platform-, architecture-, and primitive-probe-driven. Structural preflight
  additionally probes no-symlink traversal, exclusive temp/lease creation, and
  no-replace publication on the selected parent filesystem, cleaning only owned
  probe handles. Probe failure (`ENOSYS`/`EOPNOTSUPP` included) returns
  `UNSAFE_DESTINATION_FILESYSTEM` before discovery.
- Source/output identity is device/inode/type comparison through opaque source
  and trusted-parent descriptors, repeated immediately before `COMMITTING`.
  Source/final symlinks and input hardlinks are rejected, including with force;
  parent replacement cannot redirect either check.

The required adversarial fixture gate covers negative traversal, symlinked parent
and final, parent swaps at preflight/lease/stage/no-force/force/cleanup,
live/`EPERM`/stale/`ESRCH`/PID-present/malformed/token-mismatch leases, final
appearance after reservation, hardlinks, and source identity. It injects every
pre-commit directory failure plus an indeterminate publication and asserts no
blind retry, no unknown recursive deletion, and either no final root or a clearly
committed root. No implementation may proceed to file/directory output if these
properties cannot be proven; retain stdout/legacy behavior instead.

## Constraints and non-goals

- Do not implement bitfield/card mapping, text segmentation, `card` output, or
  `source` output in this phase.
- Do not replace the Phase 0–1 snapshot/materialization lifecycle with live reads.
- Do not coerce INTEGER values to JavaScript numbers or invalid UTF-8 to null.
- Do not query arbitrary table cells; only the fixed `datas`/`texts` columns are
  raw-value data. Extra tables are metadata only.
- Do not use `console.*` in library, application, reader, profile, serializer, or
  destination modules. CLI rendering receives explicit stdout/stderr writers.
- Do not use a path-based fallback when the native destination capability is
  unavailable. Do not weaken no-clobber, symlink, lock, reservation, or commit
  barrier semantics.
- Do not add a bundler or a new runtime dependency.
- Do not modify input CDBs.

## Implementation contracts by component

### `src/cli/parseArgs.ts` and `src/cli.ts`

Return a typed parse result or a structured usage failure; never turn a parse error
into `help`. Use strict `node:util.parseArgs` definitions, explicit repeatability,
`-o -`, bare-command conversion, help/version, and all Phase 2 limits:
`--max-rows`, `--max-text-bytes`, `--max-output-bytes`, `--max-staging-bytes`,
`--max-spool-bytes`, and `--max-snapshot-bytes`. Normalize semantic options once.
Install one SIGINT handler only around the application call and remove it in
`finally`.

### `src/application/outputPlan.ts`

Own the normalized option matrix. Validate profile/format/split/merge/conflict,
pretty/JSONL, destination kind, stdout cardinality rules, limit relations, fresh
split roots, and profile capability before discovery or snapshot/open. Separate the
pure pre-discovery structural matrix from the native destination preflight: the
latter acquires an opaque trusted parent/lease and probes the selected filesystem,
without opening SQLite or passing unchecked paths onward. The post-discovery
concrete filename list uses deterministic input ordinals and sanitized stems; the
lease is held through staging and source/output identity is rechecked immediately
before publication. No plan method may open SQLite.

### `src/application/convertCatalog.ts`

Own conversion state and cleanup: `READING -> READY -> COMMITTING -> COMMITTED` or
`ABORTED`. Process databases in discovered order, create one collector per database,
stream rows into the current raw envelope, close reader-owned SQLite/materialized/
snapshot resources after reading, and publish only after all required pre-commit
checks. Retain the SourceHandle, its source-parent handle, and required trusted
destination ParentHandle/LeaseHandle through the native final source/output
identity recheck and commit barrier; release/close them in `finally` after
publication or one-time indeterminate reconciliation. For split directories,
stage all successful children in one owned private directory and invoke one
native no-replace directory commit; never publish children one by one. Implement
non-merged `--continue-on-error` per-database atomicity: input failures may yield
an exit-7 staged partial directory, while writer/destination/publication failures
abort the whole directory with exit 6. Reconcile an indeterminate native result
once and never retry blindly. Return one aggregate result containing source reports
and diagnostics for the CLI, not only diagnostics attached to successful sources.

### `src/profiles/rawProfile.ts`

Replace the per-card-as-envelope behavior with a database-envelope constructor.
Keep a compatibility helper only if existing tests/imports require it, but ensure
`convertCatalog` cannot accidentally call it for every row. Include verified source
metadata and extra-table metadata in the envelope.

### `src/serialization/*.ts`

Provide a writer-neutral interface that accepts encoded chunks and exposes
`write`, `flush`, `close`, `abort`, and commit ownership without leaking a raw
`Writable` into domain modules. `canonicalJson.ts` must implement deterministic
UTF-8 JSON, LF endings, compact output by default, and two-space pretty JSON where
allowed. `jsonArrayWriter.ts` must stream `[`/`,`/`]`; `jsonLinesWriter.ts` must
stream one compact record plus `\n`. Every writer enforces `maxOutputBytes`
before each encoded UTF-8 chunk and reconciles the actual output count. Only
writers whose chunks enter a private file/directory staging area also reserve and
reconcile those bytes against aggregate `maxStagingBytes`; the stdout writer never
charges encoded chunks to private staging. Snapshot, materialization, spool,
lock, and destination temporary files remain independently covered by the
aggregate tracker.

### `src/destinations/*.ts` and native adapter

`nativeAdapter.ts` is the sole N-API loader/error translator. Task 2.3 must add
exact build-time `node-addon-api@8.9.0` entries to `package.json` and
`package-lock.json`, and configure the existing `<napi.h>` source's include path
and GYP dependency in `native/secure-destination/binding.gyp`; a clean `npm ci`
must be sufficient to build it. `secureDestination.ts` exposes opaque typed
parent/source/lease/temp/stage handles and a capability manifest. Modern
file/directory output acquires one trusted parent, validates one-component leaf
names, holds an exclusive lease with a fixed token/PID/time record, creates
private temporaries, stages a split directory privately, and publishes absent
finals by `RENAME_NOREPLACE`. This package freezes
`identityGuardedReplace: false`: an existing regular final with `--force`
returns `UNSAFE_DESTINATION_FILESYSTEM` before discovery, and the ABI has no
`replaceIfIdentityMatches` or identity-check-plus-ordinary-rename fallback. The
ABI returns definite or indeterminate commit status and never accepts raw paths
after acquisition.
Update native ABI/source and build manifest as required; path-based `LockFile`,
`UnlockFile`, and rename helpers must be removed from the modern path, not merely
left as a fallback. Node major >=22 is build-eligible, but support is manifest-,
ABI-, module-hash-, selected-filesystem-probe-, and primitive-probe-driven; the
current Node 26 unsupported result is only a baseline branch.

### `src/commands/inspect.ts`, `validate.ts`, `schema.ts`

`inspect` reports safe path, verified bundle hash/size, fixed and extra table
metadata, counts, orphan/duplicate summaries, and reader warnings. `validate`
runs schema, storage class, row, text, resource, and strict checks without creating
converted output. `schema` selects `raw`, `card`, `card-array`, `source`, or
`source-array`, reads checked-in schemas only, and uses the same safe destination
rules if `--output` is supplied.

## Risks, assumptions, and stop conditions

| Risk/unknown | Mitigation and stop condition |
|---|---|
| Native ABI cannot prove descriptor-relative no-clobber publication | Keep stdout and legacy path; stop Phase 2 file/directory work. Never add a path fallback. |
| Reader metadata cannot be exposed without duplicating snapshot/open | Add one metadata-aware reader session and make the public iterator delegate; stop if two live opens are required. |
| Aggregate staging reservations omit snapshot/materialized/temp/lock bytes | Add reservation/reconcile tests before publication; stop if a private file bypasses the budget. |
| Raw schema needs a new nullable/integer shape | Update schema and conformance fixture together; do not broaden extra-table values implicitly. |
| Unsupported host is accidentally made to pass with insecure output | Require explicit unsupported-host exit-6 testing whenever the manifest is unsupported, run the supported race/output branch whenever it reports support, and keep stdout-only behavior available in both branches. |
| Existing tests expect old `mapRawCard` shape | Preserve a compatibility export only; the CLI contract remains one envelope per database. |
| Product defaults conflict with Phase 2 capability scope | Keep product defaults in parsing, reject unavailable card/source conversion before input access, and defer implementation to Phase 3/4. |

Rollback removes only Phase 2 command handlers, serializers, raw conversion wiring,
and modern destination adapters. It must leave the Phase 0–1 reader, schemas,
legacy bridge, and their gates passing. No rollback touches input databases or
pre-existing finals.

## Acceptance criteria

1. Invalid matrix, profile-capability, destination-kind, pretty/JSONL, output
   cardinality, fresh-root, and limit-relation cases fail before discovery/snapshot/
   SQLite access with stable diagnostics and exit `2` (or exit `6` for unsupported
   destination/fresh-root output as specified).
2. One CDB converts to schema-valid `cdb.raw/1` JSON on stdout with no diagnostics
   or summary text in stdout; JSONL emits one complete envelope per line.
3. All supported raw INTEGERs remain exact signed-int64 decimal strings; all
   supported text/null/empty values survive exactly; invalid UTF-8/storage classes
   fail rather than becoming null.
4. JSON and JSONL are deterministic and incremental; empty/one/many records,
   Unicode, line endings, write failure, and `maxOutputBytes` are tested for
   every writer. Private file/directory writers also test aggregate staging
   limits, while stdout tests prove that encoded chunks enforce only
   `maxOutputBytes` at the writer boundary and do not consume private-staging
   budget. Snapshot/materialization/spool staging remains aggregate-budgeted.
5. File output is atomic per logical unit; split-directory output stages all
   successful children privately and publishes one fresh directory with a single
   descriptor-relative no-replace rename. Existing finals/roots are preserved on
   pre-commit failure; a final appearing after preflight is not adopted or
   clobbered; unsupported native hosts or selected-filesystem probes return
   `UNSAFE_DESTINATION_FILESYSTEM` exit `6` without input open.
6. `inspect`, `validate`, and all item/aggregate `schema` selectors emit stable
   output without converted card records or SQLite access for schema selection.
7. SIGINT/writer failure closes the writer and reader-owned SQLite,
   materialization, snapshot, and private staging resources after reading, while
   SourceHandle, trusted ParentHandle, and LeaseHandle remain open through the
   final identity recheck and commit barrier and close in `finally`. Lifecycle
   tests prove no retained handle closes before recheck and remove only owned
   private artifacts; a post-commit signal cannot turn a committed result into
   cancellation. Indeterminate native publication is reconciled once, never
   blindly retried, and never triggers recursive deletion of an unknown tree.
8. `tests/cli/processSmoke.test.ts` covers raw stdout JSON/JSONL, inspect,
   validate, schema, stderr separation, invalid pre-open combinations, and the
   unsupported-host destination branch.
9. The exact Phase 2 gate passes: `npm run build`, `npm run test:reader`,
   `npm run test:compat`, `npm run test:cli`, and `npm run package:check`; the
   full `npm test` result is also reported. The native race gate covers all lease
   liveness/malformed/token states, parent swaps, source hardlinks/symlinks,
   no-force/force races, stage-entry injection, and definite/indeterminate
   directory publication.
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

## User decisions

None are open. The senior remediation selected Linux-capability-only hardened file
publication, fresh split roots, stable snapshot provenance, strict UTF-8 handling,
and the asynchronous iterator contract.

## Planning telemetry

- `okf_docs_read`: 0
- `okf_tokens_read`: 0
- `source_files_read`: 43
- `stale_okf_hits`: 0
- `missing_okf_hits`: 0
