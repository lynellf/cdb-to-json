# cdb-to-json

Converts EDOPro CDB files into a JSON format.

## Usage

```javascript
import cdbtojson from "cdb-to-json";

await cdbtojson("input_directory", "output_directory");
```

```javascript
import cdbtojson from "cdb-to-json";

const { datas, texts } = await cdbtojson(
  "input_directory",
  "output_directory",
  { emit: true }
);
```
