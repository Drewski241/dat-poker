import { describe, expect, it } from "vitest";
import { expandWalletPath } from "./sage-wallet-rpc.js";
import { buildSageCatGiftOfferRequest } from "./sage-payout-offer.js";

describe("expandWalletPath", () => {
  it("expands leading tilde", () => {
    expect(expandWalletPath("~/sage/ssl/wallet.crt")?.endsWith("/sage/ssl/wallet.crt")).toBe(true);
  });
});

describe("buildSageCatGiftOfferRequest", () => {
  it("offers CAT with no requested assets (treasury gift)", () => {
    const req = buildSageCatGiftOfferRequest({
      assetId: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
      amountMojos: 50_000n,
      feeMojos: 0n,
    });
    expect(req).toEqual({
      offered_assets: [
        {
          asset_id: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
          amount: 50_000,
        },
      ],
      requested_assets: [],
      fee: 0,
      expiration_seconds: null,
    });
  });
});
