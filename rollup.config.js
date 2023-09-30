import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
// import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

export default {
  input: "src/index.ts",
  output: {
    file: "dist/mod.js",
    format: "cjs",
    exports: "auto"
  },
  plugins: [
    // commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      sourceMap: false,
      declarationDir: "types"
    }),
    nodeResolve(),
    json()
  ]
};
