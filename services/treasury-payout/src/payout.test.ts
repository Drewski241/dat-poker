import { describe, expect, it } from "vitest";
import { buildPayoutOffer, readTreasuryServiceConfig } from "./payout.js";

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

  it("rejects zero payout", async () => {
    await expect(
      buildPayoutOffer(baseConfig, { address: "xch1abc", amountMojos: "0" }),
    ).rejects.toThrow(/positive/i);
  });
});
