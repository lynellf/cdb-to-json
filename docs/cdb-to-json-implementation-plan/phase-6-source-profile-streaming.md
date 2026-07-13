# Phase 6 — conservative source documents, provenance hashes, and streaming

**Depends on:** Phase 5 card profile and merge lineage.

## Task 6.1 — Text normalization and conservative segmentation

**Files:** create `src/text/normalizeText.ts`, `src/text/markerRules.ts`; replace
`src/text/segmentCardText.ts`; create
`tests/source/textSegmentation.test.ts`, `tests/source/textSpanProperties.test.ts`.

Preserve `text.raw` exactly and derive `text.normalized` using
`text-normalization/1` (CRLF/CR to LF plus NFC). Every slice uses inclusive /
exclusive UTF-16 code-unit offsets into normalized text, declares its basis, and
round-trips through `normalized.slice(start,end)`. Implement only exact Pendulum
and Monster Effect markers, frame-supported Normal Monster flavor labeling,
Spell/Trap effect labeling, and a tested eligible material-line rule. Keep
unclassified remainder and explicit `EXACT_MARKERS`, `FRAME_RULE`, `PARTIAL`, or
`UNSPLIT` status.

Do not split at punctuation/periods or infer costs, targets, triggers,
once-per-turn, rulings, or executable DSL names. Ambiguous text remains unsplit
with `AMBIGUOUS_TEXT_SEGMENTATION` where appropriate.

**Verification:** test CRLF/CR/LF, combining marks, astral Unicode, marker
ambiguity, exact spans, and forbidden semantic inferences.

## Task 6.2 — Source profile and translator contract

**Files:** create/replace `src/profiles/sourceProfile.ts`,
`src/application/toSourceDocument.ts`, `src/hashing/sourceRevision.ts`;
change `schemas/ygo.card-source.v1.schema.json`; create
`tests/source/sourceProfileSchema.test.ts`,
`tests/source/translatorContract.test.ts`.

Map normalized card/raw rows/context to `ygo.card-source/1`: source revision ID,
identity/locale/printed facts, exact raw+normalized text and spans,
`simulatorSource` with absent partners explicit, empty scripts/rulings,
`SOURCE_ONLY` coverage, assumptions/unsupported, registry/converter/options
provenance, and diagnostics. A datas-only or texts-only record remains
schema-valid and never fabricates card kind, typed fields, or semantics. A
translator-contract test must parse only generic JSON/schema data and must not
import SQLite or converter adapters.

`sourceRevisionId` hashes canonical source facts, physical bundle hash, raw row
identity/data/text ordinals, locale/source namespace, effective registry
versions and content hashes (including the named `setcodeRegistryHash` and
`availabilityRegistryHash`), text-normalization version, converter major, and
shared semantic limits. The loader supplies these hashes only from verified
pinned bytes; an override path itself is not provenance. `conversionOptionsHash`
hashes exactly the semantic options, including the effective registry hashes,
and excludes registry paths. Exclude output path, format, pretty, diagnostic
rendering, timing, and lock tokens.

**Verification:** toggle every included/excluded hash field independently,
including each effective registry content hash and its override path, compare
physical-reorder behavior, and validate all source documents. Add
`tests/source/sourceRevision.test.ts` alongside
`tests/source/translatorContract.test.ts` for the independent inclusion and
exclusion vectors. Run `npm run test:source` and `npm run test:conformance`.

**Stop:** downstream consumers require a bespoke CDB adapter, spans use raw
rather than normalized offsets, or the source profile emits executable meaning.
Do not invent a replacement schema identifier.

## Task 6.3 — Late final-record names for source split output

**Depends on:** Task 6.2, Phase 5 Task 5.5, and the Phase 3
directory-destination API.

**Files:** change `src/application/finalRecordNamePlan.ts`,
`src/application/convertCatalog.ts`, and `src/destinations/directoryDestination.ts`;
extend `tests/cli/finalRecordOutputPlan.test.ts`,
`tests/source/sourceProfileSchema.test.ts`,
`tests/cli/conversionLifecycle.test.ts`, and
`tests/cli/processSmoke.test.ts`.

Invoke the shared late allocator only after source-profile mapping has produced
the bounded, repeatable final cursor and after merge conflict selection is
complete. The source path must carry the canonical signed-int64 ID from
`identity` unchanged; it must not derive a filename from the printed name,
source revision, or normalized text. Perform the same exact two-pass `N`/`j`
padding and leaf/collision checks as Phase 5 Task 5.5, charge the manifest to
the aggregate spool/staging budget, and pass only the immutable validated
manifest to the directory destination. No source split-card child writer or
stage child may be opened before this pass; late duplicate, source-profile
mapping, cancellation, or name failure cleans the private cursor/manifest/
stage and leaves the fresh root absent.

**Verification:** replay the exact `-2`, `2`, `10`, extrema, zero/one/many,
`N=10`, unsafe-leaf, collision, and late-duplicate vectors with
`ygo.card-source/1` records. Assert that source revision/hash changes do not
change the canonical ID/name input, that SQLite reader resources are closed
while the SourceHandle remains retained through final-name allocation and the
commit barrier, and that no partial root is published. Run the source and
lifecycle gates in Task 6.4.

## Task 6.4 — Streaming destinations and pilot artifact

**Files:** complete `src/serialization/*.ts`,
`src/destinations/*.ts`, `src/application/convertCatalog.ts`; create
`tests/fixtures/pilotConsumer.ts`, `tests/source/pilotContract.test.ts`,
`tests/streaming/streamEquivalence.test.ts`,
`tests/streaming/backpressureFailure.test.ts`,
`tests/streaming/memoryBound.test.ts`,
`tests/streaming/cancellation.test.ts`, and generated fixture helpers.

Process one database at a time through async iterators and await destination
backpressure. Use a deterministic 64-record pilot spanning fixture frames;
write compact JSON and JSONL only to temporary test locations, validate against
the source schema, and assert `SOURCE_ONLY`, no scripts/rulings, and valid
normalized spans. Compare streamed output to a collected reference without
using collection in production. Exercise high-cardinality conversion under
`--max-old-space-size=256`, injected writer failure, late stdout failure,
AbortSignal/SIGINT, and pre-existing-final preservation.

**Verification:**

```bash
npm run build
npm run test:source
npm run test:streaming
npx vitest run tests/cli/finalRecordOutputPlan.test.ts tests/cli/conversionLifecycle.test.ts
npm run test:conformance
```

**Rollback:** retain the approved card/raw contracts if source/streaming fails;
remove only source mapper and streaming wiring. Do not weaken cancellation,
backpressure, or atomicity to make a memory test pass.
