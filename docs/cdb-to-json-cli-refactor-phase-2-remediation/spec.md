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
- `src/serialization/` and `src/commands/` do not exist.
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
- Multiple unmerged inputs require `split=database`; each database is an
  independent logical output in a directory. Input and output order is deterministic.
- Raw cannot use `--merge` or `split=card`.
- `--pretty` is valid only for JSON.
- Stdout is allowed only when there is one logical output. It is intentionally
  non-atomic; a late error may leave earlier bytes.
- File and directory destinations are atomic per logical output and require the
  native secure-destination capability. On an unsupported host they fail with
  `UNSAFE_DESTINATION_FILESYSTEM` and exit `6` before snapshot/open. There is no
  path-based fallback.
- `split=database` requires a nonexistent fresh output directory. Existing empty
  and populated roots both fail with `OUTPUT_DIRECTORY_EXISTS`; `--force` does not
  override this.
- A non-split existing file requires `--force`; without it the old final remains
  untouched. `--force` authorizes replacement only after the native reservation is
  held.
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

Use the existing stable diagnostic codes and add only a narrowly scoped
`PROFILE_NOT_AVAILABLE` code if needed for the Phase 2 capability rejection. Keep
`UNSAFE_DESTINATION_FILESYSTEM`, `OUTPUT_DIRECTORY_EXISTS`,
`INVALID_LIMIT_RELATION`, `RESOURCE_LIMIT_EXCEEDED`, `CANCELLED`, input/schema
errors, and raw UTF-8/integer diagnostics machine-readable. Preserve the accepted
precedence: option/matrix error `2`; no usable input `3`; input/schema/strict/
resource/integer error `4`; collision `5`; output/write/cancellation `6`; partial
continued execution `7`; unexpected failure `1`.

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
pre-discovery structural plan from the post-discovery concrete filename list; the
latter uses deterministic input ordinals and sanitized stems. No plan method may
open SQLite.

### `src/application/convertCatalog.ts`

Own conversion state and cleanup: `READING -> READY -> COMMITTING -> COMMITTED` or
`ABORTED`. Process databases in discovered order, create one collector per database,
stream rows into the current raw envelope, close the reader before publishing, and
publish only after all required pre-commit checks. Implement non-merged
`--continue-on-error` per-database atomicity; do not add raw merge behavior.
Return one aggregate result containing source reports and diagnostics for the CLI,
not only diagnostics attached to successful sources.

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
stream one compact record plus `\n`. Count/reserve every encoded chunk before the
write against both per-output and aggregate staging budgets.

### `src/destinations/*.ts` and native adapter

`nativeAdapter.ts` is the sole N-API loader/error translator. `secureDestination.ts`
provides the typed boundary and capability manifest. Modern file/directory output
must acquire one trusted root, traverse relative components without symlinks, hold
exclusive reservation/lock state, create private temporaries, publish no-clobber or
force replacement, and clean up descriptor-relatively. Update the native ABI/source
and build manifest as required; path-based `LockFile`/rename helpers must be removed
from the modern path, not merely left as a fallback.

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
| Unsupported host is accidentally made to pass with insecure output | Require explicit unsupported-host exit-6 test and keep stdout-only process smoke on Node 26. |
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
   Unicode, line endings, write failure, output limits, and staging limits are
   tested.
5. File and split-directory output is atomic per logical unit; existing finals are
   preserved on pre-commit failure; fresh split roots are enforced; unsupported
   native hosts return `UNSAFE_DESTINATION_FILESYSTEM` exit `6` without input open.
6. `inspect`, `validate`, and all item/aggregate `schema` selectors emit stable
   output without converted card records or SQLite access for schema selection.
7. SIGINT/writer failure closes readers/writers and removes private artifacts; a
   post-commit signal cannot turn a committed result into cancellation.
8. `tests/cli/processSmoke.test.ts` covers raw stdout JSON/JSONL, inspect,
   validate, schema, stderr separation, invalid pre-open combinations, and the
   unsupported-host destination branch.
9. The exact Phase 2 gate passes: `npm run build`, `npm run test:reader`,
   `npm run test:compat`, `npm run test:cli`, and `npm run package:check`; the
   full `npm test` result is also reported.

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
