# Phase P5 — Conservative text segmentation, source profile, and translator/streaming contract (delivery Phase 4)

## Outcome

Produce provenance-rich `ygo.card-source/1` documents from typed card records, while proving that text handling is conservative and that streamed output is equivalent to collected output. This phase is the handoff boundary to the YGO-DSL translator; it does not implement a translator.

## Ordered tasks

### 4.1 Normalize text without losing source spans

Create `src/text/normalizeText.ts`, `src/text/segmentCardText.ts`, and `src/text/markerRules.ts`. Keep `raw` exact and require a serialized `normalized` value using `text-normalization/1` (CRLF/CR to LF plus NFC). Freeze the serialized layout as `text.sections` plus `text.sourceSpans`: named section values are `TextSlice | null`, `unclassified` is `TextSlice[]`, `segmentation` is required, and `sourceSpans` is the complete ordered flattened list. Every `TextSlice` requires copied `text`, inclusive `start`, exclusive `end`, `kind`, and `basis: "normalized"`; offsets are UTF-16 code-unit offsets into `text.normalized` and every slice must round-trip through `normalized.slice(start, end)`. `text.spans` and `begin`/`end`-only records are invalid. Emit `normalizationVersion`, `spansBasis: "normalized"`, and `offsetEncoding: "utf-16-code-units"` in the source contract. Implement only exact Pendulum markers, frame-supported Normal Monster flavor labeling, Spell/Trap effect labeling, and a tested eligible material-line rule. Return a basis for every slice, `unclassified` remainder, and `EXACT_MARKERS`, `FRAME_RULE`, `PARTIAL`, or `UNSPLIT` status.

Do not split at periods, interpret PSCT punctuation, infer costs/targets/triggers/once-per-turn, or emit executable effect names. Ambiguous cases remain unsplit and carry `AMBIGUOUS_TEXT_SEGMENTATION` when appropriate.

**Files:** `src/text/*.ts`, `tests/source/textSegmentation.test.ts`, `tests/source/textSpanProperties.test.ts`.

### 4.2 Define and implement the translator-facing source contract

Create `src/profiles/sourceProfile.ts`, `src/application/toSourceDocument.ts`, and `schemas/ygo.card-source.v1.schema.json` (updating only the Phase 0 placeholder). `toSourceDocument(card, context)` accepts a normalized card plus raw rows, database hash, locale, registry versions, converter version, and conversion-options hash; it returns `NormalizationResult<CardSourceDocument>` with diagnostics.

The mapper MUST emit:

- `schema: "ygo.card-source/1"`;
- deterministic `sourceRevisionId` based on the canonical source-facts/lineage object `canonical-json/cdb-to-json/source-revision/v1`: exact decimal-string raw facts, verified database-bundle hash, row identity and data/text ordinals, locale/`und`, source namespace, converter major, registry versions/content hashes, text-normalization version, and semantic options/limits; output path, format, pretty-printing, diagnostics rendering, and timing are excluded;
- `identity`, `locale`, and `printed` normalized facts;
- exact `text.raw`, required `text.normalized`, `normalizationVersion`, `spansBasis`, `offsetEncoding`, the frozen `text.sections`/`text.sourceSpans` shape with required copied slice text/start/end/kind/basis, and segmentation status; `identity.databaseSha256` is forbidden and the sole source physical hash is `simulatorSource.database.sha256`;
- `simulatorSource.database`, `rawRows`, and decoded metadata;
- empty `references.scripts`/`references.rulings` by default;
- `coverage.status: "SOURCE_ONLY"`, explicit assumptions/unsupported arrays;
- converter, normalization registry, and options provenance;
- stable diagnostics.

The translator contract test must consume serialized source documents using only the schema and generic JSON/JSONL parsing. It must not import SQLite, `src/cdb`, or converter-specific adapters. A future DSL repository may pin this schema and reject unknown major identifiers; no executable semantic fields may be added in this phase. Publication stops if the downstream consumer rejects `ygo.card-source/1`; no replacement identifier may be introduced without revising this contract and regenerating the pilot together.

**Files:** `src/profiles/sourceProfile.ts`, `src/application/toSourceDocument.ts`, `src/hashing/sourceRevision.ts`, `schemas/ygo.card-source.v1.schema.json`, `tests/source/sourceProfileSchema.test.ts`, `tests/source/translatorContract.test.ts`.

### 4.3 Build the fixed 64-record pilot artifact

Use `tests/fixtures/pilot-ids.json` to select exactly 64 deterministic records spanning the fixture matrix. Add a test/application helper that writes compact JSON and JSONL pilot outputs under a temporary directory (not a bundled card database). Validate every document, assert `SOURCE_ONLY`, assert no scripts/rulings are fabricated, and assert the generic consumer sees only the frozen `text.sections`/`text.sourceSpans` shape: each span has copied text, start/end/kind/basis, no `begin`, and round-trips into normalized text.

**Files:** `tests/fixtures/pilotConsumer.ts`, `tests/source/pilotContract.test.ts`, `docs/output-profiles.md`.

### 4.4 Make streaming observable and backpressure-safe

Complete `src/serialization/jsonArrayWriter.ts`, `jsonLinesWriter.ts`, and the application destination interface so conversion consumes iterators and awaits destination backpressure. Count each encoded chunk against `limits.v1.maxOutputBytes` before writing; charge `maxStagingBytes` only for private file/directory staging, never stdout. Add a collected reference adapter used only in tests. Add high-cardinality generated SQLite fixtures with minimal rows and child-process harnesses that run with `--max-old-space-size=256`; the raw envelope path gets a dedicated harness proving `tables.datas`/`tables.texts` arrays are streamed without a complete per-database collector.

The tests must assert:

- the only public row API is `iterateRawCards(...): AsyncIterableIterator<RawCardRows>`; direct consumers can abort or call `return()` and its `finally` closes all owned resources;
- one JSONL record/newline per card and valid streamed JSON arrays; raw JSONL is separately asserted to contain one complete database envelope per line;
- CRLF/CR, combining-character, astral-Unicode, and non-ASCII sections validate against `text.normalized` using explicit UTF-16 offsets; `text.sections` and flattened `text.sourceSpans` are mutually consistent, copied slice text is required, and a generic consumer never slices raw text with normalized offsets;
- streamed and collected representations decode to identical ordered records;
- no unmerged writer path calls an all-record collector; the raw profile has an explicit negative assertion for `RawCardRows[]`/complete table-array collection;
- injected destination failure closes the DB and deletes the temporary sibling;
- `AbortSignal`/SIGINT stops at a checkpoint, closes writer then DB, removes spool and partial temp files, preserves any pre-existing final file, and returns exit 6;
- one database is processed at a time;
- a separate late-duplicate merged fixture uses the disk-backed two-pass spool/index and does not claim single-pass streaming.

**Files:** `src/serialization/*.ts`, `src/destinations/*.ts`, `src/application/limits.ts`, `tests/streaming/streamEquivalence.test.ts`, `tests/streaming/backpressureFailure.test.ts`, `tests/streaming/memoryBound.test.ts`, `tests/streaming/cancellation.test.ts`, `tests/cli/rawMemoryBound.test.ts` (the raw profile gate), `tests/fixtures/buildLargeCdb.ts`, `tests/fixtures/buildHighCardinalityRawCdb.ts`, `tests/fixtures/buildMergeCdb.ts`.

### 4.5 Prove provenance determinism and merge lineage

Implement `src/hashing/sourceRevision.ts` using `canonical-json/cdb-to-json/source-revision/v1`: sorted keys, compact UTF-8, explicit array order, finite values only, and decimal-string integers. Enumerate the exact included inputs—schema/profile, converter major, verified physical snapshot-bundle SHA-256, all contributing raw facts and canonical data/text ordinals, row identity, normalized locale/`und`, source namespace, registry versions/content hashes, `text-normalization/1`, and the shared semantic-options object including every limit and `maxSnapshotBytes`—and excluded presentation inputs—output path, format, pretty, diagnostics rendering, timing, and lock tokens—in code comments and `docs/registry-versioning.md`. `sourceRevisionId` includes canonical source facts, lineage, and physical bundle identity; `conversionOptionsHash` hashes exactly the shared semantic options. Publication is forbidden until copied WAL replay and `VACUUM INTO` materialization complete and the bundle verifies; acquisition mutation emits `SOURCE_MUTATED_DURING_READ`, materialization failure emits `CDB_OPEN_FAILED`, and unsupported WAL opening is a stable input failure rather than a live-read fallback.

Add tests that convert identical source facts with different output paths, pretty flags, and JSON/JSONL presentation and compare hashes. Toggle every included field (including each limit and registry hash) and every excluded field independently; assert only included semantic changes alter the expected hash. Change locale, registry version, source content, and row ID independently and assert the expected provenance change. Define the physical-reorder comparison as `canonicalDataProjection(record)`: remove only `cdb.card/2` `source.databaseSha256` and `ygo.card-source/1` `sourceRevisionId`/`simulatorSource.database.sha256`; `identity.databaseSha256` must not exist in the source schema or goldens. Compare the projection, then assert the full records differ only at those paths. Verify source file hashes are lowercase SHA-256 and that merged `first`/`last` output retains all contributing source references, including late ignored/replaced sources.

**Files:** `tests/source/provenanceDeterminism.test.ts`, `tests/source/mergeProvenance.test.ts`, `src/hashing/*.ts`.

## Gate and commands

```bash
npm run build
npm run test:source
npm run test:streaming
npm run test:conformance
```

The gate is complete only when:

1. both JSON and JSONL 64-record pilot outputs validate against `ygo.card-source/1` and are accepted by the generic translator-contract consumer;
2. the high-cardinality child process passes with `--max-old-space-size=256` and streamed output equals a collected reference;
3. injected write failure and cancellation leave no final/truncated/temp output and all handles are closed;
4. output path/pretty-print/format changes do not alter source revision IDs, while locale/registry/source/text-normalization changes do alter the documented hash inputs; source mutation or WAL-sidecar changes fail before publication;
5. diagnostics and raw source rows remain present for unknown/incomplete cases.

## Stop/rollback conditions

- Stop if the source schema requires a DSL semantic interpretation or if a segment cannot be mapped to a source span in `text.normalized` using the declared UTF-16 unit, if a serialized slice lacks copied text/start/end/kind/basis, if the aggregate schema bypasses the frozen item `$ref`, or if raw/normalized text metadata is missing.
- Stop if a generic consumer needs a CDB adapter; fix the source contract rather than adding one.
- Stop if memory/backpressure tests only pass by collecting records or if cleanup is unproven.
- If the DSL project rejects the assumed schema identifier, do not publish a second undocumented schema; revise the Phase 4 contract and regenerate the pilot as one change.

## Dependencies and scope

Depends on Phases 0–3. The downstream translator, grammar, LLM prompts, executable IR, rulings, and human-review workflow are outside this repository and this phase.

## Revision-4 source/streaming additions

Use exactly the shared semantic-options object in the tactical spec for both `conversionOptionsHash` and `sourceRevisionId`; include normalized locale, source namespace, text-normalization version, every registry hash, and every limit including `maxStagingBytes`. Add a toggle test for each field and a paired test proving output path, format, pretty, diagnostic rendering, timing, and lock token do not alter either expected hash.

The source-profile schema must encode the orphan contract directly: datas-only records MUST use `printed.name: null`, `printed.cardKind: "UNKNOWN"`, null typed surfaces, nullable text raw/normalized values, and simulator raw rows with `texts: null`; texts-only records retain exact text/name values while data-derived fields remain null or empty and `datas: null`. The generic translator consumer validates both documents from JSON and JSONL without a CDB adapter and asserts `SOURCE_ONLY` with no fabricated script/ruling/effect semantics.

Streaming tests must distinguish file atomicity from stdout's declared non-atomic stream. Add aggregate-array schema validation, many-input staging-budget failure, late stdout failure/cancellation, and stable-WAL baseline/mutation tests to this phase's gate. Provenance vectors must use canonical numeric IDs/ordinals: physically reordered but logically identical source tables produce equal `canonicalDataProjection(record)` values, ordinals, and merge winners but different physical bundle hashes and `sourceRevisionId` values; full records differ only in the declared physical identity fields and `conversionOptionsHash` remains unchanged. The physical hash is the SHA-256 of repository-canonical compact UTF-8 JSON for the exact `[ {"name":"main","present":true,"bytesBase64":"<copied bytes>"}, {"name":"-wal","present":<boolean>,"bytesBase64":<copied bytes or null>}, {"name":"-shm","present":<boolean>,"bytesBase64":<copied bytes or null>} ]` tuple, with absent members explicit as `present:false, bytesBase64:null`, and capture/re-verification before any SQLite open. Add `tests/reader/physicalSnapshotProvenance.test.ts` to enforce this projection/identity distinction. This is the `P5-AC5` proof for `INV-002`, `INV-007`, and `INV-009.