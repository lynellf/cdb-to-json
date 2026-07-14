# cdb-to-json

CLI-first Yu-Gi-Oh! Card Database (CDB) ingestion tool for EDOPro/YGOPro-compatible SQLite databases. Converts CDB files to JSON with support for multiple output profiles, streaming, and secure file output.

## Features

- **CLI-first design**: Full-featured command-line interface with argument parsing and structured diagnostics
- **Multiple profiles**: `raw` (lossless), `card` (normalized), `source` (translation-ready)
- **Streaming**: Memory-efficient processing for large databases
- **Secure output**: Atomic file operations on Node 22+ Linux
- **Deterministic**: Hashes exclude presentation-only fields

## Quick Start

```bash
# Install
npm install cdb-to-json

# Convert a database
npx cdb-to-json convert cards.cdb --profile raw > output.json

# Inspect database metadata
npx cdb-to-json inspect cards.cdb

# Validate database schema
npx cdb-to-json validate cards.cdb

# Print output schema
npx cdb-to-json schema raw
```

## Profiles

| Profile | Description | Schema |
|---------|-------------|--------|
| `raw` | Lossless database envelope | `cdb.raw/1` |
| `card` | Normalized card records | `cdb.card/2` |
| `source` | Translation-ready documents | `ygo.card-source/1` |

### Raw Profile

```bash
npx cdb-to-json convert cards.cdb --profile raw
```

Outputs a complete database envelope preserving all raw data.

### Card Profile

```bash
npx cdb-to-json convert cards.cdb --profile card
```

Outputs normalized card records with decoded types, attributes, and text.

### Source Profile

```bash
npx cdb-to-json convert cards.cdb --profile source
```

Outputs documents optimized for translation pipelines with text segmentation.

## Output Formats

### JSON (default)

```bash
npx cdb-to-json convert cards.cdb --format json > output.json
```

### JSONL (one record per line)

```bash
npx cdb-to-json convert cards.cdb --format jsonl > output.jsonl
```

## Output Splitting

### Single File

```bash
# Default: one file for single database
npx cdb-to-json convert cards.cdb --split none --output result.json
```

### Per Database

```bash
# One file per input database
npx cdb-to-json convert dir/ --split database --output results/
```

### Per Card (merged)

```bash
# One file per card after conflict resolution
npx cdb-to-json convert dir/ --split card --merge --on-conflict last --output cards/
```

## Merge Options

```bash
# First-wins conflict resolution
npx cdb-to-json convert dir/ --merge --on-conflict first

# Last-wins (default)
npx cdb-to-json convert dir/ --merge --on-conflict last

# Error on conflicts
npx cdb-to-json convert dir/ --merge --on-conflict error
```

## Error Handling

### Continue on Error

```bash
# Process all databases, keep successful outputs
npx cdb-to-json convert dir/ --continue-on-error
```

### Force Overwrite

```bash
# Replace existing outputs
npx cdb-to-json convert cards.cdb --output existing.json --force
```

## Resource Limits

```bash
--max-rows 500000
--max-text-bytes 2097152
--max-output-bytes 1073741824
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Internal error |
| 2 | Invalid usage |
| 3 | No input found |
| 4 | Validation error |
| 5 | Merge collision |
| 6 | Output error |
| 7 | Partial conversion |

## Build and Test

```bash
# Install dependencies
npm ci

# Build (includes native secure-destination module)
npm run build

# Run all tests
npm test

# Run focused tests
npm run test:cli
npm run test:reader
npm run test:normalization
npm run test:source
npm run test:streaming
npm run test:conformance

# Check package contents
npm run package:check
```

## Library API

```javascript
import { convert, iterateRawCards } from "cdb-to-json";

// Iterate over cards (streaming)
for await (const card of iterateRawCards("cards.cdb")) {
  console.log(card.datas.id, card.texts.name);
}

// Convert with options
const result = await convert("cards.cdb", {
  profile: "raw",
  format: "json",
});
```

### Legacy API

The v1 API remains available for backward compatibility:

```javascript
import legacyConvert from "cdb-to-json/legacy";

// Legacy-style conversion
const tables = await legacyConvert("./databases", "./output", {
  emit: true,
  ignore: false,
});
```

## Platform Support

| Feature | Node 22+ Linux | Other Platforms |
|---------|----------------|-----------------|
| CLI | Full | Full |
| Raw profile | Full | Full |
| Card/Source profiles | Full | Full |
| Secure file output | Yes | stdout only |

Secure file output requires Node 22+ Linux with `openat2` support.

## Documentation

- [Migration Guide](docs/migration-v1-to-v2.md) - v1 to v2 migration
- [Output Profiles](docs/output-profiles.md) - Profile details
- [Registry Versioning](docs/registry-versioning.md) - Registry contract
- [Limits and Diagnostics](docs/cdb-to-json-cli-refactor/limits-and-diagnostics.md) - Operational reference

## License

ISC
