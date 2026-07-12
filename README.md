# cdb-to-json

CLI-first Yu-Gi-Oh! CDB ingestion tool for EDOPro/YGOPro-compatible SQLite databases.

## Build and test

```sh
npm install
npm test
```

The build reports the native secure-destination capability for the supported
Linux/Node 22 matrix. Other hosts can use stdout conversion and report the
unsupported capability in the build manifest.

## CLI

```sh
# Convert one database to the raw, lossless profile
npx cdb-to-json convert cards.cdb --profile raw > cards.json

# Inspect or validate input metadata
npx cdb-to-json inspect cards.cdb
npx cdb-to-json validate cards.cdb

# Print an output schema
npx cdb-to-json schema raw
```

Converted data is written to stdout; diagnostics are written to stderr. The
current checkpoint ships the lossless `raw` profile and reader/library APIs.

## Library API

```js
import { iterateRawCards, convert } from "cdb-to-json";

for await (const card of iterateRawCards("cards.cdb")) {
  // card.datas and card.texts preserve source values.
}
```

The deprecated v1 default export remains available during the 2.x line. It
accepts an input directory and optional output directory and preserves the
legacy `{ datas, texts }` result shape:

```js
import legacyConvert from "cdb-to-json/legacy";

const tables = await legacyConvert("./databases");
```
