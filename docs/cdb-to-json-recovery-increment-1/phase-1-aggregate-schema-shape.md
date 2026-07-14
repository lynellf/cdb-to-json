# Phase P1 — aggregate schema shape

**Contract:** `docs/cdb-to-json-recovery-increment-1/execution-contract.json`

**Phase ID:** `P1`

## Behavioral goal

Make the checked-in aggregate schemas match the accepted array contract without
entering the runtime conversion, reader, serializer, or native boundaries:

- `cdb.card-array/2` is `type: "array"` with `items: {"$ref": "cdb.card/2"}`.
- `ygo.card-source-array/1` is `type: "array"` with `items: {"$ref": "ygo.card-source/1"}`.
- Neither aggregate schema is an object wrapper containing `schema`, `cards`, or
  `documents`.

The binding criteria are `P1-AC1` through `P1-AC5`; this document adds no
requirements beyond the JSON contract.

## Repository grounding

The accepted Phase 5 command/schema brief explicitly requires aggregate schemas
to be top-level arrays, distinct from item schemas. The current diff already
contains the four-path candidate slice:

```text
schemas/cdb.card-array.v2.schema.json
tests/conformance/schemaValidation.test.ts
schemas/ygo.card-source-array.v1.schema.json
tests/conformance/schemaSelection.test.ts
```

The static focused run on the current tree passed 2 files and 36 tests. The
current `package:check` also lists both aggregate schemas as package artifacts.
No SQLite database is needed to inspect these artifacts.

## Implementation and review sequence

1. Inspect only the four P1 paths and compare their diff with the accepted Phase
   5 aggregate-array wording.
2. Confirm that each aggregate schema preserves its existing `$id`, title, and
   description while replacing only the wrapper shape.
3. Confirm that `schemaValidation.test.ts` checks both top-level type and exact
   item reference, and that `schemaSelection.test.ts` covers selector presence,
   wrapper absence, parseability, deterministic checked-in references, and no
   SQLite dependency.
4. Run the focused conformance command:

   ```bash
   npx vitest run tests/conformance/schemaSelection.test.ts tests/conformance/schemaValidation.test.ts
   ```

5. Run the build/package boundary:

   ```bash
   npm run build && npm run package:check
   ```

6. Review the complete `git status --short` but prepare a proposed commit from
   only the four P1 paths. Leave every other changed or untracked path in place
   and uncommitted.

## Explicit mixed-tree boundary

The following files are not P1 evidence and must not be included in its commit:

- Phase 3 candidates: `src/application/stagingBudget.ts`,
  `src/serialization/index.ts`, `src/serialization/outputWriter.ts`,
  `tests/cli/serialization.test.ts`, `tests/cli/stagingReservations.test.ts`,
  `tests/cli/conversionLifecycle.test.ts`;
- Phase 4 candidates: `scripts/build-native.mjs`,
  `src/destinations/handles.ts`, `src/destinations/nativeAdapter.ts`,
  `src/destinations/secureDestination.ts`, `src/commands/convert.ts`,
  `tests/cli/processSmoke.test.ts`;
- Phase 5 candidates: `src/application/inspectInputs.ts`,
  `src/application/validateInputs.ts`, `src/commands/validate.ts`,
  `tests/cli/inspectValidateSchema.test.ts`, `tests/fixtures/tempDir.ts`;
- status prose: `docs/implementation/current.md`.

Those changes are not accepted merely because the full test suite is green. In
particular, the current native adapter TypeScript surface still exposes raw fd
parameters in its low-level interface, `inspectInputs` performs a second
snapshot/open path instead of one transferred session, `validateInputs` is not
source-handle-bound, and the new writer helpers are not yet integrated with the
real output transaction. Each needs a separate contract and review.

## Rollback and safety

If a schema consumer or validator proves that a wrapper is required, stop and
raise a contract revision; do not change the schema identifier or add an
undocumented compatibility wrapper. Reverting P1 touches only the two aggregate
JSON files and their two static conformance files. It does not touch databases,
output destinations, native artifacts, or deferred working-tree changes.

## Completion evidence

A reviewer may approve P1 only when all blocking criteria in the execution
contract pass, including exact four-path isolation, the 36-test focused run, and
the build/package gate. Approval means only that the aggregate schema artifact
slice is complete; it does not approve any other phase or the overall refactor.
