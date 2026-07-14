/**
 * Diagnostic collector for tracking issues during conversion.
 */

import type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from "./codes.js";
import { createDiagnostic } from "./codes.js";

/**
 * Summary of diagnostics collected during a conversion.
 */
export interface DiagnosticSummary {
  readonly infos: readonly Diagnostic[];
  readonly warnings: readonly Diagnostic[];
  readonly errors: readonly Diagnostic[];
  readonly totalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * Diagnostic families that are promoted from WARNING to ERROR under --strict mode.
 *
 * Per limits-and-diagnostics.md (accepted contract):
 * "Unknown registry bits, incomplete joins, malformed packed fields, and ambiguous text
 * are warnings by default and errors under --strict.
 * Informational provenance and extra-table notices remain informational."
 *
 * These codes are promoted only; all others (INFO, ERROR, or WARNING outside this list)
 * are unchanged by promote().
 */
const STRICT_PROMOTE_WARNING_FAMILIES: readonly DiagnosticCode[] = [
  // Unknown bits (registry)
  "UNKNOWN_TYPE_BITS",
  "UNKNOWN_ATTRIBUTE_BITS",
  "UNKNOWN_MONSTER_TYPE_BITS",
  "UNKNOWN_LINK_MARKER_BITS",
  "UNKNOWN_AVAILABILITY_BITS",
  "UNKNOWN_CATEGORY_BITS",
  // Incomplete joins
  "MISSING_DATA_ROW",
  "MISSING_TEXT_ROW",
  // Malformed packed fields
  "INVALID_PACKED_LEVEL",
  "INVALID_PACKED_SETCODE",
  // Ambiguous text
  "AMBIGUOUS_TEXT_SEGMENTATION",
  "INVALID_TEXT_MARKER",
  // Conflicting flags
  "CONFLICTING_CARD_KIND_FLAGS",
  "CONFLICTING_SUBTYPE_FLAGS",
  "CONFLICTING_PROGRESSION_FLAGS",
] as const;

/**
 * Collector for diagnostics with support for filtering, aggregation, and strict promotion.
 */
export class DiagnosticCollector {
  private readonly diagnostics: Diagnostic[] = [];

  /**
   * Add a diagnostic to the collection.
   */
  add(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  /**
   * Add a diagnostic by code.
   */
  addDiagnostic(
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    options?: Partial<Pick<Diagnostic, "source" | "rawValue" | "details">>
  ): void {
    this.add(createDiagnostic(code, severity, message, options));
  }

  /**
   * Add an error diagnostic.
   */
  error(
    code: DiagnosticCode,
    message: string,
    options?: Partial<Pick<Diagnostic, "source" | "rawValue" | "details">>
  ): void {
    this.addDiagnostic(code, "ERROR", message, options);
  }

  /**
   * Add a warning diagnostic.
   */
  warning(
    code: DiagnosticCode,
    message: string,
    options?: Partial<Pick<Diagnostic, "source" | "rawValue" | "details">>
  ): void {
    this.addDiagnostic(code, "WARNING", message, options);
  }

  /**
   * Add an info diagnostic.
   */
  info(
    code: DiagnosticCode,
    message: string,
    options?: Partial<Pick<Diagnostic, "source" | "rawValue" | "details">>
  ): void {
    this.addDiagnostic(code, "INFO", message, options);
  }

  /**
   * Get all diagnostics.
   */
  getAll(): readonly Diagnostic[] {
    return [...this.diagnostics];
  }

  /**
   * Get diagnostics filtered by severity.
   */
  getBySeverity(severity: DiagnosticSeverity): readonly Diagnostic[] {
    return this.diagnostics.filter((d) => d.severity === severity);
  }

  /**
   * Get only errors.
   */
  getErrors(): readonly Diagnostic[] {
    return this.getBySeverity("ERROR");
  }

  /**
   * Get only warnings.
   */
  getWarnings(): readonly Diagnostic[] {
    return this.getBySeverity("WARNING");
  }

  /**
   * Get only info diagnostics.
   */
  getInfos(): readonly Diagnostic[] {
    return this.getBySeverity("INFO");
  }

  /**
   * Check if there are any errors.
   */
  hasErrors(): boolean {
    return this.getErrors().length > 0;
  }

  /**
   * Merge diagnostics from another collector into this one.
   */
  merge(other: DiagnosticCollector): void {
    this.diagnostics.push(...other.diagnostics);
  }

  /**
   * Promote WARNING diagnostics to ERROR only for the documented strict families.
   *
   * Per limits-and-diagnostics.md: unknown bits, incomplete joins, malformed
   * packed fields, and ambiguous text are warnings under normal mode and errors
   * under --strict.  Provenance and extra-table notices remain informational.
   *
   * This replaces the previous blanket promotion of all WARNINGs.
   */
  promote(strict: boolean): void {
    if (!strict) return;
    for (const d of this.diagnostics) {
      if (
        d.severity === "WARNING" &&
        (STRICT_PROMOTE_WARNING_FAMILIES as readonly string[]).includes(d.code)
      ) {
        d.severity = "ERROR";
      }
    }
  }

  /**
   * Get a summary of all diagnostics.
   */
  getSummary(): DiagnosticSummary {
    const infos = this.getInfos();
    const warnings = this.getWarnings();
    const errors = this.getErrors();

    return {
      infos,
      warnings,
      errors,
      totalCount: this.diagnostics.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    };
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this.diagnostics.length = 0;
  }

  /**
   * Get the count of diagnostics.
   */
  get count(): number {
    return this.diagnostics.length;
  }
}

/**
 * Create a new diagnostic collector.
 */
export function createCollector(): DiagnosticCollector {
  return new DiagnosticCollector();
}