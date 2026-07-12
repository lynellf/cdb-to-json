/**
 * CLI diagnostic renderer.
 * Receives explicit output stream instead of using console global.
 */

import { Writable } from "node:stream";
import type { Diagnostic } from "../diagnostics/codes.js";

/**
 * Render diagnostics as text.
 */
export function renderDiagnosticsText(
  diagnostics: readonly Diagnostic[],
  stderr: Writable
): void {
  for (const d of diagnostics) {
    const prefix = d.severity === "ERROR" ? "[ERROR]" :
                   d.severity === "WARNING" ? "[WARNING]" : "[INFO]";

    let message = `${prefix} ${d.code}: ${d.message}`;

    if (d.source) {
      const parts: string[] = [];
      if (d.source.database) parts.push(`database=${d.source.database}`);
      if (d.source.table) parts.push(`table=${d.source.table}`);
      if (d.source.cardId) parts.push(`cardId=${d.source.cardId}`);
      if (d.source.column) parts.push(`column=${d.source.column}`);

      if (parts.length > 0) {
        message += ` (${parts.join(", ")})`;
      }
    }

    stderr.write(message + "\n");
  }
}

/**
 * Render diagnostics as JSON.
 */
export function renderDiagnosticsJson(
  diagnostics: readonly Diagnostic[],
  stderr: Writable,
  pretty: boolean = false
): void {
  const output = JSON.stringify(diagnostics, null, pretty ? 2 : undefined);
  stderr.write(output + "\n");
}

/**
 * Render diagnostics as JSON Lines (one object per line).
 */
export function renderDiagnosticsJsonLines(
  diagnostics: readonly Diagnostic[],
  stderr: Writable
): void {
  for (const d of diagnostics) {
    stderr.write(JSON.stringify(d) + "\n");
  }
}

/**
 * Render diagnostics based on format.
 */
export function renderDiagnostics(
  diagnostics: readonly Diagnostic[],
  format: "text" | "json" | "jsonl" | "none",
  stderr: Writable
): void {
  if (format === "none" || diagnostics.length === 0) {
    return;
  }

  switch (format) {
    case "json":
      renderDiagnosticsJson(diagnostics, stderr);
      break;
    case "jsonl":
      renderDiagnosticsJsonLines(diagnostics, stderr);
      break;
    case "text":
    default:
      renderDiagnosticsText(diagnostics, stderr);
      break;
  }
}