import { afterEach, describe, expect, it } from "vitest";
import { computeWithdrawPayout, onChainSageWithdrawEnabled } from "./treasury-payout.js";

describe("computeWithdrawPayout", () => {
  it("pays net winnings for virtual buy-in", () => {
    expect(computeWithdrawPayout(1_050_000n, 1_000_000n, "net")).toBe(50_000n);
  });

  it("returns zero when stack is below buy-in", () => {
    expect(computeWithdrawPayout(900_000n, 1_000_000n, "net")).toBe(0n);
  });

  it("pays full stack in full mode", () => {
    expect(computeWithdrawPayout(1_050_000n, 1_000_000n, "full")).toBe(1_050_000n);
  });
});

describe("onChainSageWithdrawEnabled", () => {
  afterEach(() => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
  });

  it("is off by default so unused treasury offers are not created", () => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    expect(onChainSageWithdrawEnabled()).toBe(false);
  });

  it("turns on only when explicitly enabled", () => {
    process.env.DAT_ENABLE_ONCHAIN_WITHDRAW = "true";
    expect(onChainSageWithdrawEnabled()).toBe(true);
  });
});
