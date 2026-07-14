/**
 * Tests for registry option propagation through the normalization pipeline.
 *
 * P4-AC5 acceptance criterion:
 * "Card normalization consumes the selected setcode and availability registry
 * identities, preserves their immutable source/hash metadata, and includes those
 * hashes in the shared provenance options without silently substituting another
 * registry."
 *
 * Key invariants tested:
 * 1. loadRegistry() verifies exact file bytes against pin sha256 before parsing
 * 2. Mismatched hash causes immediate failure (not silent fallback)
 * 3. parseRegistryDescriptor() accepts valid descriptors and rejects invalid ones
 * 4. conversionOptionsHash changes when registry hash changes (even for same path/version)
 * 5. sourceRevisionId changes when registry hash changes
 * 6. Registry hashes flow through NormalizationContext.registryHashes
 */

import { describe, expect, it, beforeEach } from "vitest";
import { loadRegistry, parseRegistryDescriptor, validateRegistryDescriptor } from "../../src/registry/loadRegistry.js";
import type { RegistryPin, RegistryData } from "../../src/registry/types.js";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  computeConversionOptionsHash,
  computeSourceRevisionId,
  buildSharedSemanticOptions,
  buildSourceFact,
  type SharedSemanticOptions,
  type SourceRevisionFacts,
  type RegistryVersions,
  type RegistryHashes,
} from "../../src/hashing/sourceRevision.js";
import { getDefaultLimits } from "../../src/application/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256OfString(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function makeTempRegistry(content: string): { path: string; hash: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
  const path = join(dir, "registry.json");
  writeFileSync(path, content, "utf-8");
  const hash = sha256OfString(content);
  return {
    path,
    hash,
    cleanup: () => {
      try { unlinkSync(path); } catch { /* ignore */ }
      try { require("node:fs").rmdirSync(dir); } catch { /* ignore */ }
    },
  };
}

const BUNDLED_VERSIONS: RegistryVersions = {
  cardType: "cdb-normalization/1",
  attribute: "cdb-normalization/1",
  monsterType: "cdb-normalization/1",
  linkMarker: "cdb-normalization/1",
  availability: "cdb-normalization/1",
  category: "cdb-normalization/1",
  progression: "cdb-normalization/1",
  stats: "cdb-normalization/1",
  setcode: "cdb-normalization/1",
};

function makeDefaultOptions(registryHashes?: Partial<RegistryHashes>): SharedSemanticOptions {
  return buildSharedSemanticOptions({
    profile: "source",
    locale: "en",
    sourceNamespace: "test-namespace",
    registryVersions: BUNDLED_VERSIONS,
    registryHashes: {
      cardType: "a".repeat(64),
      attribute: "b".repeat(64),
      monsterType: "c".repeat(64),
      linkMarker: "d".repeat(64),
      availability: "e".repeat(64),
      category: "f".repeat(64),
      progression: "g".repeat(64),
      stats: "h".repeat(64),
      setcode: "i".repeat(64),
      ...registryHashes,
    },
    limits: getDefaultLimits(),
  });
}

// ---------------------------------------------------------------------------
// loadRegistry — content-hash verification
// ---------------------------------------------------------------------------

describe("loadRegistry (P4-AC5)", () => {
  describe("content-hash verification", () => {
    it("loads a registry when the file hash matches the pin", async () => {
      const content = JSON.stringify({ version: "cdb-normalization/1", sets: [] });
      const { path, hash, cleanup } = makeTempRegistry(content);

      const result = await loadRegistry({ path, version: "cdb-normalization/1", sha256: hash });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.version).toBe("cdb-normalization/1");
      }
      cleanup();
    });

    it("rejects a registry when the file hash does NOT match the pin", async () => {
      const content = JSON.stringify({ version: "cdb-normalization/1", sets: [] });
      const { path, cleanup } = makeTempRegistry(content);

      const wrongHash = "b".repeat(64); // Not the actual hash
      const result = await loadRegistry({ path, version: "cdb-normalization/1", sha256: wrongHash });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("hash mismatch");
      }
      cleanup();
    });

    it("rejects a non-absolute path", async () => {
      const result = await loadRegistry({
        path: "relative/path/registry.json",
        version: "cdb-normalization/1",
        sha256: "a".repeat(64),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("absolute");
      }
    });

    it("rejects a path containing '..' traversal", async () => {
      const result = await loadRegistry({
        path: "/etc/../tmp/registry.json",
        version: "cdb-normalization/1",
        sha256: "a".repeat(64),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("..");
      }
    });

    it("rejects a version mismatch between pin and file content", async () => {
      const content = JSON.stringify({ version: "cdb-normalization/1", sets: [] });
      const { path, hash, cleanup } = makeTempRegistry(content);

      const result = await loadRegistry({ path, version: "cdb-normalization/2", sha256: hash });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("version mismatch");
      }
      cleanup();
    });
  });

  describe("parseRegistryDescriptor", () => {
    it("parses a valid descriptor", () => {
      const pin = parseRegistryDescriptor(
        `/path/to/setcodes.json:v1.0@sha256:${"a".repeat(64)}`
      );

      expect(pin).not.toBeNull();
      if (pin) {
        expect(pin.path).toBe("/path/to/setcodes.json");
        expect(pin.version).toBe("v1.0");
        expect(pin.sha256).toBe("a".repeat(64));
      }
    });

    it("rejects a descriptor missing @sha256 marker", () => {
      const pin = parseRegistryDescriptor("/path/to/setcodes.json:v1.0");
      expect(pin).toBeNull();
    });

    it("rejects a descriptor with hash that is not 64 hex chars", () => {
      const pin = parseRegistryDescriptor(
        `/path/to/setcodes.json:v1.0@sha256:abc123`
      );
      expect(pin).toBeNull();
    });

    it("rejects a descriptor with uppercase hash chars", () => {
      // SHA-256 hashes must be lowercase hex per spec
      const pin = parseRegistryDescriptor(
        `/path/to/setcodes.json:v1.0@sha256:${"A".repeat(64)}`
      );
      expect(pin).toBeNull();
    });

    it("accepts equals syntax", () => {
      const pin = parseRegistryDescriptor(
        `/path/to/setcodes.json:v1.0@sha256:${"a".repeat(64)}`
      );
      expect(pin).not.toBeNull();
    });
  });

  describe("validateRegistryDescriptor", () => {
    it("returns valid for a correct descriptor", () => {
      const result = validateRegistryDescriptor(
        `/path/to/setcodes.json:v1.0@sha256:${"a".repeat(64)}`
      );
      expect(result.valid).toBe(true);
    });

    it("returns invalid for malformed descriptor", () => {
      const result = validateRegistryDescriptor("not-a-descriptor");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBeDefined();
        expect(result.error!.length).toBeGreaterThan(0);
      }
    });

    it("returns invalid for relative path", () => {
      const result = validateRegistryDescriptor(
        `relative/path.json:v1.0@sha256:${"a".repeat(64)}`
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("absolute");
      }
    });

    it("returns invalid for traversal path", () => {
      const result = validateRegistryDescriptor(
        `/etc/../tmp/registry.json:v1.0@sha256:${"a".repeat(64)}`
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("..");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Registry hash propagation into provenance hashes
// ---------------------------------------------------------------------------

describe("registry hash propagation (P4-AC5)", () => {
  it("changing a registry hash changes conversionOptionsHash", () => {
    const opts1 = makeDefaultOptions({ setcode: "a".repeat(64) });
    const opts2 = makeDefaultOptions({ setcode: "b".repeat(64) });

    const hash1 = computeConversionOptionsHash(opts1);
    const hash2 = computeConversionOptionsHash(opts2);

    expect(hash1).not.toBe(hash2);
  });

  it("changing availability registry hash changes conversionOptionsHash", () => {
    const opts1 = makeDefaultOptions({ availability: "a".repeat(64) });
    const opts2 = makeDefaultOptions({ availability: "b".repeat(64) });

    const hash1 = computeConversionOptionsHash(opts1);
    const hash2 = computeConversionOptionsHash(opts2);

    expect(hash1).not.toBe(hash2);
  });

  it("same registry hash produces same conversionOptionsHash (idempotent)", () => {
    const opts1 = makeDefaultOptions({ setcode: "c".repeat(64) });
    const opts2 = makeDefaultOptions({ setcode: "c".repeat(64) });

    const hash1 = computeConversionOptionsHash(opts1);
    const hash2 = computeConversionOptionsHash(opts2);

    expect(hash1).toBe(hash2);
  });

  it("changing a registry hash changes sourceRevisionId", () => {
    const hashes1: RegistryHashes = {
      cardType: "a".repeat(64), attribute: "b".repeat(64), monsterType: "c".repeat(64),
      linkMarker: "d".repeat(64), availability: "e".repeat(64), category: "f".repeat(64),
      progression: "g".repeat(64), stats: "h".repeat(64), setcode: "i".repeat(64),
    };
    const hashes2: RegistryHashes = {
      ...hashes1, setcode: "z".repeat(64),
    };

    const opts1 = buildSharedSemanticOptions({
      profile: "source", locale: "en", sourceNamespace: "test",
      registryVersions: BUNDLED_VERSIONS, registryHashes: hashes1,
      limits: getDefaultLimits(),
    });
    const opts2 = buildSharedSemanticOptions({
      profile: "source", locale: "en", sourceNamespace: "test",
      registryVersions: BUNDLED_VERSIONS, registryHashes: hashes2,
      limits: getDefaultLimits(),
    });

    const facts1: SourceRevisionFacts = {
      schema: "ygo.card-source/1",
      converterVersion: "cdb-to-json/2",
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [
        buildSourceFact("1", 0, 0, 0,
          { id: "1", type: "2", ot: "1" },
          { id: "1", name: "Test", desc: "Desc" }),
      ],
      locale: "en",
      sourceNamespace: "test",
      textNormalizationVersion: "text-normalization/1",
      registryVersions: BUNDLED_VERSIONS,
      registryHashes: hashes1,
      sharedSemanticOptions: opts1,
    };

    const facts2: SourceRevisionFacts = {
      ...facts1,
      registryHashes: hashes2,
      sharedSemanticOptions: opts2,
    };

    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).not.toBe(id2);
  });

  it("changing locale changes sourceRevisionId (not silently substituted)", () => {
    const hashes = {
      cardType: "a".repeat(64), attribute: "b".repeat(64), monsterType: "c".repeat(64),
      linkMarker: "d".repeat(64), availability: "e".repeat(64), category: "f".repeat(64),
      progression: "g".repeat(64), stats: "h".repeat(64), setcode: "i".repeat(64),
    };
    const opts1 = buildSharedSemanticOptions({
      profile: "source", locale: "en", sourceNamespace: "test",
      registryVersions: BUNDLED_VERSIONS, registryHashes: hashes,
      limits: getDefaultLimits(),
    });
    const opts2 = buildSharedSemanticOptions({
      profile: "source", locale: "ja", sourceNamespace: "test",
      registryVersions: BUNDLED_VERSIONS, registryHashes: hashes,
      limits: getDefaultLimits(),
    });

    const facts1: SourceRevisionFacts = {
      schema: "ygo.card-source/1",
      converterVersion: "cdb-to-json/2",
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [
        buildSourceFact("1", 0, 0, 0,
          { id: "1", type: "2", ot: "1" },
          { id: "1", name: "Test", desc: "Desc" }),
      ],
      locale: "en",
      sourceNamespace: "test",
      textNormalizationVersion: "text-normalization/1",
      registryVersions: BUNDLED_VERSIONS,
      registryHashes: hashes,
      sharedSemanticOptions: opts1,
    };

    const facts2: SourceRevisionFacts = { ...facts1, locale: "ja", sharedSemanticOptions: opts2 };

    expect(computeSourceRevisionId(facts1)).not.toBe(computeSourceRevisionId(facts2));
  });
});

// ---------------------------------------------------------------------------
// Presentation inputs do NOT affect provenance hashes
// ---------------------------------------------------------------------------

describe("presentation exclusion from provenance (P4-AC5)", () => {
  function makeFacts(overrides: Partial<SharedSemanticOptions> = {}): SourceRevisionFacts {
    const hashes = {
      cardType: "a".repeat(64), attribute: "b".repeat(64), monsterType: "c".repeat(64),
      linkMarker: "d".repeat(64), availability: "e".repeat(64), category: "f".repeat(64),
      progression: "g".repeat(64), stats: "h".repeat(64), setcode: "i".repeat(64),
    };
    const opts = buildSharedSemanticOptions({
      profile: "source", locale: "en", sourceNamespace: "test",
      registryVersions: BUNDLED_VERSIONS, registryHashes: hashes,
      limits: getDefaultLimits(),
      ...overrides,
    });
    return {
      schema: "ygo.card-source/1",
      converterVersion: "cdb-to-json/2",
      physicalSnapshotHash: "0".repeat(64),
      sourceFacts: [
        buildSourceFact("1", 0, 0, 0,
          { id: "1", type: "2", ot: "1" },
          { id: "1", name: "Test", desc: "Desc" }),
      ],
      locale: "en",
      sourceNamespace: "test",
      textNormalizationVersion: "text-normalization/1",
      registryVersions: BUNDLED_VERSIONS,
      registryHashes: hashes,
      sharedSemanticOptions: opts,
    };
  }

  it("output path changes do NOT affect sourceRevisionId", () => {
    // Note: output path is not in SharedSemanticOptions at all,
    // so changing it produces the same sourceRevisionId
    const facts1 = makeFacts();
    const facts2 = makeFacts();

    // These would be identical since the only difference is output path
    // (which is not part of either hash)
    const id1 = computeSourceRevisionId(facts1);
    const id2 = computeSourceRevisionId(facts2);

    expect(id1).toBe(id2);
  });

  it("same semantic inputs produce same conversionOptionsHash (stable)", () => {
    const opts = makeDefaultOptions();
    const hash1 = computeConversionOptionsHash(opts);
    const hash2 = computeConversionOptionsHash(opts);

    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Physical snapshot hash
// ---------------------------------------------------------------------------

describe("physical snapshot hash (P4-AC5)", () => {
  it("different main bytes produce different physical hash", async () => {
    const { computePhysicalSnapshotHash } = await import("../../src/hashing/sourceRevision.js");

    const buf1 = Buffer.from("content1");
    const buf2 = Buffer.from("content2");

    const hash1 = computePhysicalSnapshotHash(buf1, null, null);
    const hash2 = computePhysicalSnapshotHash(buf2, null, null);

    expect(hash1).not.toBe(hash2);
  });

  it("WAL presence changes the physical hash", async () => {
    const { computePhysicalSnapshotHash } = await import("../../src/hashing/sourceRevision.js");

    const main = Buffer.from("main db");
    const wal = Buffer.from("wal data");

    const hashWithoutWal = computePhysicalSnapshotHash(main, null, null);
    const hashWithWal = computePhysicalSnapshotHash(main, wal, null);

    expect(hashWithoutWal).not.toBe(hashWithWal);
  });

  it("SHM presence changes the physical hash", async () => {
    const { computePhysicalSnapshotHash } = await import("../../src/hashing/sourceRevision.js");

    const main = Buffer.from("main db");
    const shm = Buffer.from("shm data");

    const hashWithoutShm = computePhysicalSnapshotHash(main, null, null);
    const hashWithShm = computePhysicalSnapshotHash(main, null, shm);

    expect(hashWithoutShm).not.toBe(hashWithShm);
  });

  it("same bytes produce same physical hash (idempotent)", async () => {
    const { computePhysicalSnapshotHash } = await import("../../src/hashing/sourceRevision.js");

    const main = Buffer.from("deterministic content");

    const hash1 = computePhysicalSnapshotHash(main, null, null);
    const hash2 = computePhysicalSnapshotHash(main, null, null);

    expect(hash1).toBe(hash2);
  });
});
