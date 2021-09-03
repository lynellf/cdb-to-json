const cdbtojson = require("../dist/mod");
const secrets = require("./secrets");

describe("the entire module", () => {
  it("runs without error", () => {
    const { inputDir, outputDir } = secrets;
    cdbtojson(inputDir, outputDir);
  });
});
