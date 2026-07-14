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
  /** Whether actual has been reconciled (vs still at initial reservation). */
  reconciled: boolean;
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
   *
   * @returns true if reservation was successful; false if it would exceed budget
   *          or if the path already has an active positive reservation.
   */
  reserve(path: string, bytes: number): boolean {
    // Check for duplicate active key first: reject before any no-op
    if (this.entries.has(path)) {
      return false;
    }

    // Non-positive requests are explicit no-ops
    if (bytes <= 0) {
      return true;
    }

    // Would exceed aggregate budget?
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
    this.entries.set(path, {
      path,
      reservedBytes: bytes,
      actualBytes: 0,
      reconciled: false,
    });
    return true;
  }

  /**
   * Reconcile actual file size against the reservation.
   *
   * @returns true if the reconciliation was accepted; false if the candidate
   *          would exceed maxBytes. On false, prior accounting is preserved
   *          and RESOURCE_LIMIT_EXCEEDED is emitted.
   */
  reconcile(path: string, actualBytes: number): boolean {
    const entry = this.entries.get(path);
    if (!entry) {
      // Unknown key: no-op, return true
      return true;
    }

    // Compute the baseline for delta calculation:
    // - If not yet reconciled: use the original reservation
    // - If already reconciled: use the latest actual
    const baseline = entry.reconciled ? entry.actualBytes : entry.reservedBytes;
    const diff = actualBytes - baseline;
    const newTotal = this.reservedBytes + diff;

    // Would the delta push us over the aggregate limit?
    if (newTotal > this.maxBytes) {
      this.diagnostics?.error(
        DiagnosticCode.RESOURCE_LIMIT_EXCEEDED,
        `Aggregate staging budget exceeded during reconcile: ${newTotal} > ${this.maxBytes}`,
        {
          details: {
            limitCode: "MAX_STAGING_EXCEEDED",
            reservedBytes: this.reservedBytes,
            candidateActualBytes: actualBytes,
            diff,
            maxBytes: this.maxBytes,
          },
        }
      );
      // Return false: caller must abort, prior accounting preserved
      return false;
    }

    // Accepted: update accounting
    this.reservedBytes = newTotal;
    entry.actualBytes = actualBytes;
    entry.reconciled = true;
    return true;
  }

  /**
   * Release all bytes for a staging file path.
   *
   * Subtracts the latest accounted amount (actual if reconciled,
   * otherwise the original reservation). Repeated or unknown release is a no-op.
   */
  release(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) {
      // Unknown path: no-op
      return;
    }

    // Subtract the latest accounted amount
    const bytesToRelease = entry.reconciled
      ? entry.actualBytes
      : entry.reservedBytes;
    this.reservedBytes -= bytesToRelease;
    this.entries.delete(path);
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