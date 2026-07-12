/**
 * Compatibility shim for v1.x import path.
 *
 * This file exists so existing repository consumers importing `app/index.js`
 * continue to work after the TypeScript build. It re-exports the built
 * legacy module from the dist directory.
 *
 * @deprecated Use the named exports from the package root instead.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from the built legacy module
const legacyModule = await import(join(__dirname, "..", "dist", "legacy.js"));
export default legacyModule.default;