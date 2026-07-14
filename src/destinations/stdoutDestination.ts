/**
 * Stdout destination writer.
 *
 * A simple writer abstraction for stdout output.
 * Stdout is non-atomic by contract — a late error may leave earlier bytes.
 *
 * The stream must be provided by the caller; no process-global default is used.
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
 * @param stream - The writable stream to write to (required, no default)
 */
export function createStdoutDestination(stream: Writable): Writer {
  return {
    write(data: string): void {
      stream.write(data);
    },
  };
}
