#!/usr/bin/env node

/**
 * Turn the terminal-free CLI library emitted by TypeScript into the package's
 * executable entrypoint.
 *
 * TypeScript emits src/cli.ts as dist/cli.js. The package contract reserves
 * that public path for an executable, so the build keeps the library under a
 * private runtime name and writes the small process-boundary wrapper here.
 */

import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const distDirectory = join(process.cwd(), "dist");
const compiledLibrary = join(distDirectory, "cli.js");
const runtimeLibrary = join(distDirectory, "cli-runtime.js");
const compiledSourceMap = join(distDirectory, "cli.js.map");
const runtimeSourceMap = join(distDirectory, "cli-runtime.js.map");
const executable = join(distDirectory, "cli.js");

if (!existsSync(compiledLibrary)) {
  throw new Error(`TypeScript did not emit ${compiledLibrary}`);
}

renameSync(compiledLibrary, runtimeLibrary);

const runtimeSource = readFileSync(runtimeLibrary, "utf8").replace(
  /sourceMappingURL=cli\.js\.map/g,
  "sourceMappingURL=cli-runtime.js.map",
);
writeFileSync(runtimeLibrary, runtimeSource);

if (existsSync(compiledSourceMap)) {
  const sourceMap = readFileSync(compiledSourceMap, "utf8").replace(
    /cli\.js/g,
    "cli-runtime.js",
  );
  writeFileSync(runtimeSourceMap, sourceMap);
  // The source map is useful for the runtime artifact but is not part of the
  // executable boundary.
  if (compiledSourceMap !== runtimeSourceMap) {
    const { rmSync } = await import("node:fs");
    rmSync(compiledSourceMap);
  }
}

const wrapper = `#!/usr/bin/env node

import { main } from "./cli-runtime.js";
export { main } from "./cli-runtime.js";

const abortController = new AbortController();
const onSigint = () => {
  abortController.abort();
  process.stderr.write("\\nReceived SIGINT, cancelling...\\n");
};

process.once("SIGINT", onSigint);

try {
  const exitCode = await main(
    process.argv.slice(2),
    { stdout: process.stdout, stderr: process.stderr },
    abortController.signal,
  );
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(
    "Fatal error: " +
      (error instanceof Error ? error.message : String(error)) +
      "\\n",
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", onSigint);
}
`;

writeFileSync(executable, wrapper);
chmodSync(executable, 0o755);
