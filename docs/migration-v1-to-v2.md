# Migration Guide: v1 to v2

This guide helps you migrate from `cdb-to-json` v1.x to v2.x. The v2 release is CLI-first with modern TypeScript/ESM architecture while maintaining backward compatibility through the legacy API.

## What's New in v2

### CLI-First Design
The CLI is now the primary interface with full argument parsing, validation, and structured diagnostics:

```bash
# Convert a database
npx cdb-to-json convert cards.cdb --profile raw > output.json

# Inspect database metadata
npx cdb-to-json inspect cards.cdb

# Validate database schema
npx cdb-to-json validate cards.cdb

# Print output schema
npx cdb-to-json schema raw
```

### Multiple Output Profiles

| Profile | Description |
|---------|-------------|
| `raw` | Lossless database envelope with raw datas/texts tables |
| `card` | Normalized card records with type/decoding metadata |
| `source` | Source document format with text segmentation and provenance |

### Structured Diagnostics
Diagnostics are now machine-readable and written to stderr, separate from stdout data output.

### Native Secure Output
On Node 22+ Linux, file and directory output uses descriptor-relative atomic operations with identity guards.

## Migration Options

### Option 1: CLI Migration (Recommended)

Replace shell script wrappers with the CLI:

```bash
# v1: custom script
node convert.js --input cards.cdb --output cards.json

# v2: direct CLI
npx cdb-to-json convert cards.cdb --profile raw > cards.json
```

### Option 2: Library Migration

Replace the legacy API with modern named exports:

```javascript
// v1: default export
import legacyConvert from 'cdb-to-json';
const tables = await legacyConvert('./databases', './output');

// v2: named exports
import { convert, iterateRawCards } from 'cdb-to-json';

// Iterate over cards (streaming)
for await (const card of iterateRawCards('cards.cdb')) {
  console.log(card.datas.id, card.texts.name);
}

// Or convert with full options
const result = await convert('cards.cdb', {
  profile: 'raw',
  format: 'json',
  limits: {
    maxRows: 1000000,
    maxTextBytes: 4194304,
    maxOutputBytes: 2147483648,
    maxStagingBytes: 4294967296,
    maxSpoolBytes: 2147483648,
    maxSnapshotBytes: 4294967296,
  },
});
```

### Option 3: Continue with Legacy API

The v1 API remains available but is deprecated:

```javascript
import legacyConvert from 'cdb-to-json/legacy';

// v1 behavior preserved
const tables = await legacyConvert('./databases', './output', {
  emit: true,        // default: true
  ignore: false,     // default: false
});

// Legacy output shape
tables.forEach(({ name, data }) => {
  console.log(name);     // database name
  console.log(data.datas);  // raw datas array
  console.log(data.texts);  // raw texts array
});
```

## Profile/Format/Split Matrix

### Output Units

| Profile | JSON unit | JSONL unit |
|---------|-----------|------------|
| `raw` | One database envelope | One envelope per line |
| `card` | Array of records | One record per line |
| `source` | Array of documents | One document per line |

### Split Options

| Split | Description | Requires |
|-------|-------------|----------|
| `none` | Single file output | Exactly one database or `--merge` |
| `database` | One file per database | Directory output |
| `card` | One file per card | `--merge` with `card` or `source` profile |

### Merge Options

```bash
# Merge all databases into one output
npx cdb-to-json convert dir/ --profile card --merge --on-conflict last

# Merge with conflict error
npx cdb-to-json convert dir/ --profile card --merge --on-conflict error

# Unmerged (default)
npx cdb-to-json convert dir/ --profile card --split database
```

## Exit Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | Success | Conversion completed |
| 1 | Internal Error | Unexpected failure |
| 2 | Invalid Usage | Invalid options or combinations |
| 3 | No Input | No usable CDB input found |
| 4 | Validation Error | Input schema, strict, or resource failure |
| 5 | Collision | Merge card-ID conflicts |
| 6 | Output Error | File output or cancellation failure |
| 7 | Partial Conversion | Mixed success/failure with `--continue-on-error` |

## Resource Limits

Default limits (v1 had no explicit limits):

```javascript
{
  maxRows: 1000000,           // per required table
  maxTextBytes: 4194304,       // 4 MiB per text cell
  maxOutputBytes: 2147483648,  // 2 GiB per logical output
  maxStagingBytes: 4294967296, // 4 GiB aggregate staging
  maxSpoolBytes: 2147483648,   // 2 GiB merge spool
  maxSnapshotBytes: 4294967296, // 4 GiB snapshot/materialization
}
```

Override via CLI:
```bash
--max-rows 500000
--max-text-bytes 2097152
--max-output-bytes 1073741824
```

## Diagnostic Severity

| Severity | Default | `--strict` |
|----------|---------|------------|
| Warnings | Output | Errors |
| Info | Output | Output |
| Errors | Exit 4 | Exit 4 |

## Data Integrity

### Signed 64-bit Integers
SQLite INTEGER values are preserved as decimal strings to prevent JavaScript number precision loss:

```json
{
  "datas": {
    "id": "9223372036854775807"
  }
}
```

### Text Encoding
- Only UTF-8 databases are supported
- Invalid encoding emits `UNSUPPORTED_DATABASE_ENCODING` (exit 4)
- Text is returned as decoded strings, not hex

### Source Snapshot
Each database is captured as an immutable snapshot before reading:
- Main, WAL, and SHM files are copied
- Physical hash verifies integrity
- Source mutations are detected and rejected

## Known Breaking Changes

1. **Directory Discovery**: v1 searched recursively for `.cdb` files containing the pattern; v2 requires exact `.cdb` extension.

2. **Unsupported Table Handling**: v1 dynamically queried all tables; v2 records extra tables as metadata only.

3. **No Console Output**: Core library modules write no terminal output. Diagnostics go to stderr.

4. **Atomic Output**: File output is atomic with reservation/lock protocol. v1 had no atomicity guarantees.

5. **Integer Representation**: Raw integers are decimal strings, not JSON numbers.

## Compatibility Notes

- `app/index.js` remains available for existing consumers but is deprecated.
- Package default export is `legacyConvert` during v2.x for gradual migration.
- The v3 release will remove the legacy API.

## Support Matrix

| Feature | Node 22+ Linux | Other Platforms |
|---------|----------------|-----------------|
| CLI | Full | Full |
| Raw profile | Full | Full |
| Card/Source profiles | Full | Full |
| Secure file output | Yes | stdout only |
| `--force` replacement | Yes | stdout only |

Secure file output requires Node 22+ Linux with `openat2` support. Other platforms receive `UNSAFE_DESTINATION_FILESYSTEM` if attempting file output.

## Troubleshooting

### "UNSAFE_DESTINATION_FILESYSTEM" when writing files
Upgrade to Node 22+ on Linux, or use stdout output instead.

### "LEGACY_BASENAME_COLLISION" during legacy conversion
Two databases produce the same legacy output name. Use separate directories or migrate to the CLI.

### Missing card data after conversion
Check stderr for diagnostics. Common causes:
- Invalid text encoding (exit 4)
- Resource limit exceeded (exit 4)
- Unsupported database schema

### Integer precision loss
Ensure your JSON parser preserves large integers. The raw profile uses decimal strings for all INTEGER values.
