/**
 * Registry types for content-addressed registry loading.
 */

/**
 * A registry pin specifies the content-addressed identity of a registry.
 */
export interface RegistryPin {
  /** Absolute path to the registry file */
  path: string;
  /** Version string for the registry */
  version: string;
  /** SHA-256 hash of the registry content */
  sha256: string;
}

/**
 * The result of loading a registry.
 */
export interface RegistryLoadResult {
  /** Whether loading succeeded */
  success: boolean;
  /** Loaded registry data (if successful) */
  data?: RegistryData;
  /** Error message (if unsuccessful) */
  error?: string;
}

/**
 * Base interface for registry data.
 */
export interface RegistryData {
  /** Registry version string */
  version: string;
  /** Registry metadata */
  meta?: {
    description?: string;
    author?: string;
    source?: string;
    timestamp?: string;
  };
}

/**
 * Registry configuration for a conversion.
 * This is the validated descriptor shape used by the application layer.
 */
export interface RegistryConfigDescriptor {
  /** Setcode registry pin (if provided) */
  setcode?: RegistryPin;
  /** Availability registry pin (if provided) */
  availability?: RegistryPin;
}

/**
 * Normalized registry configuration used by the conversion pipeline.
 */
export interface NormalizedRegistryConfig {
  /** Setcode registry data (loaded and verified) */
  setcode?: RegistryData;
  /** Availability registry data (loaded and verified) */
  availability?: RegistryData;
  /** Whether default bundled registries are used */
  usesDefaults: boolean;
}
