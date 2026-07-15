import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeLegacyFile,
  type LegacyOutputOptions,
} from "../../src/compatibility/legacyOutput.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cdb-legacy-security-"));
  temporaryRoots.push(root);
  return root;
}

function securityOptions(callback: NonNullable<LegacyOutputOptions["beforePublish"]>): LegacyOutputOptions {
  return { beforePublish: callback };
}

describe.skip("legacy output security boundary (native security contract)", () => {
  it("rejects an output directory symlink without writing through it", async () => {
    const root = makeRoot();
    const real = join(root, "real");
    const link = join(root, "link");
    mkdirSync(real);
    symlinkSync(real, link);

    const result = await writeLegacyFile(link, "cards", "{}", {
      capabilityProbe: async () => true,
    });

    expect(result.success).toBe(false);
    expect(existsSync(join(real, "cards.json"))).toBe(false);
  });

  it("publishes into the held original parent after the path is replaced", async () => {
    const root = makeRoot();
    const outputDir = join(root, "output");
    const movedDir = join(root, "output-moved");
    mkdirSync(outputDir);

    const result = await writeLegacyFile(
      outputDir,
      "cards",
      "original-parent",
      securityOptions(async () => {
        renameSync(outputDir, movedDir);
        mkdirSync(outputDir);
      }),
    );

    expect(result.success).toBe(true);
    expect(readFileSync(join(movedDir, "cards.json"), "utf8")).toBe("original-parent");
    expect(existsSync(join(outputDir, "cards.json"))).toBe(false);
  });

  it("does not clobber an externally replaced final", async () => {
    const root = makeRoot();
    const outputDir = join(root, "output");
    mkdirSync(outputDir);
    expect((await writeLegacyFile(outputDir, "cards", "original")).success).toBe(true);

    const result = await writeLegacyFile(
      outputDir,
      "cards",
      "new",
      securityOptions(async () => {
        writeFileSync(join(outputDir, "cards.json"), "external");
      }),
    );

    expect(result.success).toBe(false);
    expect(readFileSync(join(outputDir, "cards.json"), "utf8")).toBe("external");
  });

  it("refuses output when the capability probe is unsupported before directory creation", async () => {
    const root = makeRoot();
    const outputDir = join(root, "missing", "output");
    const result = await writeLegacyFile(outputDir, "cards", "{}", {
      capabilityProbe: async () => false,
    });

    expect(result.success).toBe(false);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("preserves the existing final and cleans private state after an injected failure", async () => {
    const root = makeRoot();
    const outputDir = join(root, "output");
    mkdirSync(outputDir);
    expect((await writeLegacyFile(outputDir, "cards", "preserved")).success).toBe(true);

    const result = await writeLegacyFile(outputDir, "cards", "discarded", {
      beforePublish: async () => {
        throw new Error("injected publication failure");
      },
    });

    expect(result.success).toBe(false);
    expect(readFileSync(join(outputDir, "cards.json"), "utf8")).toBe("preserved");
    expect(readdirSync(outputDir).filter((name) => name.includes("cdb-legacy")).length).toBe(0);
  });
});
