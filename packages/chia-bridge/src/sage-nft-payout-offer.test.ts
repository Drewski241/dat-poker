import { describe, expect, it } from "vitest";
import { buildSageNftGiftOfferRequest } from "./sage-nft-payout-offer.js";

describe("buildSageNftGiftOfferRequest", () => {
  it("offers an NFT with a transaction fee and receive address", () => {
    const nftId = "nft1mkl29gyx5z695mgkcmksezphpsnp70drl4dvpajh44z9kap4tgpqjt837h";
    const req = buildSageNftGiftOfferRequest({
      nftId,
      receiveAddress: "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      feeMojos: 500_000_000n,
    });
    expect(req).toEqual({
      offered_assets: { xch: 0, cats: [], nfts: [nftId] },
      requested_assets: { xch: 0, cats: [], nfts: [] },
      fee: 500_000_000,
      auto_import: false,
      receive_address:
        "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    });
  });
});
