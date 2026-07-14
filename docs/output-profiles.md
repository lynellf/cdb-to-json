# Output Profiles

`cdb-to-json` supports three output profiles: `raw`, `card`, and `source`. Each profile serves different use cases and produces different output structures.

## Profile Overview

| Profile | Use Case | Schema |
|---------|----------|--------|
| `raw` | Lossless archival, programmatic processing | `cdb.raw/1` |
| `card` | Card game applications, filtered views | `cdb.card/2` |
| `source` | Translation pipelines, text analysis | `ygo.card-source/1` |

## Raw Profile

The `raw` profile preserves the exact database structure without normalization.

```bash
npx cdb-to-json convert cards.cdb --profile raw > output.json
```

### Output Structure

```json
{
  "schema": "cdb.raw/1",
  "identity": {
    "sourceRevisionId": "sha256:...",
    "databaseSha256": "sha256:...",
    "inputPath": "/path/to/cards.cdb",
    "format": "json",
    "profile": "raw"
  },
  "provenance": {
    "converterVersion": "2.0.0",
    "conversionOptionsHash": "sha256:...",
    "semanticOptions": { ... }
  },
  "diagnostics": [],
  "tables": {
    "datas": [
      {
        "id": "12345",
        "ot": "3",
        "alias": "0",
        "setcode": "80208122",
        "type": "33",
        "atk": "1800",
        "def": "600",
        "level": "4",
        "race": "1",
        "attribute": "16",
        "category": "0"
      }
    ],
    "texts": [
      {
        "id": "12345",
        "name": "Dark Magician",
        "desc": "The ultimate wizard in terms of attack and defense power.",
        "str1": "",
        "str2": "",
        "str3": "",
        "str4": "",
        "str5": "",
        "str6": "",
        "str7": "",
        "str8": "",
        "str9": "",
        "str10": "",
        "str11": "",
        "str12": "",
        "str13": "",
        "str14": "",
        "str15": "",
        "str16": ""
      }
    ]
  }
}
```

### Key Characteristics

- **Integer encoding**: All SQLite INTEGER values are decimal strings (`"12345"` not `12345`)
- **Exact text**: Description text is byte-identical to database content
- **Complete tables**: All supported columns included
- **Diagnostics attached**: Any warnings/errors included in output

### When to Use

- Archival of original database state
- Custom normalization pipelines
- Debugging card data issues
- Maximum fidelity requirements

## Card Profile

The `card` profile normalizes card data into typed structures.

```bash
npx cdb-to-json convert cards.cdb --profile card > cards.json
```

### Output Structure

```json
{
  "schema": "cdb.card-array/2",
  "identity": { ... },
  "cards": [
    {
      "schema": "cdb.card/2",
      "identity": { ... },
      "cardKind": "MONSTER",
      "typeLine": {
        "monsterType": "Normal Monster",
        "monsterTypes": ["Normal Monster"],
        "attribute": "SPELL",
        "attributes": ["SPELL"],
        "subtype": "Normal",
        "subtypes": ["Normal"]
      },
      "monster": {
        "kind": "NORMAL",
        "level": 4,
        "progression": {
          "rawValue": "4",
          "unknownBits": 0,
          "level": 4
        },
        "attribute": "DARK",
        "race": "SPELLCASTER",
        "attack": 2500,
        "defense": 2000
      },
      "text": {
        "raw": "This is the original card text.",
        "normalized": "This is the original card text.",
        "normalizationVersion": "text-normalization/1"
      },
      "simulator": {
        "rawFields": {
          "type": "33",
          "attribute": "16",
          "ot": "3"
        },
        "rawRows": {
          "type": { "value": "33", "unknownBits": 0 },
          "attribute": { "value": "16", "unknownBits": 0 }
        }
      },
      "setcodes": [
        { "value": "80208122", "archetypes": ["Dark Magic"] }
      ],
      "availability": {
        "tcg": true,
        "ocg": true,
        "goat": false
      },
      "diagnostics": []
    }
  ]
}
```

### Key Characteristics

- **Normalized types**: Card types, attributes, races are decoded from bitmasks
- **Nullable convenience fields**: `attribute` is null when ambiguous, `attributes` always has decoded list
- **Conflict detection**: Multiple compatible types set fields to null with diagnostic
- **Progression tracking**: Level/rank/link rating with raw values preserved

### When to Use

- Card game applications
- Deck builders
- Card browsers
- Filtering by card type/attribute

## Source Profile

The `source` profile is designed for translation and text analysis pipelines.

```bash
npx cdb-to-json convert cards.cdb --profile source > source.jsonl
```

### Output Structure

```json
{
  "schema": "ygo.card-source/1",
  "identity": { ... },
  "locale": "en",
  "printed": { ... },
  "text": {
    "raw": "The ultimate wizard in terms of attack and defense power.",
    "normalized": "The ultimate wizard in terms of attack and defense power.",
    "normalizationVersion": "text-normalization/1",
    "spansBasis": "normalized",
    "offsetEncoding": "utf-16-code-units",
    "sections": {
      "monsterEffect": {
        "text": "The ultimate wizard in terms of attack and defense power.",
        "start": 0,
        "end": 64,
        "kind": "monsterEffect",
        "basis": "normalized"
      },
      "pendulumEffect": null,
      "flavor": null,
      "material": null,
      "ritualSpell": null
    },
    "unclassified": [],
    "segmentation": "UNSPLIT"
  },
  "simulatorSource": {
    "rawRows": { ... }
  },
  "references": {
    "scripts": [],
    "rulings": []
  },
  "coverage": {
    "status": "SOURCE_ONLY"
  },
  "diagnostics": []
}
```

### Key Characteristics

- **Source-only**: No derived card semantics
- **Text segmentation**: Effect text split into semantic sections
- **UTF-16 offsets**: Span positions in code units for Unicode correctness
- **No executable semantics**: Text analysis only, no card effects decoded

### When to Use

- Translation pipelines
- Text analysis and corpus building
- Card database localization
- Research on card text patterns

## Format Options

### JSON (default)

```bash
npx cdb-to-json convert cards.cdb --format json
```

- Human-readable
- Full structure with line breaks
- Best for small databases or debugging

### JSONL (JSON Lines)

```bash
npx cdb-to-json convert cards.cdb --format jsonl
```

- One record per line
- Streaming-friendly
- Best for large databases or piping

```bash
# Pipe to another tool
npx cdb-to-json convert cards.cdb --format jsonl | jq '.cards[].name'
```

## Split Options

### Single File (default)

```bash
npx cdb-to-json convert cards.cdb --split none
```

Outputs one file for single database or merged output.

### Per Database

```bash
npx cdb-to-json convert dir/ --split database --output ./output/
```

Creates one file per input database.

### Per Card (merged)

```bash
npx cdb-to-json convert dir/ --split card --merge --output ./cards/
```

Creates one file per card after resolving conflicts.

## Merge Options

### First-Wins

```bash
npx cdb-to-json convert dir/ --merge --on-conflict first
```

Uses first database's card when conflicts occur.

### Last-Wins

```bash
npx cdb-to-json convert dir/ --merge --on-conflict last
```

Uses last database's card when conflicts occur.

### Error on Conflict

```bash
npx cdb-to-json convert dir/ --merge --on-conflict error
```

Fails with exit 5 if duplicate card IDs exist.

## Deterministic Output

Output is deterministic regardless of:

- File modification times
- Processing order variations
- Presentation formatting

The following are excluded from hashes:

- Output file path
- Output directory
- Format (JSON vs JSONL)
- Pretty-printing
- Diagnostic rendering
- Process timing

## Schema References

- [cdb.raw.v1.schema.json](../schemas/cdb.raw.v1.schema.json)
- [cdb.card.v2.schema.json](../schemas/cdb.card.v2.schema.json)
- [ygo.card-source.v1.schema.json](../schemas/ygo.card-source.v1.schema.json)
