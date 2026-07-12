/**
 * Tests for integer encoding and canonical ordering.
 *
 * Validates that IDs are encoded as signed-int64 decimal strings
 * and that canonical numeric ordering is correct.
 */

import { describe, it, expect } from "vitest";

describe("Integer encoding", () => {
  it("valid IDs are encoded as decimal strings", () => {
    const ids = [
      { input: 0n, expected: "0" },
      { input: 2n, expected: "2" },
      { input: 10n, expected: "10" },
      { input: -2n, expected: "-2" },
      { input: -(2n ** 63n), expected: "-9223372036854775808" },
      { input: 2n ** 63n - 1n, expected: "9223372036854775807" },
    ];

    for (const { input, expected } of ids) {
      expect(String(input)).toBe(expected);
    }
  });

  it("canonical ordering sorts by signed numeric value", () => {
    const ids = ["-2", "0", "2", "10", "-9223372036854775808", "9223372036854775807"];
    const sorted = [...ids].sort((a, b) => {
      return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
    });

    expect(sorted).toEqual([
      "-9223372036854775808",
      "-2",
      "0",
      "2",
      "10",
      "9223372036854775807",
    ]);
  });

  it("same logical rows in different order produce same canonical IDs", () => {
    const ids1 = ["0", "1", "10", "100"];
    const ids2 = ["1", "100", "0", "10"];

    const sorted1 = [...ids1].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
    );
    const sorted2 = [...ids2].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
    );

    expect(sorted1).toEqual(sorted2);
    expect(sorted1).toEqual(["0", "1", "10", "100"]);
  });
});

describe("Integer range validation", () => {
  it("signed 64-bit min boundary", () => {
    const min = -(2n ** 63n);
    expect(String(min)).toBe("-9223372036854775808");
  });

  it("signed 64-bit max boundary", () => {
    const max = 2n ** 63n - 1n;
    expect(String(max)).toBe("9223372036854775807");
  });
});