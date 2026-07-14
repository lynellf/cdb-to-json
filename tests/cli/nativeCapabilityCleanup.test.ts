import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runNativeBuild } from "../../scripts/build-native.mjs";

const HOST = {
  platform: "linux",
  arch: "x64",
  nodeVersion: "v22.0.0",
  nodeAbi: "127",
  napiVersion: 10,
};

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cdb-native-capability-"));
  const sourceDir = join(root, "native", "secure-destination");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "binding.gyp"), "{}");
  return root;
}

function readManifest(root: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(root, "dist", "native", "capability.json"), "utf8"),
  ) as Record<string, unknown>;
}

function probe(supported: boolean) {
  const supportedPrimitives = supported
    ? ["openat", "openat2", "renameat2"]
    : [];
  return {
    supported,
    supportedPrimitives,
    requiredFlags: supported
      ? ["RESOLVE_BENEATH", "RESOLVE_NO_SYMLINKS"]
      : [],
    primitiveProbeResults: {
      supported,
      supportsOpenAt2: supported,
      supportsRenameAt2: supported,
      supportsNoReplace: supported,
      supportedPrimitives,
    },
  };
}

describe("native capability build cleanup", () => {
  it("removes a stale module for an unsupported host", async () => {
    const root = createRoot();
    const modulePath = join(root, "dist", "native", "secure_destination.node");
    mkdirSync(join(root, "dist", "native"), { recursive: true });
    writeFileSync(modulePath, "stale");

    try {
      const result = await runNativeBuild(
        root,
        { ...HOST, platform: "darwin" },
        () => {
          throw new Error("unsupported host must not build");
        },
        () => probe(true),
      );

      expect(result.supported).toBe(false);
      expect(result.failed).toBe(false);
      expect(existsSync(modulePath)).toBe(false);
      expect(readManifest(root).supported).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes the copied module when the post-copy probe is unsupported", async () => {
    const root = createRoot();
    let probeReached = false;

    try {
      const result = await runNativeBuild(
        root,
        HOST,
        ({ modulePath }) => writeFileSync(modulePath, "fake native module"),
        () => {
          probeReached = true;
          return probe(false);
        },
      );

      const modulePath = join(root, "dist", "native", "secure_destination.node");
      expect(probeReached).toBe(true);
      expect(result.supported).toBe(false);
      expect(result.failed).toBe(false);
      expect(existsSync(modulePath)).toBe(false);
      expect(readManifest(root)).toMatchObject({
        supported: false,
        moduleSha256: "0".repeat(64),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains only a hash-matching module for a supported probe", async () => {
    const root = createRoot();
    const contents = "fake supported native module";

    try {
      const result = await runNativeBuild(
        root,
        HOST,
        ({ modulePath }) => writeFileSync(modulePath, contents),
        () => probe(true),
      );

      const modulePath = join(root, "dist", "native", "secure_destination.node");
      const hash = createHash("sha256").update(contents).digest("hex");
      expect(result.supported).toBe(true);
      expect(result.failed).toBe(false);
      expect(readFileSync(modulePath, "utf8")).toBe(contents);
      expect(readManifest(root)).toMatchObject({
        supported: true,
        moduleSha256: hash,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans up after a malformed post-copy probe", async () => {
    const root = createRoot();

    try {
      const result = await runNativeBuild(
        root,
        HOST,
        ({ modulePath }) => writeFileSync(modulePath, "fake native module"),
        () => ({ supported: true }) as never,
      );

      expect(result.supported).toBe(false);
      expect(result.failed).toBe(true);
      expect(
        existsSync(join(root, "dist", "native", "secure_destination.node")),
      ).toBe(false);
      expect(readManifest(root).supported).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
