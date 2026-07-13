# Phase 1 — strict command parsing and pre-open output planning

## Goal and dependency

Replace permissive CLI scaffolding with one normalized option object and a pure
output planner. This phase depends only on the Phase 0–1 checkpoint and must not
open SQLite, acquire a snapshot, load the native module for file I/O, or emit
converted data.

## Files and bounded discovery

Change:

- `src/cli/parseArgs.ts`
- `src/cli.ts`
- `src/cli/exitCodes.ts`
- `src/cli/renderHelp.ts`
- `src/application/types.ts`
- `src/application/commandValidation.ts`
- `src/application/outputPlan.ts`
- `src/commands/convert.ts`
- `src/diagnostics/codes.ts` to freeze `PROFILE_NOT_AVAILABLE`

Create or extend:

- `tests/cli/parseArgs.test.ts`
- `tests/cli/commandMatrix.test.ts`
- `tests/cli/exitCodes.test.ts`
- `tests/cli/limitRelations.test.ts` (the exact inherited R5.6 gate)

Before editing, inspect only the current parser, CLI entry point, exit-state
calculator, command handler, and `LimitsV1` definitions. Use a spy at the
`discoverInputs`/reader boundary in tests; no broad transcript or unrelated
profile work is needed.

## Implementation tasks

### 1.1 Parse without fallback

- Define strict `node:util.parseArgs` option tables for each command. Unknown
  options, missing values, malformed values, duplicate non-repeatable options,
  and invalid command positionals return a structured usage result, not `help`.
- Keep `help`, `--help`, `version`, and `--version` separate from conversion.
  Preserve bare-command conversion (`cdb-to-json cards.cdb`) only when the
  positional is a valid input path shape; do not heuristically turn an unknown
  command into a file.
- Define all repeatability and defaults once: profile, format, output, split,
  merge, conflict, pretty, force, include-raw, locale, source namespace,
  strict, recursive, exclude, follow-symlinks, diagnostics,
  continue-on-error, and all six numeric limits.
- Parse numeric strings as canonical non-negative safe integers. Reject signs,
  fractional values, trailing junk, overflow, and duplicate scalar flags.

### 1.2 Normalize options and classify errors

- Build one `LimitsV1` object and pass the same object downstream. Reject
  `maxSpoolBytes > maxStagingBytes` and
  `maxSnapshotBytes > maxStagingBytes` with `INVALID_LIMIT_RELATION`; never
  clamp or silently substitute another value.
- Freeze `PROFILE_NOT_AVAILABLE` for unavailable `card`/`source` conversion.
  It is an option failure (exit `2`) and is rejected before discovery, snapshot,
  or SQLite access; do not substitute `INVALID_PATH` or another generic code.
  Only explicit `raw` conversion enters the Phase 2 application path.
- Keep semantic options (locale, source namespace, registries, strictness,
  limits) separate from presentation options (format, pretty, output path,
  diagnostics renderer, lock token) so later hashes cannot include path or
  presentation values.
- Preserve exit precedence in `src/cli/exitCodes.ts`. Ensure cancellation and
  output errors override partial continuation, while input/resource errors
  remain exit 4. Freeze reader diagnostics for downstream phases:
  `UNSUPPORTED_DATABASE_ENCODING` for non-UTF-8 (exit 4),
  `INVALID_TEXT_VALUE` for a non-TEXT/non-NULL supported text cell (exit 4),
  and `PROFILE_NOT_AVAILABLE` for unavailable card/source conversion (exit 2,
  before discovery). `INVALID_PATH` MUST NOT be used for profile capability
  rejection.

### 1.3 Build the two-stage output plan

Make `src/application/outputPlan.ts` expose pure operations, for example:

```ts
interface StructuralOutputPlan {
  options: NormalizedConvertOptions;
  profile: "raw" | "card" | "source";
  destination: { kind: "stdout" | "file" | "directory"; path?: string };
  split: "none" | "database" | "card" | "auto";
}

interface ConcreteOutput {
  inputOrdinal: number;
  inputPath: string;
  relativeName: string;
  logicalOutputId: string;
}
```

The exact names may differ, but the following rules are mandatory:

- The pure structural planner validates profile/format/split/merge/conflict,
  pretty/JSONL, destination intent, and numeric limits before discovery or
  SQLite access. An injected native preflight then acquires the trusted existing
  parent descriptor, validates the split leaf, and probes the selected
  filesystem's descriptor-relative primitives before discovery; it returns
  opaque parent/lease handles rather than paths. No unchecked path survives
  that boundary and no native support is inferred from Node version alone.
- `auto` remains internal until discovered count is known. Multiple unmerged
  raw inputs become `split=database`; one input becomes `split=none`.
- Raw rejects merge and card split. Multiple raw logical outputs require a
  directory, and stdout is allowed only for one logical output.
- A structural destination preflight runs before `discoverInputs()` and before
  any snapshot or reader call. It validates destination kind/path shape, acquires
  a trusted parent descriptor, rejects an existing split root with
  `OUTPUT_DIRECTORY_EXISTS`, and runs a side-effect-contained actual-filesystem
  probe for no-symlink traversal, exclusive lock/temp creation, and no-replace
  publication. Unsupported or failed capability returns
  `UNSAFE_DESTINATION_FILESYSTEM`. These checks use no discovery. A concrete
  planner then runs after deterministic discovery and before any snapshot or
  reader call; it assigns ordinal-based, sanitized filenames and validates only
  discovered-cardinality facts: output count, source/output identity, and
  filename collisions. Existing split roots fail even when empty and even with
  `--force`; fresh-root existence and native capability MUST NOT be deferred to
  the concrete planner. The preflight lease is held through staging and the
  source/output identity check is repeated immediately before `COMMITTING`.
- Add a discovery-spy assertion proving each structural destination failure and
  unavailable-profile rejection occurs before `discoverInputs()`. Cardinality-
  dependent checks happen only after discovery, never after SQLite open. Add
  native race vectors for a final appearing after preflight, parent replacement,
  source hardlinks/symlinks, and descriptor-relative cleanup; the planner must
  retain opaque handles and never pass a raw path to lock, temp, rename, or
  cleanup.
- No plan method performs SQL, hashes a database, follows a symlink into a
  source, or mutates an output root.

### 1.4 CLI lifecycle

- `main()` installs exactly one SIGINT handler around the application call,
  aborts the passed signal, and removes the handler in `finally`.
- Commands receive injected stdout/stderr writers. Parse and plan diagnostics
  go only to stderr; no summary or progress is written to stdout.
- `convert` delegates the normalized plan to the application service and does
  not contain SQL, profile mapping, or publication details.

## Tests and acceptance criteria

Add matrix vectors for:

- explicit raw one-input stdout/file and raw multi-input split directory;
- the exact inherited `tests/cli/limitRelations.test.ts` relation vectors;
- raw merge, raw card split, raw multi-input split none, and stdout with multiple
  logical outputs;
- file/directory destination mismatch and existing empty/populated split roots,
  including `--force`;
- pretty plus JSONL, invalid enum values, repeated scalar options, missing
  values, malformed/negative/unsafe limits, and both limit relations;
- unavailable card/source conversion with a reader spy proving zero calls;
- `-o -`, bare convert, help/version, diagnostics modes, input/output identity,
  and filename collisions;
- exit precedence for input, collision, output/cancel, partial, and internal
  states; and
- SIGINT handler removal after success, error, and cancellation.

Run:

```bash
npm run build
npm run test:cli -- --run tests/cli/parseArgs.test.ts tests/cli/commandMatrix.test.ts tests/cli/exitCodes.test.ts tests/cli/limitRelations.test.ts
```

**Stop condition:** any structural invalid case crosses discovery/snapshot/SQLite;
any parse failure becomes help; or stdout contains a diagnostic/summary.

## Rollback

Revert only parser/planner/command-validation changes and their tests. Verify
`npm run build`, `npm run test:reader`, and `npm run test:compat` before continuing.
No input or output filesystem state should be changed by this phase.

## B2-R3/R4 implementation amendment — parent and force contracts

The structural planner must freeze these destination policies rather than pass
an unconstrained `createMissingParents` flag to implementation:

- all destination parent components must already exist as non-symlink
  directories; missing parents, empty/trailing components, NUL, `.`/`..`, and
  unsupported path shapes fail structural preflight with
  `UNSAFE_DESTINATION_FILESYSTEM` (exit 6), before discovery;
- absolute paths are supported only by a native `/` anchor traversed with
  no-follow descriptor-relative operations; relative paths use a held process-cwd
  directory descriptor. After acquisition the plan carries `ParentHandle`, the
  validated final leaf, and lease handles, never a raw destination path;
- the native parent handle records anchor/parent identities and revalidates
  reachability at preflight, lease, stage, identity, publication, and cleanup.
  Replacement before an operation returns `NOT_COMMITTED/PARENT_REPLACED`; a
  race after the final check may safely commit to the already-held old inode and
  must return `COMMITTED` with `SAFE_OLD_PARENT`, never follow the replacement;
- split roots are still required to be absent at preflight and are published
  once with no-replace; an existing root is rejected regardless of force; and
- file force has an explicit bounded capability policy: `ABSENT` (with or
  without `--force`) uses `RENAME_NOREPLACE`, while an `EXPECTED_PRESENT(E)`
  regular final with `--force` is unsupported in this package. The capability
  manifest MUST report `identityGuardedReplace: false`; structural preflight
  returns `UNSAFE_DESTINATION_FILESYSTEM` (exit 6) before discovery, and the
  plan contains no `replaceIfIdentityMatches` or plain-rename substitute. A
  no-force incumbent is the normal output conflict. Final appearance after an
  absent reservation is never authorized or clobbered. Symlink, directory,
  source-identity, and input-hardlink finals are rejected regardless of force.

Add planner vectors for absolute/relative/missing-parent shapes, parent swaps at
each boundary, existing empty/populated split roots with force, absent-final
races, force against an expected regular incumbent (asserting unsupported
pre-discovery failure), and final symlink/dir/hardlink races. The concrete plan
retains the opaque handles through the commit barrier and never reconstructs a
path for lock, temp, rename, or cleanup.
