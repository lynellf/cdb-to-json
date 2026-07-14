# Senior remediation specification — physical snapshots and safe publication

**Status:** normative delta for the CLI refactor package (2026-07-12)

## Verified context and boundaries

The repository is currently a small ESM library (`app/index.js`, `app/getDirectory.js`, `app/getTables.js`) backed by `better-sqlite3`; it has no CLI, TypeScript build, streaming implementation, or secure output adapter. The proposed v2 package adds all of those. This delta supersedes conflicting or underspecified language in `docs/cdb-to-json-cli-refactor-spec.md`, `docs/cdb-to-json-cli-refactor/spec.md`, phase documents, and `limits-and-diagnostics.md`. It resolves plan-reviewer-b findings R4-B1 through R4-B8.

The product still supports raw/card/source conversion, v1 compatibility, immutable source facts, and cancellation. It does **not** promise portability for hardened local-file publication: secure file/directory destinations are a Linux capability in v2. Stdout remains supported everywhere and remains non-atomic.

## Goals

1. Give physical database provenance, logical record determinism, WAL handling, text fidelity, directory publication, filesystem safety, resource accounting, and cancellation one unambiguous contract.
2. Ensure untrusted input and hostile filesystem paths cannot silently exceed stated private-storage budgets or redirect file output outside the chosen root.
3. Keep the public streaming API cancellable without claiming that a synchronous iterator yields to the event loop.

## Non-goals

- A logical-content hash that is invariant across SQLite file layouts.
- Cross-platform secure file publication in v2.
- Reusing or cleaning an existing split-output directory automatically.
- Preserving malformed UTF-8 as text.

## Architecture decisions

### D1 — Physical snapshot identity and logical ordering are separate (R4-B1)

`databaseSha256` / database bundle hash and `sourceRevisionId` are **physical-snapshot identities**. They include copied `main`, `-wal`, and `-shm` bytes and therefore change when equivalent rows are inserted in a different physical SQLite layout.

Canonical signed-int64 ID ordering controls only record order, data/text ordinals, merge winner selection, normalized record content, and `conversionOptionsHash`. Define `canonicalDataProjection(record)` for physical-reorder tests: for `cdb.card/2` remove only `source.databaseSha256`; for `ygo.card-source/1` remove only `sourceRevisionId` and `simulatorSource.database.sha256`; `identity.databaseSha256` is not a permitted source-schema field. Retain IDs, supported raw facts, ordinals, normalized fields, diagnostics, semantic provenance, and lineage. Tests that reorder physical inserts MUST expect equal projections/ordinals/merge winners and a changed bundle hash and `sourceRevisionId`; full serialized records may differ only at those physical identity paths. Any additional physical identity field requires a contract revision. The converter exposes no logical-source-revision hash in v2.

### D2 — WAL is materialized before immutable extraction (R4-B2)

A stable source bundle is captured first. Snapshot acquisition obtains a held descriptor for the input parent without symlink traversal, opens each `main`, and exact present `-wal`/`-shm` member with `O_NOFOLLOW|O_RDONLY|O_CLOEXEC` (or an equivalent descriptor-safe primitive), fstat-verifies the regular-file identity observed by `lstat`, and copies/hashes from the held descriptor. A path-based copy after lstat is forbidden; deterministic member-swap tests prove a replacement symlink/identity is never read. Snapshot acquisition copies `main` and the exact present `-wal`/`-shm` members while detecting source changes as already specified.

The copied bundle is opened only inside its private snapshot directory using ordinary SQLite WAL-capable access; originals are never opened. In that private database, the reader runs SQLite `VACUUM INTO` to create a new private **main-only materialized snapshot**. It then closes that connection. Extraction opens only that materialized main file read-only with `immutable=1`; no WAL replay is attempted in immutable mode and no source or copied bundle sidecar can be created during extraction.

The physical source bundle hash remains the provenance identity. The materialized database is a disposable read artifact, not provenance. Failure to open/replay the copied WAL bundle or to materialize it is `CDB_OPEN_FAILED`; there is no live-read fallback. Tests must prove a committed WAL-only row is extracted, no original member changes, no extraction sidecar is created, and materialization failure publishes nothing.

### D3 — Text is retrieved as bytes and strictly decoded (R4-B3)

After storage-class and byte-size preflight, every retained supported text value is selected as `CAST(column AS BLOB)`. It is decoded by `TextDecoder('utf-8', { fatal: true })`; only that decoded string is retained as `raw`. Thus raw text preserves the exact decoded Unicode sequence from stored UTF-8 bytes, including original line endings. Invalid bytes produce `INVALID_TEXT_ENCODING` before join/output. A permissive driver string and `Buffer.byteLength` are never validation evidence.

### D4 — Split output directories are fresh and exclusive (R4-B4)

For `split=database` or `split=card`, `--output` MUST name a nonexistent directory. The converter creates it only after validating it as a secure destination root, and it owns all contents. If it exists (empty or non-empty), reject before opening an input with `OUTPUT_DIRECTORY_EXISTS`; `--force` does not alter this rule. Users must select a fresh directory or explicitly remove/archive the old one. This prevents stale managed output and preserves unrelated files by never adopting their directory.

Legacy `<basename>.json` replacement remains its separately documented compatibility exception.

### D5 — Hardened file publication requires descriptor-relative primitives (R4-B5)

File and split-directory output on Linux MUST use a small, audited native secure-destination adapter. It opens the chosen root as a trusted directory descriptor, traverses all requested relative components with `openat2` using `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` (and no-follow directory opens), and creates locks, temporaries, no-clobber publication, and forced replacement by descriptor-relative operations (`openat`, `renameat2`) bound to that descriptor. The adapter never resolves an unchecked string path after root acquisition.

If the adapter, kernel, filesystem, or required no-replace primitive is unavailable, file/directory output fails before input opening with `UNSAFE_DESTINATION_FILESYSTEM`; there is no path-based fallback. The support matrix is Node 22+ on Linux with `openat2` and the adapter’s required `*at` primitives. Stdout needs no destination adapter. Tests use a concurrent parent-directory replacement adversary covering lock, temporary creation, no-force, and force paths.

### D6 — Snapshot bytes are private staging and bounded (R4-B6)

`LimitsV1` adds `maxSnapshotBytes`, default 4 GiB. It is an aggregate private snapshot/materialization budget covering copied main/WAL/SHM members, the materialized main, and generated private SQLite journal/WAL/SHM/temporary siblings for the source lifecycle; the pre-copy sum of present source member sizes is an early rejection, not the complete enforcement. Every copy/write chunk reserves against a dedicated snapshot counter before writing and reconciles actual growth afterward. The same physical file is charged once to the aggregate `maxStagingBytes` counter, which also covers destination staging, locks, commit journals/backups, and merge state; it is never double-counted within either counter. Snapshot private files are removed on every success/failure/cancellation after provenance is no longer required. Extra-table metadata uses the same bounded resource policy: a safely quoted, value-free probe reads at most `maxRowsPerTable + 1` sentinel rows, reports `RESOURCE_LIMIT_EXCEEDED` with `MAX_EXTRA_TABLE_ROWS_EXCEEDED` on overflow, and never selects extra-table cells.

The effective reservation is charged once per physical temporary file; it is not double-counted merely because it is both a snapshot and staging. A tiny supported schema plus a large extra table/WAL must fail before copying when budget is insufficient.

### D7 — Limit option normalization is reject-only (R4-B7)

All limits are non-negative safe integers. Before discovery/opening any input, option validation rejects `maxSpoolBytes > maxStagingBytes` or `maxSnapshotBytes > maxStagingBytes` as exit 2 with `INVALID_LIMIT_RELATION`. No value is clamped. The requested values are therefore exactly the enforced and hashed values. Equality, less-than, greater-than, and zero-boundary vectors are required.

### D8 — One asynchronous cancellable iterator API (R4-B8)

Replace the proposed public synchronous signature with:

```ts
export function iterateRawCards(
  databasePath: string,
  options?: ReadOptions & { signal?: AbortSignal },
): AsyncIterableIterator<RawCardRows>;
```

This is a new v2 named API; it has no v1 compatibility obligation. It checks the signal per row and awaits `scheduler.yield()` at least once per 256 rows. `convert()` uses this same iterator. A direct iterator consumer receives `CANCELLED`/an abort rejection at a checkpoint and owns `return()`/`finally` cleanup. No synchronous public iterator is provided or implied.

## Invariants and failure behavior

- A valid WAL source is accepted only through D2 materialization; `immutable=1` is never used to replay WAL.
- No malformed text reaches a raw, card, or source output.
- A file output either remains its old final or passes the publication barrier; no write escapes the trusted root.
- Split conversion never mixes a previous run’s contents with a new run.
- Snapshot, materialization, spool, and destination temporary storage are all covered by finite aggregate staging reservation.
- A pre-commit abort removes all private artifacts; a post-barrier abort cannot reclassify a committed result as cancelled.

## Required tactical updates and acceptance criteria

The mid-level package must replace contradictory passages and add named tests for D1–D8. In particular it must:

- amend provenance tests per D1;
- implement the D2 copied-bundle/materialize/extract sequence with a WAL-only-row fixture;
- use D3 BLOB/fatal-decoder retrieval with invalid-byte fixture;
- enforce D4 fresh split output roots;
- define the D5 native adapter boundary, support matrix, and parent-swap tests;
- add `maxSnapshotBytes` and aggregate snapshot/materialization reservations under D6;
- reject invalid D7 limit relations before discovery; and
- update API declarations/type tests/runtime cancellation tests for D8.

Implementation may not start until the revised tactical package names the adapter module, source/materialization lifecycle, diagnostics, exit paths, and tests needed for each decision.

## Risks and rollback

The native secure-destination adapter and WAL materialization are high-risk integration points. If either cannot meet its named fixture gate, do not weaken it to path-based writes or live reads; retain v1 and block v2 release. Rollback restores v1 packaging; no conversion should have modified an input database.

## Unresolved user decisions

None. The conservative Linux-only hardened-destination scope is selected to preserve the stated output-root security invariant rather than silently weaken it.
