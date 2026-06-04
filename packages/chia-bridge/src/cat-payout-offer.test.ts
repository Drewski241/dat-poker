import { describe, expect, it } from "vitest";
import { buildCatGiftOfferRequest } from "./cat-payout-offer.js";

describe("buildCatGiftOfferRequest", () => {
  it("builds a negative CAT offer entry (treasury gives tokens)", () => {
    const req = buildCatGiftOfferRequest({
      assetId: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
      amountMojos: 50_000n,
      feeMojos: 0n,
    });
    expect(req.offer).toEqual({
      d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c: -50_000,
    });
    expect(req.fee).toBe(0);
    expect(req.validate_only).toBe(false);
  });
});
