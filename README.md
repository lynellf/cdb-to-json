# cdb-to-json

CLI-first Yu-Gi-Oh! Card Database (CDB) ingestion tool for EDOPro/YGOPro-compatible SQLite databases. Converts CDB files on macOS, Linux, and Windows.

## Features

- **CLI-first design**: Full-featured command-line interface with argument parsing and structured diagnostics
- **Raw profile**: lossless CDB database envelopes (`cdb.raw/1`)
- **Card profile**: client-friendly card records (`cdb.card/2`)
- **Source profile**: YGO-DSL source records with simulator provenance (`ygo.card-source/1`)
- **Streaming**: Memory-efficient processing for large databases
- **Portable output**: stdout, files, and split directories on Node 22+
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
| `card` | Client-friendly card catalog record | `cdb.card/2` |
| `source` | YGO-DSL source record with simulator provenance | `ygo.card-source/1` |

### Raw Profile

```bash
npx cdb-to-json convert cards.cdb --profile raw
```

Outputs a complete database envelope preserving all raw data.

### Card Profile

```bash
npx cdb-to-json convert cards.cdb --profile card > cards.json
```

Outputs one client-friendly record per card. It decodes card type, traits,
monster/spell/trap fields, identity, archetype codes, and simulator flags.

### Source Profile

```bash
npx cdb-to-json convert cards.cdb --profile source > source.json
```

Outputs one provenance-rich YGO-DSL source document per card, including
normalized and segmented text plus the originating CDB rows.

`card` and `source` currently accept exactly one input database and write to
stdout or a single `--output` file. `--merge` and `--split` are not available
for those profiles yet.

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

The split and merge options below apply to the `raw` profile.

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

# Build
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
