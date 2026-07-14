# P1 Phase Evidence

**Phase:** P1 (contracts-fixtures)
**Contract ID:** cdb-to-json-cli-refactor
**Contract Revision:** 5
**Date:** 2026-07-13

> **Superseded:** This historical evidence cannot support a P1 completion claim. The prior package gate was rerun independently and found a native module beside an unsupported post-probe manifest; the orphan fixture assertions also encoded an obsolete omitted-field shape. Replace the results below only after the current R6.1–R6.5 remediation tasks and gates pass. Historical O_TMPFILE/linkat observations below are not an active ABI decision; the revised package selects named descriptor-relative temps plus separate renameat2 no-replace/force operations.

## Criterion Results

| Criterion | Status | Evidence |
|-----------|--------|----------|
| P1-AC1 | **RETRACTED** | Independent rerun found `supported:false` with `dist/native/secure_destination.node` still present after the post-build probe; rerun after cleanup fix |
| P1-AC2 | **RETRACTED** | Existing orphan fixtures/tests assert omitted fields, contrary to normative R4.2 UNKNOWN/null states; rerun after schema/fixture correction |
| P1-AC3 | **PASS** | `npm run test:fixtures && npm run test:unit && npx vitest run tests/cli/limitRelations.test.ts` exit 0 |
| P1-AC4 | **PASS** | `grep -rn "console\." src/ --include="*.ts"` returned no results; native adapter inspection confirms Linux Node 22+ openat2 with RESOLVE_BENEATH\|RESOLVE_NO_SYMLINKS, no-follow traversal, and descriptor-relative openat/linkat/renameat2 |

## Invariant Results (P1-applicable)

| Invariant | Status | Evidence |
|-----------|--------|----------|
| INV-001 (schema identifiers + supported columns) | **PASS** | Schema files validated; `test:conformance` passes |
| INV-004 (diagnostics without terminal side effects) | **PASS** | No `console.*` in src/; exit codes tested |
| INV-006 (native secure destination capability) | **UNVERIFIED** | Primitive inspection remains historical; post-probe stale-artifact cleanup is not yet proven |
| INV-010 (release artifact) | **UNVERIFIED** | Package contents require rerun after the native cleanup correction |

---

## Detailed Evidence

### P1-AC1: Package build and capability manifest

**Command:**
```bash
npm run build:native && npm run build && npm run package:check
```

**Historical output (superseded):**
- `build:native`: Exit 0; the capability probe wrote an unsupported result but left `dist/native/secure_destination.node` behind.
- `build`: Exit 0; TypeScript compilation succeeded
- `package:check`: **FAIL**; the unsupported manifest/module pair is correctly rejected.

**Manifest content (unsupported host):**
```json
{
  "platform": "linux",
  "arch": "x64",
  "nodeAbi": "v26.5.0",
  "secureDestination": false,
  "supportedPrimitives": [],
  "requiredFlags": [],
  "primitiveProbeResults": {...}
}
```

**On supported host (Node 22+ Linux x64/arm64):** Would build native module, copy to `dist/native/secure_destination.node`, write supported manifest with module SHA-256 verification.

### P1-AC2: Schema validation

**Command:**
```bash
npm run test:fixtures && npm run test:conformance
```

**Output:**
```
Test Files  2 passed (2)
     Tests  36 passed (36)
```

**Schema identifiers validated:**
- `cdb.raw/1` (schemas/cdb.raw.v1.schema.json)
- `cdb.card/2` (schemas/cdb.card.v2.schema.json)
- `ygo.card-source/1` (schemas/ygo.card-source.v1.schema.json)
- `cdb.card-array/2` (schemas/cdb.card-array.v2.schema.json)
- `ygo.card-source-array/1` (schemas/ygo.card-source-array.v1.schema.json)

### P1-AC3: Fixture vectors and limit relations

**Command:**
```bash
npm run test:fixtures && npm run test:unit && npx vitest run tests/cli/limitRelations.test.ts
```

**Output:**
```
Test Files  5 passed (5)
     Tests  34 passed (34)
```

**Coverage:**
- Signed-int64 integer vectors (-2, 0, 2, 10, signed-64 min/max, NULL, invalid types)
- Limit defaults and relations (maxSpoolBytes/maxSnapshotBytes vs maxStagingBytes)
- Conflict-safe nullable/array fields
- Text metadata fixtures
- Registry placeholder (tests/fixtures/registry-source.json)
- Reject-only INVALID_LIMIT_RELATION (exit 2) before input access

### P1-AC4: Terminal-free source and native adapter contract

**Console search:**
```bash
grep -rn "console\." src/ --include="*.ts"
# No results
```

**Native adapter inspection:**

File: `native/secure-destination/src/secure_destination.cc`

Key functions implement:
1. `AcquireTrustedRoot`: Uses `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`
2. `OpenRelative`: Descriptor-relative opens with same flags
3. `CreateTempRelative`: Uses `openat` with `O_TMPFILE`
4. `AtomicRename`: Uses `renameat2` syscall
5. `ProbeCapability`: Exposes `["openat2", "openat", "linkat", "renameat2"]` primitives

File: `src/destinations/secureDestination.ts`

- Exports `SecureDestinationCapabilityManifest` interface
- Implements `probeNativeCapabilityAsync()` and `probeNativeCapability()`
- Documents no-path-fallback contract: unsupported capability returns `UNSAFE_DESTINATION_FILESYSTEM` (exit 6)

---

## Fixes Applied During P1

### Terminal-free enforcement

Fixed two violations found during P1 implementation:

1. **`src/application/convertCatalog.ts`**: Removed default parameter values that referenced `process.stdout`/`process.stderr`. Writers are now required and must be provided by the caller (the CLI adapter edge supplies process streams at entrypoint).

2. **`src/destinations/stdoutDestination.ts`**: Removed default parameter for stream. The `createStdoutDestination(stream)` now requires an explicit stream argument.

---

## Native Module Source Evidence

**File: `native/secure-destination/binding.gyp`**
```python
{
  "targets": [
    {
      "target_name": "secure_destination",
      "sources": [ "src/secure_destination.cc", "src/secure_destination.h" ],
      "defines": [ "NAPI_VERSION=9" ]
    }
  ]
}
```

**Required flags:**
- `RESOLVE_BENEATH`: Prevents escaping below the trusted root
- `RESOLVE_NO_SYMLINKS`: Prevents following symlinks

**Supported primitives:**
- `openat2`: Primary capability probe
- `openat`: Descriptor-relative open
- `linkat`: Hard link creation
- `renameat2`: Atomic rename with no-replace

---

## Stop Conditions Verified

- ✅ No focused script is missing or invokes an undeclared target
- ❌ Unsupported post-build capability was observed with a stale native module; this stop condition is not closed.
- ✅ Schema identifiers frozen; no unfrozen identifiers or broadened boundaries
- ✅ No `console.*` imports in `src/` modules
- ✅ No JavaScript number for source SQLite INTEGER (signed-int64 decimal string boundary)

---

## Deferred to Later Phases

Per contract, P1 defers:
- Reader snapshot acquisition, CDB row iteration, and legacy conversion behavior (P2)
- Modern CLI profile conversion and destination publication (P3)
- Card normalization, source segmentation, translator consumption, and release rollout (P4-P6)
