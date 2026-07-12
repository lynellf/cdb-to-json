/**
 * Stdout destination writer.
 *
 * A simple writer abstraction for stdout output.
 * Stdout is non-atomic by contract — a late error may leave earlier bytes.
 */

import { Writable } from "node:stream";

/**
 * Simple write interface used throughout the application.
 */
export interface Writer {
  write(data: string): void;
}

/**
 * Create a stdout destination writer.
 */
export function createStdoutDestination(
  stream: Writable = process.stdout
): Writer {
  return {
    write(data: string): void {
      stream.write(data);
    },
  };
}
