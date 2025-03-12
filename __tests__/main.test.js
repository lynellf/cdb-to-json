import it from "node:test";
import path from "node:path";
import cdbtojson from "../app/index.js";

const basePath = `${process.cwd()}/__tests__`;

const inputDir = path.join(basePath, "input_dir");
const outputDir = path.join(basePath, "output_dir");

it("runs without error", async () => {
  await cdbtojson(inputDir, outputDir);
});
