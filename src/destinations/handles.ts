/**
 * Opaque handle types for the native secure destination adapter.
 *
 * These are branding symbols used to create unique nominal types in TypeScript.
 * The actual handle data is stored in native code and is opaque to TypeScript.
 */

/**
 * Brand symbol for ParentHandle.
 */
export const ParentHandleBrand = Symbol("ParentHandle");

/**
 * Brand symbol for SourceHandle.
 */
export const SourceHandleBrand = Symbol("SourceHandle");

/**
 * Brand symbol for LeaseHandle.
 */
export const LeaseHandleBrand = Symbol("LeaseHandle");

/**
 * Brand symbol for TempHandle.
 */
export const TempHandleBrand = Symbol("TempHandle");

/**
 * Brand symbol for StageHandle.
 */
export const StageHandleBrand = Symbol("StageHandle");

/**
 * Brand symbol for StageChildHandle.
 */
export const StageChildHandleBrand = Symbol("StageChildHandle");

/**
 * Type alias for the branding pattern.
 */
export type NativeHandle = {
  readonly _brand: unique symbol;
};
