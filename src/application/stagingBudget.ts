/**
 * Aggregate staging budget for tracking resource usage.
 *
 * Covers snapshot bundles, materialized databases, merge spools,
 * output staging, temporary siblings, and lock records.
 */

import { DiagnosticCollector } from "../diagnostics/collector.js";
import { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Budget reservation entry.
 */
interface ReservationEntry {
  path: string;
  reservedBytes: number;
  actualBytes: number;
}

/**
 * Aggregate staging budget tracker.
 *
 * Tracks bytes reserved and reconciled for all private staging files.
 * Limit is enforced before each write.
 */
export class StagingBudget {
  private readonly maxBytes: number;
  private reservedBytes = 0;
  private readonly entries = new Map<string, ReservationEntry>();
  private readonly diagnostics?: DiagnosticCollector;

  constructor(maxBytes: number, diagnostics?: DiagnosticCollector) {
    this.maxBytes = maxBytes;
    this.diagnostics = diagnostics;
  }

  /**
   * Reserve bytes for a staging file path.
   * Throws RESOURCE_LIMIT_EXCEEDED if the aggregate budget would be exceeded.
   *
   * @returns true if reservation was successful, false if it would exceed budget
   */
  reserve(path: string, bytes: number): boolean {
    if (bytes <= 0) return true;

    const newTotal = this.reservedBytes + bytes;
    if (newTotal > this.maxBytes) {
      this.diagnostics?.error(
        DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
        `Aggregate staging budget exceeded: ${newTotal} > ${this.maxBytes}`,
        {
          details: {
            limitCode: "MAX_STAGING_EXCEEDED",
            reservedBytes: this.reservedBytes,
            requestedBytes: bytes,
            maxBytes: this.maxBytes,
          },
        }
      );
      return false;
    }

    this.reservedBytes = newTotal;
    this.entries.set(path, { path, reservedBytes: bytes, actualBytes: 0 });
    return true;
  }

  /**
   * Reconcile actual file size against the reservation.
   * Updates the actual bytes for the given path.
   */
  reconcile(path: string, actualBytes: number): void {
    const entry = this.entries.get(path);
    if (entry) {
      const diff = actualBytes - entry.actualBytes;
      this.reservedBytes += diff;
      entry.actualBytes = actualBytes;
    }
  }

  /**
   * Release all bytes for a staging file path.
   */
  release(path: string): void {
    const entry = this.entries.get(path);
    if (entry) {
      this.reservedBytes -= entry.reservedBytes;
      this.entries.delete(path);
    }
  }

  /**
   * Get the current total reserved bytes.
   */
  get currentBytes(): number {
    return this.reservedBytes;
  }

  /**
   * Get the maximum allowed bytes.
   */
  get maxBytesLimit(): number {
    return this.maxBytes;
  }

  /**
   * Get the remaining budget.
   */
  get remainingBytes(): number {
    return this.maxBytes - this.reservedBytes;
  }

  /**
   * Check if the budget allows a reservation of the given size.
   */
  canReserve(bytes: number): boolean {
    return this.reservedBytes + bytes <= this.maxBytes;
  }
}