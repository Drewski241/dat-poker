import { describe, expect, it } from "vitest";
import { CAT_MOJOS_PER_TOKEN, formatDatMojos, resolveDatMinBuyInMojos } from "./dat-units.js";

describe("formatDatMojos", () => {
  it("formats whole DAT tokens from CAT mojos", () => {
    expect(formatDatMojos(40_000_000n)).toBe("40000 DAT");
    expect(formatDatMojos("1000000")).toBe("1000 DAT");
  });

  it("formats fractional DAT", () => {
    expect(formatDatMojos(1500n)).toBe("1.5 DAT");
    expect(formatDatMojos(1n)).toBe("0.001 DAT");
  });

  it("uses 1000 mojos per token", () => {
    expect(CAT_MOJOS_PER_TOKEN).toBe(1000n);
  });
});

describe("resolveDatMinBuyInMojos", () => {
  it("defaults to 1000 DAT", () => {
    expect(resolveDatMinBuyInMojos(undefined)).toBe(1_000_000n);
    expect(resolveDatMinBuyInMojos("")).toBe(1_000_000n);
  });

  it("accepts valid CAT mojo buy-ins", () => {
    expect(resolveDatMinBuyInMojos("1000000")).toBe(1_000_000n);
  });

  it("rejects legacy XCH-scale min buy-in values", () => {
    expect(resolveDatMinBuyInMojos("2000000000000")).toBe(1_000_000n);
  });
});
