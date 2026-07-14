# Phase P4 — Card profile and versioned normalization (delivery Phase 3)

## Outcome

Add `cdb.card/2` as a typed, consumer-facing profile. Every decoder is isolated, registry-backed, lossless with respect to raw integers, and covered by generated fixtures and golden vectors before it is used by the mapper.

## Ordered tasks

### 3.1 Pin authoritative, versioned registries

Before implementing decoders, record an authoritative field-layout/registry source and immutable version (URL plus commit/tag/checksum) in the required `docs/registry-versioning.md` artifact. The file must exist before any registry is enabled. The source must independently specify card types, attributes, monster types, link markers, availability, simulator categories, packed level/scales, and setcode interpretation. No external registry source was supplied to planning; Phase 3 stops at this task if a maintainer cannot provide a citable revision. Generated fixtures may exercise the source, but must not be the authority. The CLI-selected `--setcode-registry` and `--availability-registry` identities must be resolved to these immutable metadata records and carried into provenance hashes; they may not silently substitute another registry.

Create registry modules under `src/registry/` for card types, attributes, monster types, link markers, availability, and simulator categories. Each registry exports a version/hash, source citation, and known-mask metadata. Unknown bits are formatted as stable hexadecimal strings and are never converted to zero or omitted. Hand-authored expected vectors must be independent of decoder code and include full-CDB spot checks for every major frame plus known-bit re-encoding and unknown-bit retention. The registry package must also publish the conflict policy: no primary-kind/subtype/progression precedence, `UNKNOWN`/`null` on ambiguity, complete ordered decoded arrays, raw masks, and stable conflict diagnostics.

**Files:** `src/registry/cardTypes.v1.ts`, `src/registry/attributes.v1.ts`, `src/registry/monsterTypes.v1.ts`, `src/registry/linkMarkers.v1.ts`, `src/registry/availability.v1.ts`, `src/registry/categories.v1.ts`, `tests/normalization/registries.test.ts`, `tests/normalization/registryOptionPropagation.test.ts`, `docs/registry-versioning.md`.

### 3.2 Implement pure packed-field/stat decoders

Create `decodeType.ts`, `decodeProgression.ts`, `decodeStats.ts`, `decodeSetcodes.ts`, `decodeAvailability.ts`, `decodeCategory.ts`, and the alias/auxiliary-string mapping helpers. Return typed values plus raw values and diagnostics. Cover:

- card kind, monster traits, and spell/trap subtype conflicts; exactly one supported primary family yields the kind, none yields `UNKNOWN`, and multiple yields `UNKNOWN` plus `CONFLICTING_CARD_KIND_FLAGS`; exactly one compatible subtype yields the subtype, otherwise `null` plus `CONFLICTING_SUBTYPE_FLAGS`. Emit the fixed `typeLine.monsterType`/`monsterTypes`, `monster.attribute`/`attributes`, and spell/trap `subtype`/`subtypes` nullable/array shape from `spec.md`;
- attribute and monster-type known/unknown multi-bit masks; arrays retain all known labels while singleton primary fields are `null` unless exactly one value exists, and every typed surface retains decimal raw value plus unknown bits;
- level/rank/link rating and Pendulum scales through `DecodedProgression` without consumer bit shifts; progression primary fields are null-on-conflict and emit `CONFLICTING_PROGRESSION_FLAGS`; Pendulum scales are independent only when both values validate; `monster.progression` always retains the raw packed value and unknown bits;
- Link arrows in `def` and no invented Link defense;
- attack/defense sentinels as friendly `null` while retaining raw integers;
- ordered, zero-terminated 16-bit setcodes with malformed packing diagnostics;
- alias `0` as null;
- neutral `availability` rather than legality;
- category flags outside printed/DSL semantics;
- `str1..str16` with index and null/empty preservation.

Property/golden tests must cover known-bit re-encoding, unknown-bit retention, packed level vectors, setcode order/termination, sentinel values, and conflicting flags.

**Files:** `src/normalization/decode*.ts`, `src/normalization/normalizeCard.ts`, `tests/normalization/decoders.test.ts`, `tests/normalization/progressionVectors.test.ts`, `tests/normalization/setcode.test.ts`.

### 3.3 Implement the card profile mapper

Create `src/profiles/cardProfile.ts` and the application conversion path that maps `RawCardRows` + context into `cdb.card/2`. Use strings for external IDs, typed card kind/traits, nullable conflict-safe primary fields, complete decoded arrays/raw masks, raw data only when `--include-raw`, source hashes and row IDs, and stable diagnostics. Keep unresolved setcodes in `archetypes.unresolved`; resolve only through a supplied content-hashed registry. Add independent schema/golden vectors for no flags, singleton flags, multi-bit monster types/attributes, conflicting kind/subtype/progression, and unknown bits; no implementation-defined precedence is permitted. Ensure `cardKind: UNKNOWN` does not expose a guessed typed convenience surface, while `simulator` retains complete source decodes.

**Files:** `src/profiles/cardProfile.ts`, `src/application/convertCatalog.ts`, `tests/conformance/cardProfileSchema.test.ts`, `tests/normalization/cardFrames.test.ts`.

### 3.4 Implement bounded merge conflict lineage

Create `src/application/mergeRecords.ts` and the disk-backed spool/index described in the tactical spec. Require `--merge` for cross-input combination; default to `error`; implement `first` and `last` by deterministic input order. Pass 1 writes length-delimited canonical records and an on-disk index keyed by canonical card ID; pass 2 scans IDs in final order, reads the selected winner, and appends every contributing source reference plus ignored/replaced diagnostics. `error` fails on a late collision before final rename. Enforce `limits.v1.maxSpoolBytes` as one aggregate reservation across spool, sorted index, lineage metadata, and temporary siblings, honor backpressure on final output, and delete spool/index/temp/reservation files on failure or cancellation. Do not claim single-pass/full streaming for merged output.

Add a high-cardinality late-duplicate fixture where the duplicate appears after output-sized input has been processed. Test `error`, `first`, and `last` for retained values, final ordering, complete lineage, bounded heap, and cleanup; test both a final writer failure and AbortSignal. Never silently replace records.

**Files:** `src/application/mergeRecords.ts`, `src/application/mergeSpool.ts`, `src/application/mergeIndex.ts`, `tests/normalization/mergeConflicts.test.ts`, `tests/normalization/mergeLateDuplicate.test.ts`, `tests/cli/mergeConflicts.test.ts`.

## Gate and commands

```bash
npm run build
npm run test:normalization
npm run test:conformance
npm run test:cli
```

The gate fixture matrix must include at least one record for Normal, Effect, Ritual, Fusion, Synchro, Xyz, Pendulum, Link, Token/Skill/special, all supported Spell/Trap subtypes, unknown flags, sentinels, malformed setcodes, and incomplete joins. Every normalized output validates against `schemas/cdb.card.v2.schema.json`; primary fields contain no unexplained source bitmasks, while diagnostics/raw fields retain the source facts. Conflict cases must validate the explicit null/`UNKNOWN` primary policy, complete known-value arrays, raw masks, and stable diagnostics; they must not rely on flag precedence.

Run a deterministic two-database merge fixture for `error`, `first`, and `last`, and compare both retained record values and source lineage. Run the same conversion twice with different output destinations and assert record ordering and canonical record bytes are unchanged.

## Stop/rollback conditions

- Stop on any decoder that guesses an unknown bit or treats `ot`/`category` as printed semantics.
- Stop if a packed level/scales/link vector cannot be explained by a named registry version; preserve it as raw and add a diagnostic instead.
- Stop if schemas require a field not derivable from source facts or a declared registry.
- If a registry mapping is later found wrong, bump its version and regenerate only affected golden outputs; do not rewrite historical raw fixtures.

## Dependencies and scope

Depends on Phases 0–2. Text segmentation and YGO-DSL source documents are deliberately deferred to Phase 4.

## Revision-4 normalization constraints

The mapper must consume the reader's canonical numeric-ID order and zero-based data/text ordinals; it must not sort IDs as strings or use JavaScript numeric coercion. Add card-profile conformance cases for datas-only and texts-only rows: keep the present external ID/raw row, emit `cardKind: "UNKNOWN"`, `traits: []`, null typed surfaces, and the required nullable text object, retain exact present name/text values, emit the missing-partner diagnostic, and never invent stats, type, or effect text. `simulator.rawRows`/optional card raw embedding must preserve the supported raw values and absent partner explicitly. Merge tests must prove that physical insertion reorder cannot change `first`/`last` selection or lineage. Aggregate array schemas are serialization concerns and must not be satisfied by weakening the item profile schema.

## Revision-5 provenance/order additions

- `src/application/readCdb.ts` and `src/application/mergeRecords.ts` must consume the reader's canonical signed-int64 order and ordinals without re-sorting or coercing IDs. Define and export the test-only `canonicalDataProjection(record)` that removes only physical identity fields (`source.databaseSha256` for `cdb.card/2`; `sourceRevisionId` and `simulatorSource.database.sha256` for `ygo.card-source/1`; `identity.databaseSha256` is forbidden) while retaining IDs, raw facts, ordinals, normalized values, diagnostics, semantic provenance, and lineage. Add `tests/normalization/physicalOrderMerge.test.ts` with two databases whose rows are physically inserted in different orders: the projections, data/text ordinals, collision winners, and lineage order remain equal, while the full records differ only in the declared physical identity fields.
- The physical bundle hash is not a logical-content hash. `src/hashing/sourceRevision.ts` receives the verified ordered `main`/`-wal`/`-shm` member tuple and therefore produces different `sourceRevisionId` values for the physically reordered fixtures even though `canonicalDataProjection(record)` and `conversionOptionsHash` remain equal. Add the source-revision assertion to `tests/reader/physicalSnapshotProvenance.test.ts`; assert the full serialized records differ only at the projection's physical identity paths rather than making normalization invent a second revision identifier.
- Orphan card records must remain schema-valid under the conflict-safe shape and preserve decimal raw IDs, partner-null raw rows, and missing-partner diagnostics through merge and `--include-raw`; no mapper may fill a missing field with a placeholder.