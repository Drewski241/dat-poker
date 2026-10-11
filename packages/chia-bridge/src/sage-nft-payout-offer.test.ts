import { describe, expect, it } from "vitest";
import { buildSageNftGiftOfferRequest } from "./sage-nft-payout-offer.js";

describe("buildSageNftGiftOfferRequest", () => {
  it("offers an NFT as an OfferAmount sequence with fee and receive address", () => {
    const nftId = "nft1mkl29gyx5z695mgkcmksezphpsnp70drl4dvpajh44z9kap4tgpqjt837h";
    const receiveAddress =
      "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const req = buildSageNftGiftOfferRequest({
      nftId,
      receiveAddress,
      feeMojos: 500_000_000n,
    });
    expect(req).toEqual({
      offered_assets: [{ asset_id: nftId, amount: 1 }],
      requested_assets: [],
      fee: 500_000_000,
      expires_at_second: null,
      auto_import: false,
      receive_address: receiveAddress,
    });
  });

  it("rejects a non-nft1 id", () => {
    expect(() =>
      buildSageNftGiftOfferRequest({
        nftId: "not-an-nft",
        receiveAddress:
          "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      }),
    ).toThrow(/Invalid NFT id/);
  });
});
