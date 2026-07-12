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
   * Promote WARNING diagnostics to ERROR.
   * This is used by strict mode.
   */
  promote(strict: boolean): void {
    if (!strict) return;
    for (const d of this.diagnostics) {
      if (d.severity === "WARNING") {
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