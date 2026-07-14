import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.js", "tests/**/*.test.ts"],
    // Run global setup once before any workers start. This avoids the parallel-worker
    // race condition where concurrent `npm run build` calls delete the native module
    // while sibling workers are running tests.
    globalSetup: [resolve(__dirname, "tests", "globalSetup.ts")],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "__tests__/", "native/"],
    },
  },
});