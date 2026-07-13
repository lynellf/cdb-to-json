# Phase 4 — inspect, validate, schema, packaging wiring, and process gate

**Depends on:** Phases 1–3.

## Task 4.1 — Verified inspect service

**Files:** `src/application/inspectInputs.ts`, `src/commands/inspect.ts`,
`src/cdb/readDatabase.ts`; create `tests/cli/inspectValidateSchema.test.ts`.

Discover deterministically, then use the same source-handle/snapshot/WAL/
materialization/session lifecycle as conversion. Report display-safe source
identity, original size, verified physical bundle hash, required/fixed columns,
metadata-only extra tables/counts, datas/texts counts, duplicate/orphan
summaries, and stable warnings. Close session and source handles in `finally`;
inspect has no publication barrier and must not emit converted profile records.
Diagnostics/rendering are machine-readable on stdout only for the report, stderr
for failure/progress.

## Task 4.2 — Real validation service

**Files:** create `src/application/validateInputs.ts`; change
`src/commands/validate.ts`, `src/cli.ts`; extend reader diagnostics and
`tests/cli/inspectValidateSchema.test.ts`.

Validate each discovered source through the reader preflight/session: required
tables/columns, SQLite UTF-8 encoding, supported storage classes, signed-int64
IDs, duplicates/orphans, text byte/fatal UTF-8, row/resource limits, and strict
warning promotion. Never create a writer or destination. `valid: true` is
permitted only after the reader has completed all checks. Preserve fixed
mappings (`UNSUPPORTED_DATABASE_ENCODING`, `INVALID_TEXT_VALUE`,
`INVALID_TEXT_ENCODING`, exit 4) and `NO_CDB_INPUT` exit 3.

## Task 4.3 — Schema selectors and safe schema output

**Files:** `src/commands/schema.ts`, `src/cli/parseArgs.ts`,
`schemas/cdb.raw.v1.schema.json`, `schemas/cdb.card.v2.schema.json`,
`schemas/ygo.card-source.v1.schema.json`, aggregate schema files,
`scripts/package-check.mjs`; create `tests/conformance/schemaSelection.test.ts`.

Support `raw`, `card`, `card-array`, `source`, and `source-array`. Item selectors
print item schemas; aggregate selectors have top-level `type: array` with item
references, not wrapper objects. Selection reads packaged JSON only and makes
zero SQLite calls. `--output -` uses stdout; file output uses the same secure
atomic destination and unsupported capability returns exit 6. Keep schema bytes
and property order deterministic. Package checks must require all five schemas
and truthful native artifacts.

## Task 4.4 — Compiled process smoke gate

**Files:** `tests/cli/processSmoke.test.ts`, `tests/fixtures/buildCdbFixture.ts`,
`README.md` raw/destination caveat only; package scripts only if needed.

Spawn `dist/cli.js` and cover raw JSON/JSONL stdout, supported/unsupported file
output, split fresh-root behavior, inspect, validate, all schemas, diagnostics
modes, invalid pre-open options, unavailable profiles, missing input, input/
resource failure, output conflict, SIGINT, late stdout failure, and continued
mixed input. Run supported native race vectors whenever the manifest reports
support; otherwise assert exit-6 before discovery/reader access.

**Verification:**

```bash
npm run build
npm run test:reader
npm run test:compat
npm run test:cli
npm run package:check
```

The process suite must not rely solely on importing `main()`. Raw JSONL must
parse as one complete envelope per line, stdout must be data-only, and failed
pre-commit attempts must preserve incumbent files. Do not archive the active
Phase 2 planning directories at this checkpoint.

**Stop/rollback:** if inspect hashes/opens a live path, validate trusts discovery
alone, schema opens SQLite/writes insecurely, or streams mix, revert only command
and schema wiring while retaining session/writer/destination contracts; rerun
reader, compatibility, raw stdout, and package gates.
