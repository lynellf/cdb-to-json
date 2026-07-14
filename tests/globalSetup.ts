/**
 * Global vitest setup — runs once before all test workers.
 *
 * This file ensures the TypeScript build and native module are compiled before
 * any tests run, avoiding the race condition where parallel vitest workers
 * each try to run `npm run build` concurrently (which can delete/recreate
 * dist/native/secure_destination.node while other workers are using it).
 *
 * This replaces the per-file `beforeAll(() => execSync("npm run build"))` pattern
 * which is incompatible with vitest's parallel-worker model.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

export async function setup() {
  // Only build if the dist artifacts are absent or stale.
  // This is idempotent — running it multiple times is safe.
  if (!existsSync("dist/index.js") || !existsSync("dist/native/capability.json")) {
    try {
      execSync("npm run build", { stdio: "inherit" });
    } catch (error) {
      // If build fails, print a clear message rather than silently skipping.
      // This ensures CI catches build failures immediately.
      console.error("Global setup: npm run build failed. Tests may fail without a prior build.");
      console.error((error as Error).message);
    }
  }
}
