import { describe, expect, it } from "vitest";
import { buildNftPayoutOffer, buildPayoutOffer, readTreasuryServiceConfig } from "./payout.js";

describe("buildPayoutOffer", () => {
  const baseConfig = {
    ...readTreasuryServiceConfig(),
    offerMode: "mock" as const,
    defaultAssetId: "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c",
  };

  it("returns mock offer in mock mode", async () => {
    const result = await buildPayoutOffer(baseConfig, {
      address: "xch1abc",
      amountMojos: "50000",
    });
    expect(result.mode).toBe("mock");
    expect(result.offer).toContain("mock-offer:");
    expect(result.offer).toContain("50000");
  });

  it("returns mock NFT offer with fee in mock mode", async () => {
    const result = await buildNftPayoutOffer(baseConfig, {
      address: "xch1abc",
      nftId: "nft1mkl29gyx5z695mgkcmksezphpsnp70drl4dvpajh44z9kap4tgpqjt837h",
    });
    expect(result.mode).toBe("mock");
    expect(result.offer).toContain("mock-nft-offer:");
    expect(BigInt(result.feeMojos)).toBeGreaterThan(0n);
  });

  it("rejects zero payout", async () => {
    await expect(
      buildPayoutOffer(baseConfig, { address: "xch1abc", amountMojos: "0" }),
    ).rejects.toThrow(/positive/i);
  });
});
