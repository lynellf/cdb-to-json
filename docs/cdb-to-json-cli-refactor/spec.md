# Tactical implementation spec: `cdb-to-json` CLI refactor

## Status and source of truth

This is revision 7 of the tactical package for `docs/cdb-to-json-cli-refactor-spec.md`. It incorporates the plan-reviewer-a request for a concrete compatibility bridge, executable gates and fixtures, an explicit Phase 4 translator contract, and streaming/provenance verification; revision 2 addressed plan-reviewer-b's B1–B11 findings. Revisions 3–5 resolved adversarial findings B2-1 through B2-8 and R4-B1 through R4-B8 concerning output units, preflight resource limits, concurrent commits, cancellation barriers, source spans/snapshots, legacy replacement authorization, normalization conflicts, physical snapshots, UTF-8 fidelity, secure publication, and the async iterator. Revision 6 closes the follow-up review gaps by freezing `maxSnapshotBytes` in the CLI, making native build/package reproduction exact, declaring every Phase-0 gate script before use, freezing `UNSUPPORTED_DATABASE_ENCODING` in the initial diagnostic contract, and fixing aggregate schema filenames/identifiers. Revision 7 adds the implementation-checkpoint remediation package in `phase-0-1-remediation.md`: it explicitly maps the first code review's eight blocking findings to ordered corrective tasks and prevents a Phase 0–1 claim until the named artifacts and gates exist. The root spec remains normative for product behavior; these documents make its delivery executable.

## Goal and current request

Refactor the v1.0.5 directory-only JavaScript package into the TypeScript/ESM, CLI-first, library-backed ingestion tool described by the root spec. The implementation must preserve a documented v1.x default-export path during 2.x while adding `raw`, `card`, and `source` profiles, deterministic output, explicit diagnostics, and safe streaming destinations.

The current repository contains only `app/index.js`, `app/getDirectory.js`, `app/getTables.js`, one Node test, and a large checked-in CDB fixture. The current reader logs to the terminal, opens databases read-write, dynamically queries every non-system table, does not close handles, accepts filenames that merely contain `.cdb`, and writes synchronously without creating or atomically replacing outputs. `package.json` has only `npm test`, which runs `node __tests__/main.test.js`; dependencies are not installed in the planning environment, so the baseline command currently stops at `ERR_MODULE_NOT_FOUND` for `better-sqlite3` until `npm ci` is run.

## Remediation coverage

The following reviewed findings are addressed by explicit contracts and phase gates rather than deferred implementation intent:

| Finding | Resolution in this package |
|---|---|
| B1 streaming/merge correctness | `spec.md` bounded merge spool; Phase 3.4 two-pass index, lineage, late-duplicate, failure, and cancellation tests |
| B2 streaming/join correctness | `spec.md` three-pass fixed-column full join; Phase 1.3 duplicate preflight, orphan, ordinal, and large-fixture tests |
| B3 resource safety | `limits.v1`, finite defaults, pre-materialization/streaming enforcement, diagnostics, and Phase 0/1/2 oversized-input gates |
| B4 integer losslessness | safe-integer reader mode, signed-64 decimal raw encoding, boundary vectors, decoder retention, and legacy rejection contract |
| B5 CLI partial execution | severity/promotion and exit-precedence matrix, per-database atomicity, merge partial semantics, and Phase 2 negative tests |
| B6 packed compatibility | `main: dist/index.js`, root default export, source-only `app/index.js`, and Phase 5 clean-tarball assertions |
| B7 legacy names | isolated old candidate/basename/ignore policy, collision rejection, dotted/non-final fixtures, and migration documentation |
| B8 discovery security | explicit glob base/normalization, symlink cycle policy, deterministic ordering, and Phase 1 discovery matrix |
| B9 normalization authority | Phase 0 citation placeholder and Phase 3 stop gate requiring URL plus immutable source revision and independent vectors |
| B10 provenance determinism | enumerated canonical hash inputs/exclusions and independent toggle vectors in the spec and Phase 4.5 |
| B11 cancellation | public `AbortSignal`, scoped CLI SIGINT lifecycle, cleanup ordering, exit 6, and child-process iteration/write tests |
| B2-1 output contract | explicit profile/format/split/merge/output matrix, file units/names, pre-open rejection, and per-unit atomicity tests |
| B2-2 resource preflight | fixed byte-length-only text preflight, invalid-text policy, and aggregate spool/index budget |
| B2-3 concurrent commits | exclusive reservation, no-clobber commit, symlink policy, stale-lock behavior, and two-process race tests |
| B2-4 cancellation barrier | yielding iterator checkpoints, commit state machine, and pre-/during-/post-commit signal tests |
| B2-5 source spans | required normalized text, normalization version, and explicit UTF-16 span basis |
| B2-6 source snapshot | main/WAL/SHM bundle identity and post-read verification before publication |
| B2-7 legacy replacement | non-null legacy output directory explicitly authorizes compatible replacement, with atomic failure tests |
| B2-8 normalization conflicts | null-on-conflict primary fields, complete decoded arrays/raw masks, and independent schema vectors |

## Scope and behavior

Implement the root spec's six delivery phases:

### Revision-3 output contract matrix (B2-1)

The logical output unit is explicit and is selected before discovery opens any database:

| Profile | `format=json` unit | `format=jsonl` unit | Allowed `split` | Allowed `merge` |
|---|---|---|---|---|
| `raw` | one `cdb.raw/1` database envelope | one `cdb.raw/1` database envelope per line | `none` for exactly one database, or `database` | never |
| `card` | JSON array of `cdb.card/2` records, except `split=card` writes one record object per file | one `cdb.card/2` record per line | `none` for one merged stream, `database` for unmerged inputs, or `card` for a merged result | allowed only with `split=none` or `card` |
| `source` | JSON array of `ygo.card-source/1` documents, except `split=card` writes one document object per file | one source document per line | `none` for one merged stream, `database` for unmerged inputs, or `card` for a merged result | allowed only with `split=none` or `card` |

Additional matrix rules are normative:

- `merge=false` with more than one input requires `split=database`; `split=none` is rejected before opening inputs. `merge=true` requires `card` or `source` and produces one logical merged stream; `split=database` is rejected.
- `split=card` requires `card` or `source`, `merge=true`, and a directory destination. It writes one schema-valid record/document per final ID after conflict selection. A card filename is `<zero-padded-final-record-ordinal>-<id>.<profile>.<format>`; database filenames are `<zero-padded-input-ordinal>-<sanitized-input-stem>.<profile>.<format>`. Sanitization replaces every non `[A-Za-z0-9._-]` character with `_`, and the ordinal prevents basename collisions.
- `split=none` is a file destination or `-`. `split=database` and `split=card` are directory destinations. `-` is allowed only when exactly one logical output exists; no-output defaults to `-` only in that case, otherwise the CLI rejects the invocation and requests `--output`.
- `raw` JSON is an object envelope, not an array; raw JSONL is one complete envelope per line. Normalized JSON arrays are arrays only for aggregate streams, while split-card JSON is the individual record/document required by its schema. The profile schema identifiers govern each record/envelope; an aggregate JSON array is validated as `type: array` with `items` referencing that profile schema, and JSONL validates each line independently. `pretty` is rejected for JSONL and ignored nowhere.
- `--merge` on `raw`, `--split card` on `raw`, multiple unmerged inputs with `split=none`, stdout with multiple logical outputs, and incompatible output path kinds are invalid option combinations (exit 2) and must not open a database.
- Without `--continue-on-error`, all logical outputs are staged privately and no new final is committed if any input fails. With it, unmerged `split=database` commits successful database files independently and removes failed files; merged runs never commit their single final stream until every input succeeds, so a mixed merged run leaves no new final. A writer failure or cancellation always removes active staging and returns exit 6. A successful staged set is committed under the reservation protocol below.

1. contract, schemas, toolchain, and generated fixtures;
2. explicit read-only CDB extraction plus the compatibility bridge;
3. CLI commands, raw profile, destinations, diagnostics, and atomic writes;
4. card normalization through versioned registries;
5. conservative text segmentation, source profile, translator contract, streaming, and provenance checks;
6. hardening, migration documentation, package exports, CI, and release checks.

The CLI commands are `convert`, `inspect`, `validate`, and `schema`. `convert` defaults to `card`, accepts exact-final-extension `.cdb` files or directories, keeps stdout data-only, writes diagnostics to stderr, and supports deterministic `json`/`jsonl`, merge conflict policies, strict mode, and atomic destinations. Core modules remain callable without terminal or process-global logging.

### Required compatibility bridge

`src/legacy.ts` is the sole implementation of the deprecated v1-shaped API. A non-null `outputDir` is the legacy caller's explicit authorization to replace the old `<basename>.json` destinations, because the v1 signature has no `force` parameter and existing consumers rely on repeated writes. The bridge still uses the reservation/no-clobber machinery, but internally selects the force-compatible commit only for those legacy-named files. It never replaces a final after a read, integer conversion, writer failure, cancellation, or other pre-commit error; the output directory itself is created if absent. Two successive legacy calls and an injected failed second call are required compatibility tests. `app/index.js` remains a source-tree ESM shim that imports the built legacy module so existing repository consumers importing `app/index.js` continue to work after the TypeScript build. The package root's default export is also `legacyConvert` during 2.x.

`legacyConvert(inputDir, outputDir?, options?)` MUST:

- accept the old directory, output-directory, and `{ emit, ignore }` arguments;
- default `emit` to the old behavior when the options object is omitted;
- discover direct child `.cdb` files in deterministic order and compare `ignore` to the old basename-without-extension value;
- return `[{ name, data }]` where `data` has the legacy raw `datas`/`texts` table shape, not the `cdb.raw/1` envelope;
- write `<basename>.json` with that same raw table object when `outputDir` is supplied, creating the directory through the new destination service;
- route all reads through the new read-only explicit-table reader and close handles in `finally`;
- keep deprecation information off stdout and avoid all library-side `console.*` calls;
- preserve the old fixture's logical output and error-level behavior, while documenting that arbitrary unsupported user tables are no longer dynamically queried (the new safe raw profile exposes supported tables and recorded extras instead).

The bridge is tested through `app/index.js`, not only by calling the new application service, and its golden comparison uses the checked-in `__tests__/input_dir/cards.cdb` fixture plus a small generated fixture for `emit`, `ignore`, missing-input, and output-directory cases.

### Explicit Phase 4 translator contract

The source-profile boundary is a file/schema contract, not a dependency on the YGO-DSL repository or on SQLite:

- producer: `toSourceDocument(card, context)` in `src/profiles/sourceProfile.ts`;
- schema: `schemas/ygo.card-source.v1.schema.json`, identifier `ygo.card-source/1`;
- required stable fields: `schema`, `sourceRevisionId`, `identity`, `locale`, `printed`, `text`, `simulatorSource`, `references`, `coverage`, `provenance`, and `diagnostics`;
- `text.raw` is exact source text; `text.normalized` and `text.normalizationVersion: "text-normalization/1"` are required, and derived sections carry inclusive/exclusive UTF-16 code-unit spans with `spansBasis: "normalized"` and `offsetEncoding: "utf-16-code-units"`;
- `coverage.status` is `SOURCE_ONLY`; `references.scripts` and `references.rulings` are empty unless a future declared source is supplied;
- `simulatorSource.rawRows` and decoded metadata retain source facts without turning category flags or prose into DSL operations;
- `sourceRevisionId` is computed from the exact canonical lossless source-facts/lineage object defined below, including verified database-bundle hash, row identity and ordinals, locale, registry content hashes, text-normalization version, limits, and semantic conversion options, while excluding output path, format, pretty-printing, diagnostic rendering, and process timing;
- consumer: a generic JSON/JSONL reader validates this schema and passes the document to the first translator stage. It MUST NOT import `src/cdb`, open SQLite, or require a bespoke CDB adapter.

The Phase 4 gate includes a fixed 64-record source pilot selected by stable IDs from generated/checked-in fixtures. A contract consumer reads both JSON and JSONL outputs, validates every document, and asserts that all 64 are accepted as `SOURCE_ONLY` without executable effect fields.

### Explicit source-text contract (B2-5)

`ygo.card-source/1` requires both `text.raw` and `text.normalized`. `text.raw` is the exact SQLite description, including original line endings and Unicode code-unit sequence. `text.normalized` uses `text-normalization/1`: CRLF and CR become LF, and Unicode NFC is applied; no other rewriting is permitted. The document includes `text.normalizationVersion: "text-normalization/1"`, `text.spansBasis: "normalized"`, and `text.offsetEncoding: "utf-16-code-units"`. Every `TextSlice.start` is inclusive and every `end` exclusive, measured in JavaScript UTF-16 code units into `text.normalized`; `text.text` is the corresponding slice and must equal `text.normalized.slice(start, end)`. A generic consumer never applies normalized offsets to `text.raw`. Raw-only profile output remains exact and has no derived span contract.

Combining characters, astral Unicode, CRLF, and CR fixtures are required. The source schema requires the normalization metadata and a generic translator-contract consumer validates every slice against `text.normalized`; changing the normalization policy/version is a semantic provenance change.

## Explicit normalization-conflict contract (B2-8)

Decoders never choose a precedence among conflicting source flags. `cardKind` is the sole known primary kind only when exactly one supported primary family is present; no family yields `UNKNOWN`, and multiple families yield `UNKNOWN` plus `CONFLICTING_CARD_KIND_FLAGS`. `traits` and `simulator` retain every known flag and the raw mask/unknown bits. A spell/trap subtype is populated only when exactly one compatible subtype is present; no subtype is `null`, and multiple compatible subtypes yield `null` plus `CONFLICTING_SUBTYPE_FLAGS`. A multi-bit monster-type or attribute result has a complete ordered `monsterTypes`/`attributes` array, while singleton `monsterType`/`attribute` is `null` unless exactly one known value exists. The JSON Schema permits those arrays and nullable singleton fields.

Progression is null-on-conflict: `level`, `rank`, and `linkRating` are populated only when exactly one frame interpretation is supported by the decoded traits; conflicting or multiple interpretations set all affected primary fields to `null` and emit `CONFLICTING_PROGRESSION_FLAGS`. Pendulum scales are independently populated only when both packed scale values are valid. Every conflict diagnostic includes the raw type/progression values; strict mode promotes these diagnostics to errors. Independent fixtures cover zero, singleton, multi-bit, conflicting, and unknown masks before Phase 3's mapper gate.

The `cdb.card/2` conflict-safe shape is fixed: `typeLine.monsterType: string | null` is the singleton convenience value and `typeLine.monsterTypes: string[]` is the complete ordered known decode; `monster.attribute: string | null` and `monster.attributes: string[]` follow the same rule. Each corresponding typed surface also carries its decimal-string `rawValue` and `unknownBits` (or the same values under `simulator.rawFields` when the surface is absent). Spell/trap surfaces use `subtype: string | null` plus `subtypes: string[]`. `monster.level`, `rank`, and `linkRating` are nullable convenience values while `monster.progression` retains `{rawValue, unknownBits, level, rank, linkRating, pendulum}`. If `cardKind` is `UNKNOWN`, typed monster/spell/trap convenience surfaces are `null` unless their source family is unambiguous; the complete mask decode remains in `simulator` and diagnostics. These exact nullable/array/raw properties are required by the Phase 0 schema fixture and cannot be inferred by an implementer.

## Explicit streaming and provenance requirements

The implementation must make streaming observable and testable rather than merely naming iterator APIs:

- Unmerged CDB row iteration uses `better-sqlite3` iterators and the bounded full join, and processes databases sequentially; merged `first`/`last` uses the disk-backed two-pass spool and is not advertised as single-pass streaming;
- JSONL writes one compact record and newline per record; JSON-array writing emits delimiters incrementally and never requires a complete-card array; every encoded chunk is counted against `max-output-bytes` before writing;
- a writer failure or cancellation closes the database, removes the merge spool when present, and removes the temporary sibling file without replacing a prior destination;
- a generated high-cardinality fixture is converted in a child process with `--max-old-space-size=256`; the streaming gate compares output to a collected reference and asserts bounded operation without using an all-record `Array` in the unmerged writer path;
- provenance tests toggle every included hash input and every excluded presentation input independently and assert the documented `sourceRevisionId`/conversion-options behavior;
- every normalized record includes database SHA-256, source filename, row ID, converter version, normalization registry, and diagnostics; merged `first`/`last` records retain all contributing source lineage.

## Constraints and non-goals

Follow the root spec's Node 22+, strict TypeScript, native ESM, `tsc`, `better-sqlite3`, `node:util.parseArgs`, JSON Schema 2020-12, and Vitest decisions. Do not add a bundler. Do not execute Lua, SQL or card text from values; do not infer PSCT/DSL semantics; do not silently drop unknown bits; do not overwrite outputs without `--force`; do not treat `ot` as current legality; do not bundle card databases.

Out of scope are scripts/rulings ingestion, full PSCT parsing, DSL compilation, card database serving/editing, automatic downloads, CDB writing, and semantic archetype inference. New normalized fields, enum changes, collision precedence changes, marker interpretations, source-hash changes, and legacy API removal require a stop-and-confirm decision.

## Correctness, resource, and compatibility contracts added by remediation

The following contracts are normative for the phase plans. They remove the previously implicit choices around joins, merge streaming, limits, integer width, diagnostics, cancellation, and packaging.

### Bounded joins and merge

`readCdb()` performs a bounded three-pass read over each database:

1. A preflight pass runs fixed, quoted `COUNT(*)` and duplicate-ID statements for `datas` and `texts`. Counts are checked against `limits.v1.maxRowsPerTable` before card values are materialized. Any duplicate ID is a schema error (`DUPLICATE_CARD_ID`) and prevents an output from being opened.
2. A fixed-column full-join statement (a `datas LEFT JOIN texts` branch `UNION ALL` an orphan-`texts` branch) streams one logical row at a time. The statement carries deterministic `dataOrdinal` and `textOrdinal` values generated from canonical signed-int64 numeric ID order (data branch before a text orphan); no table is loaded into a JavaScript map. Missing partners are retained as incomplete rows with their stable diagnostics. The join's explicit column list is the only place supported source columns are selected.
3. A cleanup/finalization pass verifies row and byte counters and closes the database in `finally`.

The join query is ordered by canonical decimal card ID and then the available source ordinal. Duplicate preflight means the join cannot silently create a many-to-many cross product. A large fixture with missing partners, duplicates, and an extra table proves that duplicate validation, orphan retention, raw values, ordinals, and bounded operation agree.

Unmerged conversion streams rows directly. A merged conversion uses a disk-backed two-pass spool, not an in-memory record map: each canonical normalized record is written once to a length-delimited temporary spool and an on-disk index records card ID, input ordinal, source ordinal, spool offset/length, and source reference. A second ordered index scan selects the `first` or `last` winner and reads all contributing lineage references before writing one final record. `error` fails on the first indexed collision. The spool and index have the same resource/cancellation ownership as the destination and are removed on every failure. Thus merged output is bounded-memory but is not advertised as single-pass streaming. Late-duplicate high-cardinality tests cover `error`, `first`, and `last`.

### Resource limits and exact integer representation

The public options expose a versioned `limits.v1` object and CLI flags `--max-rows`, `--max-text-bytes`, `--max-output-bytes`, `--max-staging-bytes`, and `--max-spool-bytes`. Defaults are finite: 1,000,000 rows per required table, 4 MiB UTF-8 bytes per text value, 2 GiB per logical output, 4 GiB aggregate staging, and 2 GiB merge-spool bytes. A caller may lower or raise them explicitly, but the selected values are included in the diagnostic report and semantic conversion-options hash. Limits are enforced before row materialization, while reading text values, while serializing each output chunk, and while writing private merge/staging state. A violation emits `RESOURCE_LIMIT_EXCEEDED`, maps to exit code 4, closes the database, and removes temporary siblings without replacing an existing destination.

The text limit is enforced by a fixed preflight query before the full join: for each supported `texts` column (`name`, `desc`, and `str1` through `str16`), the reader selects only `id` and `length(CAST(column AS BLOB))` for values over the limit. It never selects an over-limit text value. The measured quantity is the stored SQLite UTF-8 byte length; `NULL` counts as zero. The same value is checked again with `Buffer.byteLength` after retrieval. Supported text cells must be SQLite TEXT or NULL; BLOB/non-text values and invalid UTF-8 are rejected with `INVALID_TEXT_VALUE`/`INVALID_TEXT_ENCODING` rather than coerced or silently replaced. The contract intentionally limits each retained cell; the fixed row shape and output limit remain separate controls.

`maxSpoolBytes` is an aggregate private-merge-storage budget, not merely a spool-file budget. The reservation counter covers the length-delimited record spool, sorted/index files, lineage metadata, and their temporary siblings. Every write reserves encoded bytes before writing and reconciles against actual file sizes; index growth alone can therefore raise `RESOURCE_LIMIT_EXCEEDED`. No destination is opened before text/row preflight succeeds.

The reader enables `better-sqlite3` safe-integer mode and accepts the complete signed SQLite 64-bit range. Every SQLite INTEGER in `cdb.raw/1`, `simulatorSource.rawRows`, canonical hashes, and diagnostics is represented as a decimal string with `integerEncoding: "signed-int64-decimal"`; no JSON number conversion occurs at the raw boundary. Decoders parse these strings as `bigint`, emit friendly numeric fields only when the value is representable in the declared schema, and always retain the decimal raw value. Values outside signed 64-bit or malformed integer values emit `INTEGER_OUT_OF_RANGE` and fail validation. The legacy bridge converts only safe decimal integers to the v1 JSON number shape and rejects an unsafe legacy value with `LEGACY_INTEGER_UNREPRESENTABLE`; it never rounds it.

### Diagnostic matrix and partial execution

The stable severity matrix is:

| Diagnostic family | Default severity | `--strict` |
|---|---|---|
| unknown registry bits, incomplete partner, malformed packed value, ambiguous text | `WARNING` | `ERROR` |
| informational provenance/extra-table notices | `INFO` | `INFO` |
| duplicate IDs, missing required schema, open/read failure, resource limit, invalid integer, cancellation | `ERROR` | `ERROR` |
| collision under `--on-conflict error`, output conflict/write failure | `ERROR` | `ERROR` |

The error-precedence contract is: option validation (`2`), no usable input (`3`), input/schema/strict/resource/integer failure (`4`), merge collision (`5`), output conflict/write/cancellation (`6`), partial conversion (`7`), and otherwise unexpected internal failure (`1`). A later output failure takes precedence over a pending partial result; a database/input failure takes precedence over collision and output only when no output operation has failed. The implementation records all diagnostics even when the first terminal code is selected.

`--continue-on-error` is per-database and atomic. Without merge, successful database destinations are retained, each failed attempt's private files/locks are removed, any pre-existing final is preserved byte-for-byte, processing continues in deterministic input order, and exit `7` is returned only when at least one database succeeded and at least one database failed. With merge, successful records may remain in the private spool, but no merged final destination is renamed until every input succeeds; a mixed result therefore leaves no merged output and returns `7`. A collision under `--on-conflict error` is global and terminal exit `5`, never a skippable partial result. A writer failure is not recoverable by this flag: it removes the active temporary output and returns `6`. Diagnostics identify the database ordinal and never claim a failed database was emitted.

### Destination reservations and commit barriers (B2-3/B2-4)

Every final file (and every staged split output) obtains an exclusive sibling reservation `<final>.cdb-to-json.lock` with `open(..., O_CREAT|O_EXCL)`. The lock records a random owner token, PID, and creation time; a live lock is never bypassed, including by `--force`. If the recorded PID is absent, a stale lock may be removed and retried; if the PID exists or the lock is malformed, the CLI refuses the destination and requires explicit operator cleanup. `--force` authorizes replacing an existing final only after the reservation is held; it does not override another process's reservation. Output parent components and final paths must not be symlinks, and the resolved parent must remain under the selected output root. The input realpath/file identity is rechecked after reservation and immediately before commit, so an output cannot replace an input after a TOCTOU path change.

Without `--force`, commit uses same-filesystem exclusive publication (a completed temp file is linked to the absent final and then the temp is unlinked); an existing final yields `OUTPUT_EXISTS` and is never clobbered. With `--force`, the completed temp is renamed over the final while the reservation is held. All reservations are released in `finally`; staging and reservations are removed on failure. A two-process race test covers no-force/no-force, force/no-force, stale locks, symlinked parents, and input replacement.

The application conversion state is `READING -> READY -> COMMITTING -> COMMITTED` or `ABORTED`. `better-sqlite3` iterators check `AbortSignal` every row and await `scheduler.yield()` at least once in each 256-row window (and before each commit), allowing SIGINT to run despite synchronous SQLite iteration. A signal observed before `COMMITTING` aborts, closes writer then database, removes staging/spool/locks, preserves any existing final, and returns exit 6. The synchronous publication operation is the commit barrier: once `COMMITTING` begins it completes and marks `COMMITTED`; a signal delivered during or after that barrier does not roll back a committed file or misreport it as cancelled. Tests inject signals before, during, and after the barrier in addition to child-process iteration/write tests.

### Discovery, legacy names, provenance, and cancellation

Modern discovery accepts only an exact final `.cdb` extension. `--exclude` globs are matched against slash-normalized paths relative to the supplied directory root, before symlink traversal; explicit files are matched against their basename and relative path. Discovered symlinks are skipped by default. With `--follow-symlinks`, realpaths are tracked to prevent cycles and a target is visited once; ordering remains normalized relative-path order. These rules are tested for nested directories, excludes, symlink defaults/following, explicit files, and repeatability.

`legacyConvert` intentionally uses a separate compatibility policy: direct children whose names contain `.cdb` are candidates, `name` is exactly the old first-dot basename, and `ignore` compares that derived name. Dotted names and non-final suffixes are therefore accepted as v1 did. A derived-basename collision is rejected before reading with `LEGACY_BASENAME_COLLISION` rather than silently overwriting an output. Modern discovery never uses this policy. The packed package's public legacy path is the root default export; `app/index.js` is a source-tree compatibility shim only.

The source revision contract uses `canonical-json/cdb-to-json/source-revision/v1`: UTF-8, sorted object keys, no insignificant whitespace, explicit array order, finite values only, and decimal-string integers. Included inputs are the contract/schema identifier, converter major version, verified database-bundle SHA-256, every contributing source row's exact supported raw facts and canonical data/text ordinals, locale (or `und`), source namespace, all registry versions/content hashes, the text-normalization policy/version, and one shared semantic-options object containing `{profile, strict, includeRaw, merge, onConflict, locale, sourceNamespace, setcodeRegistryHash, availabilityRegistryHash, textNormalizationVersion, limits}`. Excluded inputs are output path, output directory, format, pretty-printing, diagnostic rendering, process timing, and lock tokens. `sourceRevisionId` hashes the canonical source facts plus lineage and that semantic object; `conversionOptionsHash` hashes exactly the semantic object. Independent vectors toggle every included and excluded field.

The database SHA-256 identifies a stable private source snapshot bundle, not an unqualified live main-file read. The bundle hash is the canonical SHA-256 of an ordered tuple containing member names (`main`, `-wal`, `-shm`), explicit presence markers, and each copied member's bytes; absent sidecars are represented explicitly. Before opening a database, the reader captures/copies the main file plus every present `-wal`/`-shm` sidecar and rechecks original identities/bytes; a mutation, appearance, or disappearance retries and then emits `SOURCE_MUTATED_DURING_READ`. It opens only the copied bundle with ordinary WAL-capable access, runs `VACUUM INTO` to create a private main-only materialized snapshot, closes that connection, and opens only the materialized file read-only with `immutable=1` for extraction. Extraction never replays WAL or creates a sidecar. A valid stable WAL bundle is supported; if replay/materialization fails, the input emits `CDB_OPEN_FAILED` rather than falling back to a live read.

`convert()` accepts `signal?: AbortSignal`. Its options also expose `limits?: LimitsV1` and `sourceNamespace?: string`, and the selected options are passed unchanged to hashing and diagnostics. The CLI installs one SIGINT handler immediately around the application call and removes it in `finally`; the handler aborts the signal, stops row iteration at the next yielded checkpoint, closes the writer and SQLite handle, unlinks spool/temp siblings and reservations, and never renames a partial result before the commit barrier. A cancellation observed before `COMMITTING` emits `CANCELLED` and exits `6`; a cancellation after `COMMITTED` is reported only as post-commit informational state and does not change a successful exit. An existing final remains untouched on pre-commit cancellation. A child-process test sends SIGINT during iteration and during a deliberately delayed write, and verifies cleanup; unit tests cover the commit barrier. A second signal is recorded while cleanup is in progress and is allowed to terminate only after the first cleanup path has completed.

## Assumptions and open concerns

- The root spec's recommended `ygo.card-source/1` identifier is accepted for this implementation; Phase 4 is a publication stop if the downstream consumer rejects it.
- The existing CDB and JSON fixtures are test inputs only; no new third-party database is bundled.
- The existing `npm test` script remains a compatibility smoke test after it is changed to build first; focused scripts introduced by Phase 0 are the authoritative gates thereafter.
- `npm ci` is required before any test command; the current environment has no `node_modules`.
- The registry field layouts and names must be pinned to an authoritative, versioned source before Phase 3 implementation. No external registry source was supplied in this planning handoff; Phase 0 records the source URL/commit and stops Phase 3 if it cannot be independently cited.
- Native `better-sqlite3` support on the release Node/OS matrix remains a release concern, but it must not weaken the signed-int64 or read-only contracts.

## Risks and mitigations

| Risk | Impact | Mitigation/stop condition |
|---|---|---|
| A registry source is unavailable or disagrees with generated fixtures | Incorrect card normalization | Require a citable URL/commit/checksum and hand-authored vectors before Phase 3; preserve raw values and stop on disagreement |
| Full joins or merge policies accidentally materialize records | Heap exhaustion or incorrect late-collision output | Fixed SQL join plus disk-backed merge index; child-process 256 MiB gate and late-duplicate fixture |
| Untrusted text/database exceeds host resources | Disk/heap exhaustion or partial artifacts | `limits.v1` enforced before materialization and before writes; atomic cleanup tests |
| SQLite INTEGER values exceed JavaScript safe range | Silent corruption or serialization failure | Safe-integer mode and decimal-string raw boundary; only explicit legacy safe-number conversion |
| SIGINT arrives during iteration or rename | Open handle or misleading partial output | Abort propagation, ordered cleanup, pre-existing-final preservation, and child-process signal tests |
| Downstream DSL rejects `ygo.card-source/1` | Published source contract incompatibility | Phase 4 publication stop; revise schema and pilot atomically, never add an undocumented alias |
| Legacy and modern filename rules diverge | Consumer breakage or accidental collisions | Separate policies, dotted/non-final fixtures, collision preflight, packed-root compatibility test |

## Acceptance criteria

1. `npm ci`, `npm run build`, and the full test command pass on supported Node platforms.
2. `node dist/cli.js convert __tests__/input_dir/cards.cdb --profile raw --format json` emits schema-valid data and never writes human diagnostics to stdout.
3. `convert`, `inspect`, `validate`, and `schema` implement the documented option validation, exit codes, diagnostics, and output-conflict behavior.
4. The legacy wrapper tests pass through `app/index.js`, preserve the raw table return/write shape, and leave no terminal logging.
5. Raw profiles preserve every supported source integer/string/null exactly; unknown bits and malformed rows produce stable diagnostics.
6. Card fixtures covering all major frames produce schema-valid normalized records with typed fields and no unexplained primary-surface bitmask integers.
7. Text segmentation preserves exact raw text and source spans, leaves ambiguous content unsplit, and emits no executable semantics.
8. A 64-record source pilot is accepted by the translator contract consumer from both JSON and JSONL without a CDB adapter; every document is marked `SOURCE_ONLY`.
9. Unmerged streamed JSON/JSONL output is equivalent to a collected reference, honors backpressure, and cleans up on failure/cancellation within the 256 MiB child-process gate; merged output uses the specified bounded spool and preserves late collision lineage.
10. The profile/format/split/merge matrix is executable: unsupported combinations fail before opening inputs, allowed JSON/JSONL units validate against their schemas, filenames are deterministic, and no-continue/continue partial semantics are observable.
11. Text byte limits fail in a byte-length-only preflight before selecting oversized values; aggregate spool/index limits fail before exceeding budget; concurrent destination races cannot clobber without `--force`.
12. Cancellation is responsive during synchronous iteration and has a tested commit barrier; pre-commit cancellation leaves prior finals untouched, while post-commit signals do not misreport success.
13. Source spans are validated against required normalized text with explicit UTF-16 offsets, and main/WAL/SHM source mutation is rejected before publication.
14. Repeated conversions prove deterministic record order, canonical JSON, source-revision/provenance hashes, and merge lineage.
15. Migration, schema, registry, package-content, and rollback documentation is present, and `npm pack --dry-run` contains only declared runtime artifacts.

## Verification command contract

Phase 0 adds these exact package scripts before later gates use them:

```text
build               tsc -p tsconfig.json
test:fixtures       vitest run tests/fixtures
test:unit            vitest run tests/unit
test:reader          vitest run tests/reader
test:compat          vitest run tests/compatibility
test:cli             vitest run tests/cli
test:normalization   vitest run tests/normalization
test:source          vitest run tests/source
test:streaming       vitest run tests/streaming
test:conformance     vitest run tests/conformance
test                npm run build && vitest run
package:check       npm pack --dry-run
```

Focused gates in phase files use the corresponding `npm run` commands. A full implementation gate is:

```bash
npm ci
npm run build
npm test
npm run package:check
```

## Rollback/stop policy

Each phase must leave the previous phase's gate passing. If a schema or public export changes incompatibly, stop rather than add an undocumented adapter. If a fixture exposes an unknown bit or packed-field ambiguity, preserve the raw value, add a diagnostic/golden case, and stop normalization work until the registry decision is explicit. If a write or cancellation test leaves a destination or database handle behind, stop release work until cleanup is proven.

## Package artifacts

- `docs/cdb-to-json-cli-refactor/spec.md` — this tactical spec;
- `docs/cdb-to-json-cli-refactor/phase-0-contract-fixtures.md` through `phase-5-hardening-release.md` — ordered implementation phases;
- `docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md` — operational reference for versioned limits, severity, exit precedence, partial execution, and cancellation;
- canonical product requirements remain in `docs/cdb-to-json-cli-refactor-spec.md`.

## Revision 4 corrective addendum — normative remediation of R3-1 through R3-7

This addendum is part of the tactical package. It resolves the independent adversarial review findings R3-1 through R3-7. Where an earlier paragraph says only “output bytes,” “source row order,” “UTF-8,” “sidecars,” “semantic options,” “lossless,” or “incomplete record,” this addendum supplies the precise contract and supersedes the less-specific wording.

### R4.1 Output atomicity, aggregate resource scope, and aggregate schemas (R3-1)

`limits.v1` gains `maxStagingBytes`, a finite non-negative safe integer with a default of 4 GiB and CLI flag `--max-staging-bytes`. `maxOutputBytes` remains the maximum encoded byte count for each logical output unit; `maxStagingBytes` is one aggregate reservation budget covering every private unmerged staging file, temporary sibling, lock/reservation record, and merge spool/index/lineage file for the conversion. `maxSpoolBytes` remains the aggregate cap specifically for merge-private storage and is also bounded by `maxStagingBytes`. The selected values are included in the semantic options object and diagnostics. Every encoded chunk reserves against the applicable output and staging counters before writing, then reconciles to actual bytes; index/lock growth cannot bypass the aggregate cap. A failed reservation emits `RESOURCE_LIMIT_EXCEEDED` before the write.

File and directory destinations are atomic at the logical-output level. In no-continue mode all newly produced final files are staged privately and no final is published until all databases and all output units succeed. With `--continue-on-error`, unmerged `split=database` outputs are independently atomic: a successful unit may commit, while a failed unit removes only its attempt and preserves any pre-existing final. A pre-existing final is never removed or replaced before the successful commit barrier, including when a later database fails. Merged output remains one transaction: any input failure or merge collision prevents its final from being published.

Stdout is explicitly a non-atomic streaming destination. It is allowed only for one logical output, and prior bytes cannot be retracted after a later input/limit/source/writer failure. The report/exit code and stderr diagnostics identify the failure; no claim of all-or-nothing stdout is made. Tests cover stdout resource-limit, input-failure, writer-failure, and cancellation partial-stream behavior separately from file atomicity.

Aggregate JSON-array units have named schema identifiers `cdb.card-array/2` and `ygo.card-source-array/1`; their `items` reference `cdb.card/2` and `ygo.card-source/1` respectively. Raw JSON remains one `cdb.raw/1` envelope, never an array. `schema card-array` and `schema source-array` print the aggregate schemas; `schema card` and `schema source` print item schemas. JSONL validates each line as its item/envelope schema, and split-card JSON validates as one item. The schema command and conformance tests must not treat an aggregate array as if it were an individual profile record.

### R4.2 Supported raw boundary and incomplete join records (R3-2)

“Lossless raw” means lossless for the fixed supported standard schema only: `datas(id, ot, alias, setcode, type, atk, def, level, race, attribute, category)` and `texts(id, name, desc, str1..str16)`. `cdb.raw/1` preserves every supported column, including NULL and empty text, with signed-int64 decimal encoding for source INTEGERs. `extraTables` and extra-column metadata contains table/column names and row counts only; it is explicitly not a cell-value dump. Future extra-value support requires a new raw schema version and safely quoted table-scoped extraction. The legacy v1 bridge intentionally returns only the same supported `datas`/`texts` tables.

Valid IDs are always present on an emitted row because invalid IDs are rejected before the join. A `datas`-only row has `id` from `datas`, `identity.externalIds` containing that ID, `name: null`, `text.raw: null`, `text.normalized: null` (where present), `cardKind: "UNKNOWN"`, empty `traits`, `typeLine: null`, `monster: null`, `spell: null`, `trap: null`, and a non-null `simulatorSource.rawRows.datas` with `rawRows.texts: null`; it carries `MISSING_TEXT_ROW`. A `texts`-only row has the analogous ID identity, `name` and exact text from `texts`, all data-derived printed/simulator fields null or empty, `rawRows.datas: null`, `rawRows.texts` populated, and `MISSING_DATA_ROW`. `card` and `source` schemas require these nullable states. Source documents use `printed.name: null`, `printed.cardKind: "UNKNOWN"`, null typed surfaces, a required text object whose raw/normalized values are nullable, null sections with `UNSPLIT` when no description exists, and the same raw-row/diagnostic lineage. No placeholder name, type, stat, effect, or executable meaning may be invented. Golden orphan fixtures validate both schemas.

### R4.3 Total row ordering and source ordinals (R3-3)

After storage-class and ID validation and duplicate preflight, each table's zero-based ordinal is assigned by a fixed numeric signed-64-bit ascending order of canonical ID. The explicit full-join output is ordered by `(numeric id, branch rank, available ordinal)`, where the data-backed branch ranks before a text orphan at the same ID. Valid IDs are non-null signed-int64 values including zero and negative values; their canonical spelling is `0` or `-` followed by decimal digits with no leading zeroes. Because duplicate IDs fail before iteration, this is a total order. No SQLite insertion order, implicit `rowid`, filesystem enumeration, JavaScript number comparison, or lexicographic ID comparison may influence ordinals, merge winners, filenames, or hashes. Fixtures include IDs `-2`, `0`, `2`, `10`, signed-64 extrema, orphans, and the same logical rows inserted in a different physical order; expected records, ordinals, hashes, and collision winners are identical.

### R4.4 Database encoding and stable WAL snapshot policy (R3-4/R3-5)

The reader requires `PRAGMA encoding` to report exactly `UTF-8`; `UTF-16le`/`UTF-16be` and any unavailable/ambiguous result fail before text selection with `UNSUPPORTED_DATABASE_ENCODING` (exit 4). The text preflight's `length(CAST(column AS BLOB))` therefore measures the documented stored UTF-8 bytes. Preflight first checks `typeof(column)` for every supported text cell: only `text` and `null` are valid. A wrong storage class is reported as `INVALID_TEXT_VALUE` before its length is considered; a valid TEXT cell over the byte limit is `RESOURCE_LIMIT_EXCEEDED` without selecting its value; a valid under-limit cell is checked for UTF-8 after retrieval and may emit `INVALID_TEXT_ENCODING`. This precedence is fixed and tested.

The source hash covers a stable snapshot bundle, not an unqualified live main file. Snapshot acquisition runs before the database is opened: capture the main file and any present `-wal`/`-shm` member identities, copy all present members into a private sibling bundle, reserve bytes, and re-stat/re-hash the original members. A member appearing, disappearing, changing identity/size, or changing bytes during acquisition retries a bounded number of times and then emits `SOURCE_MUTATED_DURING_READ`; it never silently drops a sidecar. The copied bundle is opened only with ordinary WAL-capable access, then `VACUUM INTO` creates a private main-only materialized file. After that connection closes, extraction opens only the materialized main file read-only with `immutable=1`; no extraction read replays WAL or creates a sidecar. The reader verifies copied member identities/hashes before publication and deletes snapshot/materialized artifacts after provenance is retained. The bundle hash includes ordered member names (`main`, `-wal`, `-shm`), explicit presence markers, and bytes. A stable WAL bundle, a main-only database, a present-but-empty/required-sidecar case, acquisition-time sidecar mutation, materialization failure, and post-copy snapshot mutation are all fixtures. If replay/materialization cannot complete, the input fails with `CDB_OPEN_FAILED` rather than falling back to a live read.

### R4.5 Provenance hash inputs (R3-6)

There is one canonical semantic-options object, used by both hashes:

```json
{
  "profile": "raw|card|source",
  "strict": false,
  "includeRaw": false,
  "merge": false,
  "onConflict": "error|first|last",
  "locale": "en|und|...",
  "sourceNamespace": "konami|...",
  "setcodeRegistryHash": null,
  "availabilityRegistryHash": "sha256:...",
  "limits": {
    "maxRowsPerTable": 1000000,
    "maxTextBytes": 4194304,
    "maxOutputBytes": 2147483648,
    "maxStagingBytes": 4294967296,
    "maxSpoolBytes": 2147483648,
    "maxSnapshotBytes": 4294967296
  },
  "textNormalizationVersion": "text-normalization/1"
}
```

`conversionOptionsHash` is the lowercase SHA-256 of canonical JSON for exactly this object (with normalized locale and source namespace), and therefore changes when locale, source namespace, limits, registry hashes, or any other semantic option changes. `sourceRevisionId` hashes a canonical object containing the contract/schema, converter major, verified physical bundle hash, exact supported raw facts, row identity and canonical ordinals, all contributing lineage, and this same semantic-options object. Both hashes exclude output path/directory, format, pretty-printing, diagnostics rendering, process timing, and lock tokens. Independent toggle vectors cover every included and excluded field, including locale, namespace, and `maxSnapshotBytes`.

### R4.6 Input validation and continuation/collision semantics (R3-7)

Before duplicate checks or the join, the reader validates storage class for every source field. `datas.id` and `texts.id` must be non-null SQLite INTEGER; all other `datas` numeric fields must be INTEGER or NULL; all supported `texts` fields must be TEXT or NULL. Numeric-looking TEXT, REAL, BLOB, and NULL IDs emit `INVALID_CARD_ID`; wrong non-null numeric storage emits `INVALID_INTEGER_VALUE`; no value is coerced. SQLite INTEGER values are accepted only in signed 64-bit range and cross the boundary as decimal strings. These diagnostics are always errors and map to exit 4. Invalid IDs never produce incomplete records.

`--continue-on-error` applies only to independent database-level input/read/strict failures in unmerged `split=database`, and to input failures accumulated before a merged final is eligible. A collision under `--merge --on-conflict error` is a global output invariant failure, never skippable and never converted to exit 7; it stops merged processing, leaves no new merged final, and returns exit 5 unless a more severe output/cancellation (6) or prior input/schema/resource/integer failure (4) has precedence under the existing matrix. A mixed merged input failure without a collision returns exit 7 only after at least one input succeeded and no merged final was published. A failed replacement attempt always removes only its private staging and lock; any pre-existing final remains byte-for-byte untouched. Tests cover collision after an earlier failed input, collision with `--continue-on-error`, and force replacement failure with an existing final.

### Revision-4 phase assignment and mandatory gates

- **Phase 0:** add aggregate schemas, incomplete-record schemas/goldens, ID storage-class/order vectors, UTF-8/UTF-16 fixtures, stable-WAL fixture builders, `maxStagingBytes`, and the semantic-hash toggle matrix.
- **Phase 1:** implement snapshot-copy/encoding policy, type/ID preflight, canonical ordinals, and lifecycle tests before any join/destination work.

## Revision 5 — Senior remediation tactical translation

This section is the implementation-facing translation of `senior-remediation-spec.md` and supersedes any earlier conflicting passage in this package. It is intentionally explicit about module boundaries, lifecycle ownership, diagnostics, exit paths, and named fixture gates. The senior decisions are accepted; implementers must not replace them with live reads, path-based publication, clamping, permissive decoding, or a synchronous public iterator.

### R5.1 Public boundaries and support matrix

The v2 public reader is asynchronous and cancellable:

```ts
export type ReadOptions = {
  signal?: AbortSignal;
  limits?: LimitsV1;
  strict?: boolean;
};

export function iterateRawCards(
  databasePath: string,
  options?: ReadOptions,
): AsyncIterableIterator<RawCardRows>;
```

`convert()` consumes this iterator; there is no synchronous public iterator. A direct consumer owns `return()`/`finally` cleanup. The iterator checks `signal` before work and for every row, then awaits `scheduler.yield()` at least once in each 256-row window. An abort at a checkpoint rejects with the stable `CANCELLED` diagnostic and leaves cleanup to the iterator's `finally` path.

Secure file and split-directory destinations are supported only on Node 22+ Linux with the native adapter, `openat2`, and the adapter's required `openat`, `linkat`, and `renameat2` primitives. Stdout remains available without that adapter. Unsupported platforms, kernels, filesystems, or missing native builds return `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) before input discovery/opening; there is no path-based fallback.

### R5.2 Module and lifecycle contract

The implementation uses these concrete boundaries:

- `src/cdb/snapshotBundle.ts`: captures and copies `main`, present `-wal`, and present `-shm` before any SQLite open; retries bounded source mutation races; computes the physical bundle hash; owns source re-stat/re-hash verification.
- `src/cdb/materializeSnapshot.ts`: opens only the private copied bundle with ordinary WAL-capable SQLite access, runs `VACUUM INTO` to a private main-only materialized database, closes the bundle connection, and reports `CDB_OPEN_FAILED` on replay/materialization failure. It never opens an original path and never falls back to a live read.
- `src/cdb/openDatabase.ts`: opens only the materialized main file read-only with `immutable=1`, extensions disabled, and safe-integer mode; extraction never opens a WAL/SHM member.
- `src/cdb/textPreflight.ts`: validates SQLite encoding/storage classes, selects only `CAST(column AS BLOB)` for retained text, and strictly decodes UTF-8 with `TextDecoder(..., {fatal: true})`.
- `src/application/stagingBudget.ts`: reserves and reconciles physical temporary-file bytes once across snapshot members, materialized main, output staging, merge spool/index/lineage, and lock records. `maxSnapshotBytes` is checked against both the source bundle sum and aggregate staging before copying.
- `src/application/normalizeOptions.ts`: validates all non-negative safe-integer limits and rejects `maxSpoolBytes > maxStagingBytes` or `maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION` (exit 2), without clamping or opening an input.
- `src/destinations/secureDestination.ts`: TypeScript boundary for the native adapter; it exposes trusted-root descriptors, descriptor-relative temporary/lock/publication operations, and capability probing.
- `native/secure-destination/`: the audited N-API/native module (`binding.gyp`, `src/secure_destination.cc`, and its narrow header/API). It owns `openat2` resolution with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, no-follow directory opens, `openat`, `linkat`, and `renameat2`; no unchecked string path is resolved after root acquisition.

The conversion lifecycle is `READING -> READY -> COMMITTING -> COMMITTED` or `ABORTED`. Pre-commit abort closes writer then SQLite, verifies/records snapshot state as applicable, deletes materialized/snapshot/spool/index/temp/lock artifacts, and preserves prior finals. Once synchronous publication enters `COMMITTING`, it completes and marks `COMMITTED`; a later signal cannot relabel that result as cancelled.

### R5.3 Physical snapshot and logical-order invariants

The bundle hash and `sourceRevisionId` are physical-snapshot identities: canonical hash input is the ordered tuple of `main`, `-wal`, and `-shm` member names, explicit presence markers, and copied bytes. A source with equivalent logical rows but different SQLite physical insertion/layout therefore has different bundle hash and `sourceRevisionId`. Canonical signed-int64 numeric IDs, zero-based data/text ordinals, record order, merge winner choice, normalized record content, and `conversionOptionsHash` remain identical. No logical-source-revision hash is exposed.

A valid WAL-only committed row is accepted only through copied-bundle replay and `VACUUM INTO` materialization. The original source and its sidecars are never modified, and extraction creates no sidecar. Materialization failure, unstable sidecars, or post-copy verification failure publishes no output.

### R5.4 Text, split-root, and secure-publication behavior

Before selecting any supported text value, the reader requires `PRAGMA encoding = 'UTF-8'`, validates `typeof()` as TEXT/NULL, and applies the byte-size preflight. Over-limit values fail without being selected. Retained text is selected as BLOB bytes and decoded strictly; invalid UTF-8 emits `INVALID_TEXT_ENCODING` before any output, and malformed storage emits `INVALID_TEXT_VALUE`. Permissive driver strings are never validation evidence.

For `split=database` and `split=card`, `--output` must name a nonexistent directory. The converter validates the secure destination capability and creates the fresh root only after pre-open option checks; an empty or populated existing root emits `OUTPUT_DIRECTORY_EXISTS` (exit 6), and `--force` does not change this. Only legacy `<basename>.json` replacement remains the separately documented compatibility exception.

Every modern file/split output is published through `secureDestination.ts` and the native descriptor-relative adapter. No-force uses descriptor-relative no-clobber publication; force uses descriptor-relative replacement while holding the reservation. Parent swaps, symlink components, input/output identity changes, lock creation, temporary creation, and both force modes are covered by adversarial tests.

### R5.5 Limits and diagnostic/exit contract

`LimitsV1` contains `maxRowsPerTable`, `maxTextBytes`, `maxOutputBytes`, `maxStagingBytes`, `maxSpoolBytes`, and `maxSnapshotBytes`; defaults are respectively 1,000,000, 4 MiB, 2 GiB, 4 GiB, 2 GiB, and 4 GiB. Every selected limit is included unchanged in the shared semantic-options object and both relevant reports/hashes. Relations are reject-only: equality and less-than are valid; greater-than is `INVALID_LIMIT_RELATION` exit 2; zero is valid and enforced.

Add stable diagnostics `INVALID_LIMIT_RELATION`, `CDB_OPEN_FAILED`, `INVALID_TEXT_ENCODING`, `OUTPUT_DIRECTORY_EXISTS`, and `UNSAFE_DESTINATION_FILESYSTEM` alongside the existing matrix. Exit precedence remains: option/limit relation 2; no usable input 3; schema/open/read/encoding/text/integer/strict/resource failure 4; merge collision 5; output conflict, unsafe destination, write failure, or cancellation 6; mixed continued database failures 7. Output directory existence and secure-destination capability are checked before opening inputs, but are output failures (6), not silently reclassified as input failures.

### R5.6 Mandatory named fixture gates

The implementation is not ready for coding review until these tests exist and are named in the phase documents:

- `tests/reader/walMaterialization.test.ts`: WAL-only committed row, source member immutability, no extraction sidecar, materialization failure/no publish.
- `tests/reader/textByteFidelity.test.ts`: BLOB/fatal UTF-8 retrieval, invalid bytes, wrong type precedence, UTF-16 rejection, and oversized-value non-selection.
- `tests/reader/physicalSnapshotProvenance.test.ts`: physical bundle hash changes after physical reorder while canonical rows/ordinals/winners remain equal.
- `tests/cli/freshSplitRoot.test.ts`: empty/non-empty existing roots, `--force` rejection, and pre-open failure.
- `tests/cli/secureDestinationRace.test.ts`: concurrent parent replacement across lock, temp, no-force, and force paths, plus unsupported capability.
- `tests/reader/stagingSnapshotBudget.test.ts`: `maxSnapshotBytes`, aggregate staging reservation/reconciliation, cleanup, and extra-table/WAL over-budget pre-copy rejection.
- `tests/cli/limitRelations.test.ts`: zero/equal/less/greater relation vectors before discovery/open.
- `tests/api/iterateRawCards.test.ts` and `tests/api/iterateRawCards.types.test.ts`: async iterator signature, per-row abort, scheduler checkpoints, direct-consumer cleanup, and `convert()` reuse.

Each test must assert diagnostics and exit path, not merely thrown-message text. A fixture gate failure blocks v2 and preserves the v1 compatibility path; it must not be “fixed” by weakening the selected senior decision.

### R5.7 Required phase ordering

Phase 0 freezes the added limits, diagnostics, schemas, API declarations, native capability contract, and fixture builders. Phase 1 implements snapshot acquisition/materialization, encoding/text preflight, canonical IDs, staging reservations, and async row iteration before join work. Phase 2 implements fresh split roots and the native secure destination boundary before CLI output work. Phases 3–4 consume the canonical rows and physical provenance without changing them. Phase 5 verifies Linux support, packed native artifacts, rollback, and all gates.

- **Phase 2:** implement aggregate schema selection, aggregate staging reservations, explicit non-atomic stdout behavior, and many-input/output-limit/partial-file tests.
- **Phase 3:** consume canonical ordinals and preserve orphan/raw-row states in card mapping; no decoder may invent missing fields.
- **Phase 4:** use the same semantic-options object in provenance, and add generic aggregate-schema, orphan, UTF-16 span, WAL, and hash tests to the translator/streaming gates.
- **Phase 5:** declare the supported filesystem/OS matrix and no-replace primitive; run packed artifact, stable-WAL, many-output staging, and continuation/collision release tests.

The acceptance criteria and verification command contract above are extended by these gates; a plan-reviewer must reject implementation routing if any R4 contract is only described as an unbounded “add tests” intention rather than an executable task with the named fixtures and failure outcome.

## Revision-7 implementation-checkpoint remediation

The first implementation checkpoint was reviewed as `REQUEST-CHANGES`. The implementation report claimed Phase 0–1 complete, but the checkpoint did not meet the already accepted tactical package. The correction is intentionally limited to Phase 0–1; Phases 2–5 remain deferred. The complete ordered implementation delta, exact files, test fixtures, stop conditions, and verification commands are in `phase-0-1-remediation.md`.

The review findings are binding for the checkpoint:

| Finding | Required correction | Gate proving closure |
|---|---|---|
| Missing Phase 0 toolchain/gates/native capability | Add the exact focused scripts, reproducible native build/capability manifest, and package checks before claiming Phase 0 | `npm run build:native`, `npm run test:fixtures`, `npm run test:conformance`, `npm run package:check` |
| Unsafe integer/raw contract | Use safe-integer SQLite mode, signed-int64 decimal strings, storage-class/range validation, and null preservation | `tests/fixtures/integerVectors.test.ts`, `tests/reader/textByteFidelity.test.ts` |
| Unbounded/materializing join and incomplete cancellation | Add duplicate/row/text preflight, explicit bounded full join, canonical ordinals, async-only iterator, signal checkpoints, and cleanup | `tests/reader/joinDiagnostics.test.ts`, `tests/reader/largeJoin.test.ts`, `tests/api/iterateRawCards.test.ts` |
| Live reads and no physical snapshot lifecycle | Capture main/WAL/SHM, hash/recheck, materialize copied WAL, then extract immutable main only | `tests/reader/walMaterialization.test.ts`, `tests/reader/physicalSnapshotProvenance.test.ts` |
| Legacy path still unsafe/broken | Route `app/index.js` through the safe bridge; preserve v1 discovery/name/ignore/result/write behavior and root default export | `tests/compatibility/legacy.test.ts`, `tests/compatibility/legacy-output.test.ts` |
| Symlink/discovery policy violation | Use lstat/realpath policy, normalized root-relative excludes, cycle prevention, and a separate legacy discovery policy | `tests/reader/discovery.test.ts`, `tests/compatibility/legacyNames.test.ts` |
| Diagnostics/strict/exit aggregation missing | Merge per-database diagnostics, apply strict promotion and stable exit precedence, and classify no-input | `tests/unit/diagnosticsPolicy.test.ts`, `tests/cli/exitCodes.test.ts` |
| Green tests did not cover the contract | Restore app-shim coverage, add fixture/conformance/reader/compat/API suites, and make `npm test` run the complete declared suite | all Phase 0–1 focused gates plus `npm test` |

No reviewer finding is rejected. Authoritative registry citation and downstream source-schema acceptance remain later-phase stop gates as already documented.

## Revision-6 reviewer remediation closure

The five latest review findings are closed as follows:

1. **CLI snapshot limit:** the normative root CLI table and Phase 2 parser task expose `--max-snapshot-bytes`; its default, reject-only relation to `maxStagingBytes`, pre-copy enforcement, diagnostics, and semantic-hash inclusion are frozen.
2. **Native reproducibility:** Phase 0 and Phase 5 name `node-gyp@11.2.0`, `scripts/build-native.mjs`, the exact `build:native`/`build` commands, checked-in `binding.gyp` inputs, `dist/native/secure_destination.node`, `dist/native/capability.json`, manifest checksum verification, package allowlisting, and Linux release-host failure behavior. Unsupported hosts retain only the stdout test path and never use path-based fallback.
3. **Phase-0 gate target:** Phase 0.1 declares `test:conformance` as `vitest run tests/conformance` before the Phase-0 gate invokes it; all other focused targets are declared in the same task.
4. **Encoding diagnostic:** `UNSUPPORTED_DATABASE_ENCODING` is frozen in Phase 0.2 as an unconditional exit-4 input diagnostic, with the UTF-8 preflight and fixture gate.
5. **Aggregate schema names:** item and aggregate schema filenames and identifiers are fixed to `schemas/cdb.card-array.v2.schema.json`/`cdb.card-array/2` and `schemas/ygo.card-source-array.v1.schema.json`/`ygo.card-source-array/1`; the prior “bounded equivalent” wording is removed.
