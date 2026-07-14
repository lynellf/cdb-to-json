# Operational contract — limits, diagnostics, partial execution, and cancellation

This document is part of the implementation plan and becomes the user-facing reference in Phase 5. The root spec and tactical spec remain normative.

## `limits.v1`

The application and CLI expose these limits:

| Name | CLI flag | Default | Enforcement |
|---|---|---:|---|
| `maxRowsPerTable` | `--max-rows` | 1,000,000 | fixed `COUNT(*)` for required tables; bounded value-free `LIMIT maxRowsPerTable + 1` probe for each extra table |
| `maxTextBytes` | `--max-text-bytes` | 4 MiB | fixed byte-length-only preflight for every supported text cell, then post-retrieval check |
| `maxOutputBytes` | `--max-output-bytes` | 2 GiB | per logical output, before each destination write |
| `maxStagingBytes` | `--max-staging-bytes` | 4 GiB | aggregate reservation for all private outputs, temp siblings, locks, and merge state |
| `maxSpoolBytes` | `--max-spool-bytes` | 2 GiB | aggregate reservation for merge spool, index, lineage metadata, and temp siblings; bounded by staging |
| `maxSnapshotBytes` | `--max-snapshot-bytes` | 4 GiB | aggregate private snapshot/materialization budget for copied main/WAL/SHM members, materialized main, generated private SQLite files, and temporary siblings; pre-copy member sum is only an early check; every copy/write chunk reserves and reconciles; bounded by staging |

Values are non-negative safe integers. The selected limits are reported in machine diagnostics and included in the semantic conversion-options hash. A limit violation emits `RESOURCE_LIMIT_EXCEEDED`, closes the reader, and removes all temporary output without replacing an existing final destination. The reader first requires SQLite UTF-8 encoding; `maxTextBytes` measures stored UTF-8 bytes only.

`maxTextBytes` measures stored SQLite UTF-8 bytes using `length(CAST(column AS BLOB))` without selecting the over-limit text value. `NULL` is zero. UTF-16 databases fail before preflight with the unconditional input diagnostic `UNSUPPORTED_DATABASE_ENCODING` (exit 4); wrong text storage class is diagnosed before size, oversized valid TEXT is not selected, and under-limit values are checked for UTF-8 after retrieval. SQLite TEXT/NULL are the only accepted text cell types. `maxSnapshotBytes` has a dedicated counter for copied source members, materialized main, generated private SQLite journal/WAL/SHM files, and snapshot/materialization temporary siblings. The pre-copy size sum cannot be the only enforcement: every copy/write chunk reserves before writing and reconciles actual growth, so growth after stat and late generated files are bounded. `maxSpoolBytes` is one aggregate private-storage budget; every spool, sorted index, lineage record, and temporary sibling write reserves bytes first and reconciles actual file sizes. `maxStagingBytes` covers each snapshot physical file once plus private file/directory staging, commit journals/backups, locks, and merge state; stdout is non-atomic and is charged only to `maxOutputBytes`.

## Diagnostic severity and exit precedence

Unknown registry bits, incomplete joins, malformed packed fields, and ambiguous text are warnings by default and errors under `--strict`. Informational provenance and extra-table notices remain informational. Duplicate IDs, required-schema failures, open/read failures, integer failures, resource failures, cancellation, collisions under `--on-conflict error`, and output failures are always errors.

The terminal exit mapping is selected by one ordered predicate matrix, implemented only by `computeExitCode`:

| Predicate (evaluated in order) | Code |
|---|---:|
| option or limit-relation error | `2` |
| `!hasUsableInput && !inputAccessStarted` with no input/strict/resource/collision/output/cancellation/internal failure | `3` |
| output conflict/write failure or cancellation | `6` |
| input/schema/strict/resource/integer failure, when output did not fail | `4` |
| merge collision, when output and input did not fail | `5` |
| continued processing with at least one completed and one failed input | `7` |
| unexpected internal failure | `1` |
| successful completion | `0` |

The matrix is intentionally not a numeric total ordering. Output failure/cancellation overrides pending input, collision, or partial state; input failure overrides collision when no output operation failed; collision overrides partial success. A pre-open output failure remains code `6`, while missing/empty discovery with no input access, no input failure, and no output failure is code `3`. Option validation is evaluated before discovery, and no-input is evaluated before opening databases. Pairwise tests cover input+writer failure, input+cancellation, input+collision, collision+writer failure, option/no-input combinations, and mixed continuation.

## Atomic partial execution

Without `--continue-on-error`, any database failure aborts before the commit-set barrier. For a run with multiple finals, all reservations are held and a descriptor-relative commit journal records each staged final and any force backup; publications occur in deterministic order and a failure between them rolls back already-published entries in reverse order. No-force rollback removes only finals created by this run; force rollback restores prior finals byte-for-byte. A successful commit set removes the journal/backups only after every final succeeds. With `--continue-on-error` and without merge, each database owns its own temporary sibling: successful siblings are renamed and retained, failed attempts and locks are removed; any pre-existing final is preserved byte-for-byte, and later inputs are attempted in deterministic order. This is the explicit per-database atomic exception. Diagnostics include the database ordinal.

With merge, successful inputs may be stored in the private disk spool, but the merged final destination is renamed only after all inputs succeed. A mixed run therefore leaves no merged final output and returns code 7. A writer failure is not recoverable by `--continue-on-error`; it removes the active temporary output and returns code 6. If commit rollback itself fails, the recovery journal/backups are retained, the diagnostic identifies the recovery artifact, rerun refuses to adopt it, and the result is exit 6 rather than an undocumented partial-success claim.

Extra-table metadata is bounded: a safely quoted, value-free probe reads at most `maxRowsPerTable + 1` sentinel rows. A table that reaches the sentinel emits `RESOURCE_LIMIT_EXCEEDED` with `MAX_EXTRA_TABLE_ROWS_EXCEEDED`, selects no cell values, and prevents output; an under-limit table records its exact count. There is no unbounded extra-table `COUNT(*)` scan.

## Cancellation

`convert()` accepts an `AbortSignal`, and the only public row iterator is asynchronous. The CLI installs one SIGINT handler around the application call and removes it in `finally`. Synchronous SQLite iteration checks the signal every row and awaits `scheduler.yield()` at least once in each 256-row window, so the first signal can run before the complete database is consumed. Before the commit-set barrier, cleanup closes the writer, closes SQLite, removes merge spool/index, destination temp siblings, commit journals/backups, and destination reservations, and does not rename a partial result. Existing finals are untouched. The conversion state enters an irreversible `COMMITTING` barrier immediately before ordered commit-set publication: a signal before it emits `CANCELLED` and returns code 6; a signal during/after it leaves the committed result and successful exit intact. A child-process test interrupts during database iteration and during a delayed write, and deterministic tests inject failure after each final publication for both force and no-force, prove reverse rollback, and cover explicit rollback-recovery state.

## Concurrent destination safety

Each final destination has an exclusive `<final>.cdb-to-json.lock` reservation. `--force` allows replacement of an existing final only after acquiring the reservation; it never bypasses a live lock. A lock whose recorded PID is absent may be reclaimed, while a live or malformed lock requires operator cleanup. Output path components must not be symlinks, and source identity/output collision checks are repeated after reservation and immediately before publication. No-force publication is exclusive/no-clobber; force publication is atomic replacement. Two-process race, stale-lock, symlink-parent, and input-replacement tests are release gates.

## Revision-4 corrections

The following rules supersede any earlier wording in this operational reference.

### Aggregate staging and stdout

`maxOutputBytes` is enforced per logical output unit. `maxStagingBytes` is an additional finite `limits.v1` field, default 4 GiB and CLI flag `--max-staging-bytes`, covering the aggregate bytes of all unmerged staging files, temporary siblings, lock records, and merge spool/index/lineage files. `maxSpoolBytes` is the merge-private sub-budget and cannot exceed the aggregate staging budget. Private file/directory writers reserve bytes before each write and reconcile actual file sizes, including index and reservation growth; stdout reserves/checks only `maxOutputBytes` because it has no private staging file. The limit is included in diagnostics and the semantic hash; exceeding it emits `RESOURCE_LIMIT_EXCEEDED` before the attempted write.

File/directory outputs are atomic per logical unit. In no-continue mode a multi-output run additionally uses a commit-set journal: all reservations are held, finals publish in deterministic order, and a between-final failure reverse-rolls back new no-force finals or restores force backups byte-for-byte. The journal/backups are removed only after all finals commit; rollback failure retains explicit recovery state and returns exit 6. In unmerged `split=database --continue-on-error`, successful units commit independently and a failed attempt removes only its private staging; this is the explicit per-database atomic exception and any pre-existing final remains untouched. A merged final is never committed after a mixed input result. Stdout is explicitly non-atomic streaming: it is permitted only for one logical output, prior bytes remain if a later failure occurs, and exit/diagnostic output reports the partial stream. The CLI makes no all-or-nothing claim for stdout.

Aggregate JSON output has explicit schemas `cdb.card-array/2` and `ygo.card-source-array/1`; `schema card-array`/`schema source-array` emit those, while item schemas remain `card`/`source`. Raw JSON is one `cdb.raw/1` envelope and JSONL validates one envelope/item per line.

### Input shape, encoding, and snapshot

Before duplicate checks or joins, `datas.id` and `texts.id` must be non-null SQLite INTEGER values; all other numeric `datas` cells must be INTEGER or NULL, and text cells must be TEXT or NULL. Invalid IDs emit `INVALID_CARD_ID`; other wrong storage classes emit `INVALID_INTEGER_VALUE`; no coercion is permitted. Valid IDs are canonical signed-int64 decimal strings and are numerically ordered, with canonical-ID-derived zero-based source ordinals independent of insertion order.

The reader requires SQLite `PRAGMA encoding = 'UTF-8'`. Non-UTF-8 databases fail before value selection with `UNSUPPORTED_DATABASE_ENCODING`, exit 4. Type checks precede text-size checks; oversized valid TEXT is rejected without selecting its value, while under-limit values are checked for UTF-8 after retrieval.

The database hash is for a stable private snapshot bundle. `sourceHandle` captures only regular non-symlink main/WAL/SHM members before opening SQLite, stream-copies them, and incrementally hashes the exact canonical bytesBase64 tuple with bounded base64 carry state; original identities and bytes are rechecked. The copied bundle is opened only for ordinary WAL-capable replay and `VACUUM INTO`, whose private path is a verified SQLite literal; generated private journal/WAL/SHM files are inventoried and cleaned. Extraction opens only the resulting private main file through a `uri:true` URI with `immutable=1` and `defaultSafeIntegers()`. A member mutation or appearance/disappearance emits `SOURCE_MUTATED_DURING_READ`; a symlink/non-regular member is rejected before opening; replay/materialization failure emits `CDB_OPEN_FAILED`; the reader never silently ignores a WAL/SHM member or falls back to a live read. Stable WAL, main-only, hostile-path, sidecar mutation, generated-private cleanup, materialization, and no-extraction-sidecar tests are required.

### Provenance and merge continuation

`conversionOptionsHash` and `sourceRevisionId` use the same semantic options, including normalized `locale`, `sourceNamespace`, `textNormalizationVersion`, registry hashes, and every limit (including `maxStagingBytes`). They exclude path, format, pretty, diagnostics rendering, timing, and lock tokens. A merge collision under `on-conflict=error` is global and terminal (exit 5, not 7); `--continue-on-error` cannot skip it. Exit 7 is reserved for mixed database input failures without a collision and without a writer/cancellation failure. A failed force replacement never removes a prior final.

## Revision-5 remediation corrections

- `maxSnapshotBytes` is a non-negative safe integer and is checked before copying the sum of present source bundle members; snapshot and materialized files reserve/reconcile against aggregate `maxStagingBytes` exactly once per physical file. `maxSnapshotBytes > maxStagingBytes` and `maxSpoolBytes > maxStagingBytes` are reject-only `INVALID_LIMIT_RELATION` option failures (exit 2); values are never clamped.
- `split=database` and `split=card` require a nonexistent output directory. Existing empty and non-empty roots both emit `OUTPUT_DIRECTORY_EXISTS` (exit 6) before input discovery/opening; `--force` does not override this rule. Only legacy output names may use the documented replacement exception.
- Modern file and split output uses `src/destinations/secureDestination.ts` and the Linux native descriptor-relative adapter. Missing `openat2`/required `*at` capability emits `UNSAFE_DESTINATION_FILESYSTEM` (exit 6), with no path-based fallback. Parent replacement, symlinks, reservations, temporary creation, no-force, and force are adversarially tested.
- `sourceRevisionId` includes the verified physical bundle hash, so physically reordered SQLite layouts change that identity even when `canonicalDataProjection(record)`, canonical numeric-ID rows/ordinals, merge winners, and `conversionOptionsHash` remain equal; full records differ only at declared physical identity fields. The implementation does not expose a logical-source-revision hash.

## Revision-12 enforcement corrections

`maxSnapshotBytes` is admitted by the finite page/WAL-derived bound in
`materialization-quota.md` before the copied bundle is opened writable or
`VACUUM INTO` runs. Post-operation inventory and injected budget events are
supplementary evidence. An unprovable bound fails closed as `CDB_OPEN_FAILED`;
an over-bound source emits `RESOURCE_LIMIT_EXCEEDED` before private SQLite
writes. All private files are reconciled against their admitted per-file bounds.

Commit rollback is identity guarded and durable: journal and backup fsyncs occur
before publication and between publication states, rollback touches only an
exact published identity, and an external mutation or interrupted orphan
journal yields `OUTPUT_RECOVERY_REQUIRED` (exit 6) with retained recovery state.
Legacy output follows the same descriptor-relative native capability matrix; no
path or cross-device fallback is allowed. The authoritative P1/P2 scripts must
fail when named suites are absent, and `phase-dispatch-check.mjs` blocks P3/P4
until fresh evidence passes.
