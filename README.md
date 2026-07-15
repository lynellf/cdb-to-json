# cdb-to-json

`cdb-to-json` converts EDOPro/YGOPro-compatible CDB (SQLite) databases into
JSON on macOS, Linux, and Windows. It requires Node.js 22 or later.

## Quick start

```bash
npm install cdb-to-json

# Lossless database envelope (the default profile)
npx cdb-to-json convert cards.cdb > cards.raw.json

# Client-friendly card catalog
npx cdb-to-json convert cards.cdb --profile card > cards.json

# YGO-DSL source documents with simulator provenance
npx cdb-to-json convert cards.cdb --profile source > source.json
```

Run `cdb-to-json --help` for the current command and option reference.

## Commands

| Command | Purpose |
| --- | --- |
| `convert [inputs...]` | Convert CDB input to JSON or JSONL. |
| `inspect [inputs...]` | Print database metadata without emitting cards. |
| `validate [inputs...]` | Validate CDB input structure. |
| `schema <profile>` | Print a JSON Schema. Use `raw`, `card`, `source`, `card-array`, or `source-array`. |

## Output profiles

| Profile | Output | Schema |
| --- | --- | --- |
| `raw` (default) | One lossless CDB database envelope | `cdb.raw/1` |
| `card` | One client-friendly record per card | `cdb.card/2` |
| `source` | One YGO-DSL source document per card, including CDB provenance | `ygo.card-source/1` |

Both JSON and JSONL are supported. JSON emits an array for `card` and `source`;
JSONL emits one card or source document per line.

`card` and `source` currently accept exactly one input database and write to
stdout or a single `--output` file. They do not support `--merge` or `--split`.

## Output destinations

All profiles can write to stdout or a file:

```bash
npx cdb-to-json convert cards.cdb --profile card --output cards.json
npx cdb-to-json convert cards.cdb --profile source --format jsonl --output source.jsonl
```

The `raw` profile additionally supports one file per input database:

```bash
npx cdb-to-json convert ./databases --profile raw --split database --output ./out
```

`--split database` requires a new output directory. Raw conversion does not
support `--merge` or `--split card`.

`--force` replaces an existing file output. Directory output is never replaced.

## Useful options

```text
--profile raw|card|source       Select an output profile (default: raw)
--format json|jsonl             Select output encoding (default: json)
--output, -o <path>             Write to a file or directory instead of stdout
--locale, -l <tag>              Declare source-text locale
--source-namespace <name>       Namespace for card external IDs (default: konami)
--pretty                        Pretty-print JSON output
--force                         Replace an existing file output
--max-rows <n>                  Limit rows per table
--max-text-bytes <n>            Limit text-cell size
--max-output-bytes <n>          Limit output size
```

## Platform support

The normal reader and output paths use portable Node filesystem operations and
work on macOS, Linux, and Windows. Linux-only descriptor-relative hardening is
optional; it is not required for conversion or file output.

## Legacy API

The v1-compatible default export remains available for existing users:

```javascript
import legacyConvert from "cdb-to-json/legacy";

const tables = await legacyConvert("./databases", "./output", {
  emit: true,
  ignore: [],
});
```

## Development

```bash
npm ci
npm run build
npm test
npm run lint
npm run package:check
```

## Design record

[ADR-0001: Restore portable conversion](docs/decisions/0001-portable-raw-conversion.md)
records why the portable paths are the default.

## License

ISC
