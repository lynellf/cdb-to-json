import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireSnapshotBundle } from "../../src/cdb/snapshotBundle.js";
import { acquireSourceHandle } from "../../src/cdb/sourceHandle.js";
import { DiagnosticCollector } from "../../src/diagnostics/collector.js";
import { DiagnosticCode } from "../../src/diagnostics/codes.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cdb-source-mutation-"));
  temporaryRoots.push(root);
  return root;
}

describe("same-inode source mutation", () => {
  it("rejects main bytes changed without an inode or size change", async () => {
    const root = makeRoot();
    const source = join(root, "source.cdb");
    writeFileSync(source, Buffer.from("main-before"));
    const handle = acquireSourceHandle(source);

    try {
      writeFileSync(source, Buffer.from("main-after!"));
      const diagnostics = new DiagnosticCollector();

      await expect(
        acquireSnapshotBundle(handle, root, undefined, diagnostics),
      ).rejects.toThrow(/mutat/i);
      expect(
        diagnostics.getErrors().some(
          (diagnostic) => diagnostic.code === DiagnosticCode.SOURCE_MUTATED_DURING_READ,
        ),
      ).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it.each(["-wal", "-shm"] as const)(
    "rejects same-inode %s mutation after member acquisition",
    async (suffix) => {
      const root = makeRoot();
      const source = join(root, "source.cdb");
      writeFileSync(source, Buffer.from("main"));
      writeFileSync(`${source}${suffix}`, Buffer.from(`${suffix}-before`));
      const handle = acquireSourceHandle(source);
      const originalOpenMember = handle.openMember.bind(handle);

      handle.openMember = async (memberSuffix) => {
        const result = await originalOpenMember(memberSuffix);
        if (result && memberSuffix === suffix) {
          writeFileSync(`${source}${suffix}`, Buffer.from(`${suffix}-after!`));
        }
        return result;
      };

      try {
        const diagnostics = new DiagnosticCollector();
        await expect(
          acquireSnapshotBundle(handle, root, undefined, diagnostics),
        ).rejects.toThrow(/mutat/i);
        expect(
          diagnostics.getErrors().some(
            (diagnostic) => diagnostic.code === DiagnosticCode.SOURCE_MUTATED_DURING_READ,
          ),
        ).toBe(true);
      } finally {
        await handle.close();
      }
    },
  );
});
