# Phase 5 — inspect, validate, schema, and package wiring

## Goal and dependency

Complete the non-conversion commands and schema/package contracts using the
reader session and secure destination boundary. This phase depends on Phases 1–4
and must not implement card/source conversion.

## Files and bounded discovery

Change:

- `src/application/inspectInputs.ts`
- `src/application/validateInputs.ts` (create)
- `src/commands/inspect.ts`
- `src/commands/validate.ts`
- `src/commands/schema.ts`
- `src/cli.ts`
- `src/cli/parseArgs.ts` only for command-specific options
- `schemas/cdb.raw.v1.schema.json`
- `schemas/cdb.card.v2.schema.json`
- `schemas/ygo.card-source.v1.schema.json`
- `schemas/cdb.card-array.v2.schema.json`
- `schemas/ygo.card-source-array.v1.schema.json`
- `scripts/package-check.mjs`
- `package.json` exports only if checked-in schema exposure is part of the package
  contract

Create or extend:

- `tests/cli/inspectValidateSchema.test.ts`
- `tests/conformance/schemaSelection.test.ts`

Inspect only command handlers, reader/session metadata, checked-in schemas, and
package-check expectations. Schema selection must remain independent of SQLite.

## Implementation tasks

### 5.1 Inspect through the verified session

`inspectInputs` must discover deterministically and use the same snapshot,
materialization, encoding, and metadata lifecycle as conversion, not hash/open the
original path directly. Report deterministic machine-readable data containing:

- display-safe source identity, original main-file size, and verified physical
  bundle hash;
- required table/column metadata and metadata-only extra tables/counts;
- datas/texts counts, duplicate and orphan summaries; and
- stable input/decoding/resource warnings.

Close every inspect session and release staging in `finally`; these commands have
no publication barrier, so they may close their SourceHandle with the session.
For conversion, the shared session transfers SourceHandle ownership to the
conversion transaction and must retain it, plus destination ParentHandle and
LeaseHandle, through the final identity recheck and commit barrier as specified
in Phase 3. Do not emit converted raw rows or write an output destination.

### 5.2 Validate without conversion output

Create an application `validateInputs` service that runs discovery, required
schema and storage-class checks, signed-int64 ID checks, duplicate/orphan checks,
text byte/fatal UTF-8 preflight, row/resource checks, and strict warning
promotion. It must preserve the frozen mappings: non-UTF-8 is
`UNSUPPORTED_DATABASE_ENCODING`, wrong supported-text storage class is
`INVALID_TEXT_VALUE`, and invalid bytes are `INVALID_TEXT_ENCODING`; the first
two are classified as input failures (exit 4) and are not replaced with a
generic path error. It must consume or explicitly complete the reader preflight
so invalid input cannot report `valid: true`, but it must never create a
conversion writer or final destination. Return deterministic report data and
stable diagnostics; classify no usable input as exit 3 and input/schema/resource/
strict failures as exit 4.

### 5.3 Implement schema selection and safe output

- `schema` accepts `raw`, `card`, `card-array`, `source`, and `source-array`.
- Item selectors print checked-in item schemas. Array selectors print schemas
  whose top-level type is `array` and whose `items` refer to the item schema;
  they must not wrap records in `cards` or `documents` properties.
- `schema` reads packaged JSON only and never opens SQLite. `--output -` uses
  stdout; a file output uses the same secure atomic destination and unsupported
  hosts return the documented exit 6 rather than writing insecurely.
- Reject invalid selectors and output combinations with exit 2 before any source
  access. Keep schema object property order and bytes deterministic.

### 5.4 Reconcile schemas and package checks

Update raw schema requirements for `integerEncoding`, fixed supported columns,
nullable SQLite values, signed decimal strings, and metadata-only `extraTables`.
Keep card/source item schemas distinct from aggregate arrays. Ensure package-check
requires every item/aggregate schema and verifies native manifest/module hash
truthfulness on supported and unsupported hosts.

## Tests and acceptance criteria

Assert that:

- inspect output has verified physical provenance, metadata, counts, warnings, and
  no profile records;
- validate catches missing tables, wrong storage classes, invalid IDs/UTF-8,
  duplicate IDs, resource limits, and strict orphan warnings without creating
  converted output;
- all five schema selectors are deterministic and schema selection causes zero
  SQLite calls;
- aggregate schema top-level type is `array` and item references match the
  corresponding item schema; and
- schema file output follows secure destination behavior, including the current
  unsupported-host branch.

Run:

```bash
npm run build
npm run test:reader
npm run test:cli -- --run tests/cli/inspectValidateSchema.test.ts
npm run test:conformance -- --run tests/conformance/schemaSelection.test.ts
npm run package:check
```

**Stop condition:** inspect/validate emits profile records, schema opens SQLite,
validation trusts a live hash, aggregate schema is a wrapper, or file output
bypasses the secure destination boundary.

## Rollback

Revert command-service and schema wiring while retaining the session, writer, and
destination boundaries. Verify raw stdout, reader, compatibility, and package
checks; do not remove required checked-in schemas used by later phases.
