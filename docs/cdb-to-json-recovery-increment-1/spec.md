# Recovery increment 1 — aggregate schema shape

## Status and lineage

**Request class:** remediation of an accepted planned implementation.

This package is a recovery slice, not a replacement for the accepted Phase 2
publication plan. The current working tree contains uncommitted edits from
multiple logical phases. This package deliberately makes only the smallest
independent slice reviewable first: correcting the two aggregate JSON Schema
artifacts to the accepted top-level-array contract and locking that shape with
conformance tests.

Controlling sources:

- `docs/cdb-to-json-cli-refactor-spec.md`
- `docs/cdb-to-json-cli-refactor/senior-remediation-spec.md`
- `docs/cdb-to-json-cli-refactor-phase-2-remediation/spec.md`
- `docs/cdb-to-json-cli-refactor-phase-2-publication/spec.md`
- `docs/cdb-to-json-cli-refactor-phase-2-publication/phase-5-command-services-schemas.md`
- `docs/cdb-to-json-implementation-plan/spec.md`
- `docs/cdb-to-json-recovery-increment-1/execution-contract.json`

## Goal and current request

**Goal anchor:** The execution contract preserves the complete run-memory goal
verbatim, including the actual repository-state inventory, recovery objectives,
correctness constraints, routing, and verification commands. Its opening is:

> Resume orchestration for /home/lynellf/src/cdb-to-json on branch publish.
> The previous run stalled during handoff. Reconstruct state from the
> repository, not prior worker claims.

**Current request (verbatim):**

> Need an evidence-based re-inventory of the mixed uncommitted working tree and
> a revised execution contract that defines the smallest coherent first
> increment. The implementer work that preceded this visit produced an
> uncommitted diff spanning Phases 3/4/5 simultaneously, and the prior plan must
> be reconciled with reality before any further implementation or review.

## Verified repository state

`HEAD` and `origin/publish` remain at `6cfb9bc`. The working tree is not clean.
The complete changed-file inventory is recorded below; no claim that the mixed
working tree is one completed phase is accepted.

| Classification | Files in the current diff | Decision for increment 1 |
|---|---|---|
| Aggregate-schema slice | `schemas/cdb.card-array.v2.schema.json`, `schemas/ygo.card-source-array.v1.schema.json`, `tests/conformance/schemaValidation.test.ts`, `tests/conformance/schemaSelection.test.ts` | **In scope.** These four files form one independently reviewable behavior. |
| Phase 3 writer/budget candidates | `src/application/stagingBudget.ts`, `src/serialization/index.ts`, `src/serialization/outputWriter.ts`, `tests/cli/serialization.test.ts`, `tests/cli/stagingReservations.test.ts`, `tests/cli/conversionLifecycle.test.ts` | Deferred; do not include in the first commit. |
| Phase 4 native/publication candidates | `scripts/build-native.mjs`, `src/destinations/handles.ts`, `src/destinations/nativeAdapter.ts`, `src/destinations/secureDestination.ts`, `src/commands/convert.ts`, `tests/cli/processSmoke.test.ts` | Deferred; the ABI remains unimplemented and must not be called complete. |
| Phase 5 command candidates | `src/application/inspectInputs.ts`, `src/application/validateInputs.ts`, `src/commands/validate.ts`, `tests/cli/inspectValidateSchema.test.ts`, `tests/fixtures/tempDir.ts` | Deferred; inspect/validate still require reader-session reconciliation. |
| Status prose | `docs/implementation/current.md` | Deferred; it contains completion claims that are not evidence and must not be committed with this slice. |

The inventory includes both tracked modifications and untracked files. The
first increment is path-isolatable from the mixed tree; the implementer/reviewer
must inspect and commit only the four in-scope paths.

## Measured verification telemetry

The commands were run against the actual working tree, not inherited claims:

- `npm run build`: passed; Node `v26.5.0` produced the expected unsupported native
  manifest branch.
- `npx vitest run tests/conformance/schemaSelection.test.ts tests/conformance/schemaValidation.test.ts`:
  2 files, 36 tests passed.
- `npm run test:cli`: 8 files, 218 tests passed.
- `npm run test:reader`: 8 files, 62 tests passed.
- `npm run test:compat`: 3 files, 22 tests passed.
- `npm run package:check`: passed on the unsupported-native branch.
- `npm test -- --reporter=dot`: 29 files, 408 tests passed.

The full-suite count is 408, not the prior unverified claim of 390 or the stale
status-document claim of 245. Passing tests do not make the deferred native,
writer integration, inspect, or validation work complete.

## Behavior for this slice

The aggregate selectors are checked-in JSON Schemas, not runtime envelopes:

- `cdb.card-array/2` is a top-level JSON array whose `items` reference
  `cdb.card/2`.
- `ygo.card-source-array/1` is a top-level JSON array whose `items` reference
  `ygo.card-source/1`.
- Neither schema wraps records in an object with `schema`, `cards`, or
  `documents` properties.
- Item schema identifiers and all item-schema fields remain unchanged.
- Schema selection remains a checked-in-artifact operation and does not open
  SQLite. Runtime file-output wiring is not part of this slice.

## Constraints and non-goals

- Do not commit any changed path outside the four in-scope paths.
- Do not claim Phase 3 serialization, Phase 4 secure publication, or Phase 5
  inspect/validate completion based on the mixed tree.
- Do not alter `cdb.card/2`, `ygo.card-source/1`, `cdb.raw/1`, or product profile
  decisions.
- Do not implement card/source conversion, native file/directory publication,
  path fallbacks, reader lifecycle changes, or output-writer integration here.
- Do not update `docs/implementation/current.md` in this slice; its status prose
  requires a later evidence-based reconciliation after accepted increments.
- Preserve stdout data-only/stderr diagnostics, secure-publication constraints,
  and the accepted schema identifiers.

## Decisions and assumptions

1. The schema correction is the smallest coherent first increment because it is
   a closed artifact contract with no dependency on the incomplete native
   adapter or conversion lifecycle.
2. The changed schema files are accepted as the product contract only when the
   focused conformance tests assert both top-level shape and item references.
3. The existing aggregate `$id`, title, and description are retained; changing
   identifiers would be a product/schema-version decision and is out of scope.
4. The remaining uncommitted edits are preserved in the working tree for later
   bounded increments. They are not silently discarded or bundled into the
   first commit.

## Risks and stop conditions

- **Risk:** a reviewer treats green unit tests as proof that the mixed Phase 3–5
  implementation is complete. **Stop:** review and commit only the exact four
  in-scope paths; reject any broader commit.
- **Risk:** a future schema command still emits an old wrapper or ignores file
  output. **Stop:** defer that behavior to the command-services increment; this
  slice only governs the checked-in schema artifacts.
- **Risk:** `$ref` resolution or downstream consumers require a different
  aggregate shape. **Stop:** raise a contract revision rather than silently
  adding a wrapper or changing the schema identifier.

## System boundary

This increment crosses only checked-in JSON Schema artifacts and their static
conformance tests. It does not cross the reader, application, destination,
native, or CLI output boundaries. The next implementation increment must be
planned separately against the verified reader/session and native ABI state.
