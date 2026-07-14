/**
 * Temporary directory helper for tests.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Simple temporary directory that auto-cleans on cleanup.
 */
export class TemporaryDirectory {
  public readonly path: string;

  constructor(prefix = "cdb-test-") {
    this.path = mkdtempSync(join(tmpdir(), prefix));
  }

  cleanup(): void {
    if (existsSync(this.path)) {
      rmSync(this.path, { recursive: true, force: true });
    }
  }
}
