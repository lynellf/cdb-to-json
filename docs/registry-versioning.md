# Registry Versioning and Provenance

This document records the immutable source, revision, and content-hash metadata for every registry used by the CDB-to-JSON converter. Each registry maps raw integer fields to named semantic values; the mapping itself is versioned and content-addressed.

## Principles

1. **Immutable source citation** — Every registry is tied to an authoritative upstream source. The source is recorded verbatim and never substituted.
2. **Content-addressed pins** — When a registry is loaded for conversion, it is loaded via a `RegistryPin`: `{ path, version, sha256 }`. The SHA-256 is computed over the exact file bytes (not UTF-8 decoded text) before any JSON parsing or decoding occurs.
3. **Independent version vectors** — Each normalization family (card type, attribute, monster type, link marker, availability, category, progression, stats, setcode) carries its own version string. A change to the availability registry does not bump the card-type registry version, and vice versa.
4. **Bundled defaults are pinned** — When no custom registry is provided, the converter uses the bundled default registries. Those bundled registries are themselves content-addressed; their hashes are part of the `sourceRevisionId` and `conversionOptionsHash`.
5. **Substitution is prohibited** — If a selected registry cannot be loaded or its hash does not match the pin, the converter must fail with a stable diagnostic rather than silently falling back to a different registry or omitting the mapping.

## Registry Inventory

All registries share the base version `cdb-normalization/1` (the YGOPro normalization contract). Each family may evolve independently within that contract.

| Registry | Version constant | Source | Bit domain | Maps to |
|---|---|---|---|---|
| Card Types | `CARD_TYPE_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/yugiotypes.conf`) | `type` field bitmask | `kind`, `trait[]` |
| Attributes | `ATTRIBUTE_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/attribute.conf`) | `attribute` field integer | `attribute` enum |
| Monster Types | `MONSTER_TYPE_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/type.conf`) | `type` field bitmask | `monsterType[]` |
| Link Markers | `LINK_MARKER_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/link.conf`) | `linkMarker` field bitmask | `linkMarkers[]` |
| Availability | `AVAILABILITY_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/ot.conf`) | `ot` field integer | `availability` flags |
| Categories | `CATEGORY_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/category.conf`) | `category` field bitmask | `category[]` |
| Progression | `PROGRESSION_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/level.conf`) | `level` field packed integer | `level`, `rank`, `linkRating`, `pendulumScale[]` |
| Stats | `STATS_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/atkdef.conf`) | `atk`, `def` fields | `attack`, `defense` integers (or sentinel for unknown) |
| Setcodes | `SETCODE_VERSION` | Project Ignis YGOPro (`YGOPro/peristyle/setcodes.conf`) | `setcode` field packed 32-bit integer | `setcode[]` archetype names |

## Registry Pin Structure

```typescript
interface RegistryPin {
  /** Absolute path to the registry file */
  path: string;
  /** Version string (e.g. "cdb-normalization/1") */
  version: string;
  /** SHA-256 hash of the exact file bytes (lowercase hex, 64 chars) */
  sha256: string;
}
```

The pin is validated at load time via `loadRegistry(pin)`:

1. Path must be absolute and must not contain `..` (traversal guard).
2. File bytes are read and hashed with SHA-256.
3. The computed hash must equal `pin.sha256` byte-for-byte.
4. JSON decoding happens only after hash verification.
5. The JSON `data.version` field must match `pin.version`.

## Content Hash in Provenance

Each registry's content hash flows into two places:

### `conversionOptionsHash`

A canonical SHA-256 over the **shared semantic options object**, which includes the hashes of every registry that was loaded (whether bundled or custom-selected). The shared semantic options object is defined as:

```typescript
interface SharedSemanticOptions {
  profile: OutputProfile;        // "raw" | "card" | "source"
  locale: string | null;         // normalized locale (e.g. "en" or "und")
  sourceNamespace: string;       // e.g. "cdb-to-json"
  textNormalizationVersion: string;  // "text-normalization/1"
  registryVersions: {
    cardType: string;
    attribute: string;
    monsterType: string;
    linkMarker: string;
    availability: string;
    category: string;
    progression: string;
    stats: string;
    setcode: string;
  };
  registryHashes: {
    cardType: string;    // sha256 of the loaded card-type registry
    attribute: string;
    monsterType: string;
    linkMarker: string;
    availability: string;
    category: string;
    progression: string;
    stats: string;
    setcode: string;
  };
  limits: {
    maxRowsPerTable: number;
    maxTextBytes: number;
    maxOutputBytes: number;
    maxStagingBytes: number;
    maxSpoolBytes: number;
    maxSnapshotBytes: number;
  };
}
```

`conversionOptionsHash` = SHA-256 of the canonical JSON of the above object. Output path, format, pretty flag, diagnostic rendering, and timing are **excluded**.

### `sourceRevisionId`

A deterministic ID computed from the **canonical source-facts/lineage object** (`canonical-json/cdb-to-json/source-revision/v1`). This object includes:

- Schema/profile identifier (`"ygo.card-source/1"`)
- Converter major version
- Verified physical snapshot-bundle SHA-256 (of the CDB file bundle including `-wal` and `-shm` when present)
- All contributing raw facts and canonical data/text ordinals (exact decimal-string integers)
- Row identity (sorted by `(cardId, inputOrdinal)`)
- Normalized locale/`und`
- Source namespace
- **Registry versions and content hashes** (same as in `SharedSemanticOptions`)
- `text-normalization/1` version
- The full `SharedSemanticOptions` object

Output path, format, pretty-printing, diagnostic rendering, timing, and lock tokens are **excluded**.

## Custom Registry Override

Users may select alternative registries via CLI options:

```
--setcode-registry=<path>:<version>@sha256:<hash>
--availability-registry=<path>:<version>@sha256:<hash>
```

These pins are validated **before** any SQLite open (pre-discovery). If a pin is invalid or its hash does not match, the converter exits with a stable diagnostic and does not open the database.

When a custom registry is provided, the bundled default for that family is **not used**. The custom registry's version and hash are substituted into `registryVersions`, `registryHashes`, and ultimately into `conversionOptionsHash` and `sourceRevisionId`.

## Stop Conditions

- If a registry source cannot be cited immutably, stop.
- If a decoder guesses an unknown bit or precedence, stop and emit a diagnostic.
- If a selected registry's content hash does not match its pin, stop before opening the database.

## References

- Project Ignis YGOPro: <https://github.com/Fluorohydride/ygopro>
- Canonical JSON: `src/hashing/sha256.ts` (`canonicalJson`, `canonicalSha256`)
- Registry loader: `src/registry/loadRegistry.ts` (`loadRegistry`, `parseRegistryDescriptor`, `validateRegistryDescriptor`)
- Registry types: `src/registry/types.ts` (`RegistryPin`, `RegistryConfig`)
- Normalization context: `src/application/types.ts` (`NormalizationContext`, `NormalizedConvertOptions`)
