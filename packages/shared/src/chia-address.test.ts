import { describe, expect, it } from "vitest";
import { decodeBech32m, decodeChiaPuzzleHash } from "./chia-address.js";

describe("chia addresses", () => {
  it("accepts the bech32m checksum constant", () => {
    expect(decodeBech32m("a1lqfn3a").data.length).toBe(0);
  });

  it("decodes an xch puzzle hash", () => {
    expect(
      decodeChiaPuzzleHash("xch1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qzarh9q"),
    ).toBe("22".repeat(32));
    expect(
      decodeChiaPuzzleHash("txch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8mkeh3"),
    ).toBe("00".repeat(32));
  });

  it("rejects a non-chia human-readable part", () => {
    expect(() => decodeChiaPuzzleHash("a1lqfn3a")).toThrow(/xch or txch/);
  });
});
