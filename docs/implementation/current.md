# Implementation Status

> **Dispatch status:** The fail-closed `Phase 0-1 — BLOCKED` marker remains required by the dispatcher until a later acceptance decision, but the Revision-12 remediation gate has now passed with fresh evidence in `docs/cdb-to-json-cli-refactor/evidence/p1-p2-gate.json`. Phase 2 is actively being implemented; the raw streaming and no-force secure destination slices below are verified, while force replacement, commit-set recovery, and Phase 3 card profile decoder tests remain unaccepted.

## Phase 0-1 — PASSED (dispatch marker retained for conservative ordering)
Phase 0-1 verification complete: native cleanup, schema/fixture reconciliation, held-descriptor source acquisition, materialization quota, hardened legacy publication, and P3-AC6 registry options validation.

## Phase 4 — IN PROGRESS (S-006 card profile schema validation ADDED 2026-07-14)
Phase 4 card profile normalization now has comprehensive card frame integration tests and schema validation.

### Card profile schema validation (S-006 COMPLETE 2026-07-14)

P4-AC3: Card profile records for complete and incomplete joins validate as cdb.card/2.

| Task | Status | Files |
|------|--------|-------|
| Schema validation (Ajv, cdb.card/2) | ✅ | `tests/conformance/cardProfileSchema.test.ts` |
| Major card frames (17 monster + spell/trap types) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Progression conflict vectors (LINK+XYZ, LINK+PENDULUM, triple) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Orphan states (datas-only, texts-only) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Unknown bits tracking (type, attribute, race, ot, category) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Sentinel stat values (null attack/defense) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Auxiliary string mapping (str1..str16) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Setcode decoding (single, multiple, raw value) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Availability decoding (OCGT, OCG, TCG) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Category decoding (NORMAL, EFFECT) | ✅ | `tests/normalization/cardFrames.test.ts` |
| Schema defect fix: typeLine nullable | ✅ | `schemas/cdb.card.v2.schema.json` |
| Decoder fix: TOKEN recognized as MONSTER kind | ✅ | `src/registry/cardTypes.v1.ts` |

P4-AC3 verification:
```bash
npx vitest run tests/conformance/cardProfileSchema.test.ts  # 41 tests pass
npx vitest run tests/normalization/cardFrames.test.ts       # 63 tests pass
npm run test:normalization                                  # 319 tests pass
npm run test:conformance                                    # 122 tests pass
npm test                                                    # 1018 tests pass
```

### Decoder unit tests (S-003 COMPLETE)

| Task | Status | Files |
|------|--------|-------|
| Card type decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Attribute decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Monster type decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Progression decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Stat decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Link marker decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Setcode decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Availability decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Category decoder tests | ✅ | `tests/normalization/decoders.test.ts` |
| Card profile mapping tests | ✅ | `tests/normalization/cardProfile.test.ts` |

### Progression conflict vectors (S-004 COMPLETE 2026-07-14)

| Task | Status | Files |
|------|--------|-------|
| Level boundary vectors (0-12) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| XYZ rank boundary vectors (1-12) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| LINK rating boundary vectors (1-6) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Pendulum scale boundary vectors (0-13) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Unknown bits retention | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Raw value preservation on conflict | ✅ | `tests/normalization/progressionVectors.test.ts` |
| CONFLICTING_PROGRESSION_FLAGS (INV-007) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Null-on-conflict for LINK+XYZ | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Null-on-conflict for LINK+PENDULUM | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Null-on-conflict for XYZ+PENDULUM | ✅ | `tests/normalization/progressionVectors.test.ts` |
| normalizeCard integration | ✅ | `tests/normalization/progressionVectors.test.ts` |

### INV-007 production implementation (S-005 COMPLETE 2026-07-14)

Wired CONFLICTING_PROGRESSION_FLAGS detection into production decoder.

| Task | Status | Files |
|------|--------|-------|
| `ProgressionTypeBits` constants | ✅ | `src/registry/progression.v1.ts` |
| `detectConflictingProgressionBits()` | ✅ | `src/registry/progression.v1.ts` |
| `ConflictingType` type export | ✅ | `src/registry/progression.v1.ts` |
| `conflictingTypes` in result | ✅ | `src/registry/progression.v1.ts` |
| `getProgressionType()` → 'conflicting' | ✅ | `src/registry/progression.v1.ts` |
| null-on-conflict in `decodeProgression()` | ✅ | `src/registry/progression.v1.ts` |
| CONFLICTING_PROGRESSION_FLAGS diagnostic | ✅ | `src/normalization/normalizeCard.ts` |
| Tightened integration test (strict path) | ✅ | `tests/normalization/progressionVectors.test.ts` |
| Dead helper removal | ✅ | `tests/normalization/progressionVectors.test.ts` |

Conflict detection rules:
- LINK + XYZ → conflict (primary fields null)
- LINK + PENDULUM → conflict (primary fields null)
- LINK + XYZ + PENDULUM → conflict (primary fields null)
- XYZ + PENDULUM → valid xyz_pendulum (NOT a conflict)

### Bug fix: Setcode JavaScript shift semantics (NEW 2026-07-14)

| Task | Status | Files |
|------|--------|-------|
| Fixed JavaScript shift modulo 32 behavior | ✅ | `src/registry/setcodes.v1.ts` |

## Phase 2 — IN PROGRESS (dispatch marker retained)
The authoritative dispatch marker remains conservative, but the fresh P1/P2 gate
has verified native cleanup, schema/fixture reconciliation, held-descriptor
source acquisition, materialization quota, hardened legacy publication, and
P3-AC6 registry options validation.

## Phase 2 — IN PROGRESS
The raw profile now streams fixed `datas` and `texts` arrays through a bounded
two-pass writer. Single-file and fresh split-directory outputs use descriptor-
relative named locks/temps and no-force publication. Force replacement with
backup, commit-set rollback, and recovery state are implemented. Directory
destination TS source/dist alignment is verified.

### Directory destination and exit code fixes (NEW 2026-07-14)

| Task | Status | Files |
|------|--------|-------|
| Fresh split root enforcement | ✅ | `src/destinations/directoryDestination.ts` |
| Force-with-directory rejection | ✅ | `src/destinations/directoryDestination.ts` |
| split=database requires directory validation | ✅ | `src/cli/parseArgs.ts` |
| Exit code: output errors before no-input | ✅ | `src/cli/exitCodes.ts` |
| Fresh split root CLI tests | ✅ | `tests/cli/freshSplitRoot.test.ts` |
| Exit code precedence tests | ✅ | `tests/cli/exitCodes.test.ts` |

### Exit code precedence

Precedence order: `2 > 6 > 3 > 4 > 5 > 7 > 1`

- 2 (INVALID_USAGE): Option errors, invalid combinations
- 6 (OUTPUT_ERROR): Output failures, including OUTPUT_DIRECTORY_EXISTS
- 3 (NO_INPUT): No usable CDB input found
- 4 (VALIDATION_ERROR): Input schema, strict, resource/integer failures
- 5 (COLLISION): Merge card-ID collisions
- 7 (PARTIAL_CONVERSION): Partial success with --continue-on-error
- 1 (INTERNAL_ERROR): Unexpected internal failures

### Force replacement and rollback (NEW 2026-07-14)

| Task | Status | Files |
|------|--------|-------|
| Force replace with backup | ✅ | `src/destinations/fileDestination.ts` |
| Backup restoration on abort | ✅ | `src/destinations/fileDestination.ts` |
| Recovery state preservation | ✅ | `src/destinations/fileDestination.ts` |
| Native atomicRenameReplace | ✅ | `native/secure-destination/src/secure_destination.cc` |
| Native atomicRenameWithFlags | ✅ | `native/secure-destination/src/secure_destination.cc` |
| OUTPUT_RECOVERY_REQUIRED diagnostic | ✅ | `src/diagnostics/codes.ts` |
| Commit-set rollback tests | ✅ | `tests/cli/commitSetRollback.test.ts` |
| Commit-set recovery tests | ✅ | `tests/cli/commitSetRecovery.test.ts` |
| P3-AC6 registry options tests | ✅ | `tests/cli/registryOptions.test.ts` |

### Verification report (2026-07-14 updated)

```bash
npm run build         # pass
npm run test:cli      # 372 tests pass (18 test files)
npm run package:check # pass
npm test              # 906 tests pass (51 test files)
```

### What was built

| Task | Status | Files |
|------|--------|-------|
| Command parsing (`parseArgs.ts`) | ✅ | `src/cli/parseArgs.ts` |
| Strict argument validation | ✅ | `src/cli/parseArgs.ts` |
| Output plan validation | ✅ | `src/application/outputPlan.ts` |
| Raw envelope compatibility builder | ✅ | `src/profiles/rawProfile.ts` |
| Incremental raw envelope writer | ✅ | `src/profiles/rawEnvelopeWriter.ts` |
| Canonical JSON serializer | ✅ | `src/serialization/canonicalJson.ts` |
| JSON Lines writer | ✅ | `src/serialization/jsonLinesWriter.ts` |
| JSON Array writer | ✅ | `src/serialization/jsonArrayWriter.ts` |
| Convert command handler | ✅ | `src/commands/convert.ts` |
| Inspect command handler | ✅ | `src/commands/inspect.ts` |
| Validate command handler | ✅ | `src/commands/validate.ts` |
| Schema command handler | ✅ | `src/commands/schema.ts` |
| Conversion catalog service | ✅ | `src/application/convertCatalog.ts` |
| Inspect inputs service | ✅ | `src/application/inspectInputs.ts` |
| Validate inputs service | ✅ | `src/application/validateInputs.ts` |
| CLI main entry point | ✅ | `src/cli.ts` |
| Exit code computation | ✅ | `src/cli/exitCodes.ts` |
| Help rendering | ✅ | `src/cli/renderHelp.ts` |
| Diagnostics rendering | ✅ | `src/cli/renderDiagnostics.ts` |
| Secure destination contract | ✅ | `src/destinations/secureDestination.ts` |
| Stdout destination | ✅ | `src/destinations/stdoutDestination.ts` |
| Command validation | ✅ | `src/application/commandValidation.ts` |
| Process smoke tests | ✅ | `tests/cli/processSmoke.test.ts` |
| Raw high-cardinality memory gate | ✅ | `tests/cli/rawMemoryBound.test.ts` |
| Atomic file destination (no-force) | ✅ | `src/destinations/fileDestination.ts` |
| Fresh split directory destination (no-force) | ✅ | `src/destinations/directoryDestination.ts` |
| ParseArgs tests | ✅ | `tests/cli/parseArgs.test.ts` |
| Exit codes tests | ✅ | `tests/cli/exitCodes.test.ts` |
| Limit relations tests | ✅ | `tests/cli/limitRelations.test.ts` |

### Current verification report (2026-07-14 updated)

```bash
npm run build         # pass
npm run test:cli      # 372 tests pass (18 test files)
npm run package:check # pass
npm test              # 659 tests pass (48 test files)
```

### Unaccepted Phase 2 scaffolding notes

1. **Strict CLI parsing** with `node:util.parseArgs` and duplicate detection
2. **Profile/format/split validation** before input discovery (exit 2)
3. **Pre-discovery structural preflight** for file/directory destinations
4. **Raw profile gate**: card/source profiles emit `PROFILE_NOT_AVAILABLE` (exit 2)
5. **Native capability probing** returns `UNSAFE_DESTINATION_FILESYSTEM` (exit 6)
6. **Compatibility database envelope builder** remains available for legacy API callers; the CLI uses the incremental raw writer
7. **Incremental raw JSON/JSONL serialization** with deterministic output and per-chunk output limits
8. **SIGINT handler** around conversion with proper cleanup in `finally`
9. **Stdout/stderr separation**: data to stdout, diagnostics to stderr
10. **Fresh split root requirement** for directory output (exit 6), with no-force publication implemented

## Phase 2 — Native Security Boundary Foundation (SCAFFOLDING, UNACCEPTED)

A partial native security boundary scaffold exists per the adversarial
publication amendment (B2-1 through B2-5). It is not an audited implementation:
fd tracking, descriptor-relative operations, identity guards, durable commit
recovery, and capability cleanup remain blocking work under Revision 12.

### Native Adapter Foundation

| Task | Status | Files |
|------|--------|-------|
| Handle types (opaque branding) | ✅ | `src/destinations/handles.ts` |
| Modern ABI interface | ✅ | `src/destinations/nativeAdapter.ts` |
| Capability manifest format | ✅ | `scripts/build-native.mjs` |
| Async capability probing | ✅ | `src/destinations/secureDestination.ts` |
| Filesystem probe integration | ✅ | `src/commands/convert.ts` |

### Native Adapter Interface (B2-1)

The `nativeAdapter.ts` defines the complete handle-based interface:

- **Handle types**: `ParentHandle`, `SourceHandle`, `LeaseHandle`, `TempHandle`,
  `StageHandle`, `StageChildHandle` - all opaque and non-forgeable
- **Core operations**: `acquireTrustedParent`, `probeFilesystemCapability`,
  `openSourceIdentity`, `acquireLease`, `createFileTemp`, `createDirectoryStage`,
  `createStageChild`, `verifyDirectoryStage`, `recheckSourceOutputIdentity`,
  `publishFile`, `publishDirectory`, `releaseLease`, `cleanup`

### Capability Manifest (B2-4)

The manifest now includes the required Phase 2 fields:

- `identityGuardedReplace: false` - force replacement is unsupported
- `primitiveProbeResults` - filesystem capability details
- `napiVersion` - N-API version for ABI compatibility
- `moduleSha256` - build-time module hash verification

### Authorization Enforcement (B2-R3)

The adapter enforces the identity-guarded replacement rules:

| State at preflight | Behavior |
|---|---|
| ABSENT (with/without force) | Acquire lease and publish with no-replace |
| EXPECTED_PRESENT without force | Reject as output conflict |
| EXPECTED_PRESENT with force | `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) |

### Next Steps

The following operations require native fd tracking implementation:

- `acquireLease` - requires parent fd storage
- `createFileTemp` - requires parent fd storage
- `createDirectoryStage` - requires parent fd storage
- `createStageChild` - requires stage fd storage
- `writeStageChild` / `flushStageChild` / `closeStageChild` - require child fd storage
- `verifyDirectoryStage` - requires stage fd storage
- `recheckSourceOutputIdentity` - requires source/parent fd storage
- `publishFile` / `publishDirectory` - require lease fd storage
- `releaseLease` / `cleanup` - require fd storage

## Phase 3 — Writer-Neutral Serialization and Budget (SCAFFOLDING, UNACCEPTED)

A partial writer/budget scaffold exists, but it is not phase-accepted. In
particular, it does not prove the real SQLite materialization quota or the
identity-guarded durable commit-set recovery required by Revision 12.

### What was built

| Task | Status | Files |
|------|--------|-------|
| OutputWriter interface | ✅ | `src/serialization/outputWriter.ts` |
| TestOutputSink (in-memory) | ✅ | `src/serialization/outputWriter.ts` |
| CallbackOutputWriter adapter | ✅ | `src/serialization/outputWriter.ts` |
| StdoutOutputWriter (non-atomic) | ✅ | `src/serialization/outputWriter.ts` |
| StagingBudget reserve/reconcile fix | ✅ | `src/application/stagingBudget.ts` |
| Serialization tests | ✅ | `tests/cli/serialization.test.ts` |
| Staging reservation tests | ✅ | `tests/cli/stagingReservations.test.ts` |
| Conversion lifecycle tests | ✅ | `tests/cli/conversionLifecycle.test.ts` |

### Writer lifecycles

| State | Description |
|-------|-------------|
| OPEN -> CLOSED | Normal lifecycle, committed=true after close |
| OPEN -> ABORTED | Failure path, committed=false |
| CLOSED -> (terminal) | No further writes, committed is final |
| ABORTED -> (terminal) | No further writes, close rejected |

### Budget ownership

- **Snapshot/materialization/private-staging bytes**: charged to aggregate
  `maxStagingBytes` budget via `StagingBudget.reserve()`
- **Encoded output chunks**: file/directory writers reserve against aggregate
  budget; stdout does NOT charge encoded chunks to private staging
- **Reserve → reconcile → release**: reserve before write, reconcile actual
  growth, release exactly once. Reconcile uses the original reservation as
  baseline for the first call, then previous reconciled amount for subsequent.
- **Release frees actual bytes**: reconciles before release ensures the correct
  amount is freed based on actual file size growth.

### Historical writer report (non-acceptance evidence)

The prior standalone writer count is retained only as a historical report. It
cannot satisfy P1/P2 or P3 acceptance while the machine contract remains blocked.

### Remaining phases (deferred)

- Phase 3: Card profile conformance tests, merge handling, versioned registry pinning
- Phase 4: Text segmentation, source profile, translator contract, provenance hashing
- Phase 5: Hardening, migration docs, CI configuration, benchmark

## Verification Summary (2026-07-14)

All 906 tests pass across 51 test files:
- 247 normalization tests (decoder, card profile, progression vectors)
- 372 CLI tests
- 287 other tests (reader, conformance, compatibility, etc.)

Build and package verification: all gates pass.
