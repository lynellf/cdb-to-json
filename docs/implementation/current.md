# Implementation Status

## Phase 0-1 — COMPLETE (2026-07-12)
All Phase 0-1 remediation tasks completed. All gates pass (59 tests).

### What was built

| Task | Status | Files |
|------|--------|-------|
| TypeScript strict-mode toolchain | ✅ | `tsconfig.json`, `package.json` |
| Raw types (signed-int64 decimal strings) | ✅ | `src/cdb/rawTypes.ts` |
| Exit codes with precedence matrix | ✅ | `src/cli/exitCodes.ts` |
| Diagnostic codes (comprehensive) | ✅ | `src/diagnostics/codes.ts` |
| Diagnostic collector (merge, promote) | ✅ | `src/diagnostics/collector.ts` |
| Bounded CTE join (no SELECT *) | ✅ | `src/cdb/iterateRows.ts` |
| Snapshot bundle (main/WAL/SHM) | ✅ | `src/cdb/snapshotBundle.ts` |
| WAL materialization (VACUUM INTO) | ✅ | `src/cdb/materializeSnapshot.ts` |
| Text byte preflight | ✅ | `src/cdb/textPreflight.ts` |
| Safe open with encoding check | ✅ | `src/cdb/openDatabase.ts` |
| Async iterator with AbortSignal | ✅ | `src/cdb/iterateRows.ts` |
| Input discovery (lstat, cycles, ordering) | ✅ | `src/discovery/discoverCdbInputs.ts` |
| Path policy (exact .cdb, legacy rules) | ✅ | `src/discovery/pathPolicy.ts` |
| Legacy compatibility bridge | ✅ | `src/legacy.ts`, `app/index.js` |
| Legacy output writer | ✅ | `src/compatibility/legacyOutput.ts` |
| Secure destination contract | ✅ | `src/destinations/secureDestination.ts` |
| Registry placeholder | ✅ | `src/registry/placeholder.ts` |
| Staging budget tracker | ✅ | `src/application/stagingBudget.ts` |
| Application types (LimitsV1, etc.) | ✅ | `src/application/types.ts` |
| Hashing (canonical JSON, SHA-256) | ✅ | `src/hashing/sha256.ts` |
| Schema files (raw, card, source) | ✅ | `schemas/*.json` |
| Vitest config with JS includes | ✅ | `vitest.config.ts` |
| Build/package scripts | ✅ | `scripts/*.mjs` |
| Phase 0-1 test suite (51 focused tests + 8 full-suite tests) | ✅ | `tests/` |

### Gates passed

```bash
npm run build        # TypeScript compilation succeeds
npm test             # 59 tests pass
npm run package:check # All required artifacts present
```

### Key architecture decisions implemented

1. **Safe integer mode** with `bigint` at the raw boundary
2. **Signed-int64 decimal string** representation for all INTEGER values
3. **Bounded CTE join** with explicit column list (no `SELECT *`)
4. **Snapshot acquisition** with WAL/SHM detection before database open
5. **VACUUM INTO materialization** for immutable extraction
6. **Preflight phase** for row count, duplicate ID, and text byte checks
7. **Async iterable iterator** with periodic event-loop yield
8. **Separate legacy discovery policy** (contains `.cdb` instead of exact final extension)
9. **Strict exit-code precedence** (2 > 3 > 4 > 5 > 6 > 7 > 1)

### Remaining phases (deferred)

- Phase 2: CLI commands, raw profile, streaming destinations, atomic file output
- Phase 3: Card profile, bitfield decoders, versioned registries, merge handling
- Phase 4: Text segmentation, source profile, translator contract, provenance hashing
- Phase 5: Hardening, migration docs, CI configuration, benchmark
