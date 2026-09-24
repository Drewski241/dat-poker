import { afterEach, describe, expect, it } from "vitest";
import {
  computeWithdrawPayout,
  looksLikeXchAddress,
  onChainSageWithdrawEnabled,
  treasurySelfPayoutError,
} from "./treasury-payout.js";

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
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    delete process.env.TREASURY_XCH_ADDRESS;
  });

  it("is off when no treasury URL is configured", () => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    delete process.env.DAT_TREASURY_PAYOUT_URL;
    expect(onChainSageWithdrawEnabled()).toBe(false);
  });

  it("defaults on when a treasury URL is set", () => {
    delete process.env.DAT_ENABLE_ONCHAIN_WITHDRAW;
    process.env.DAT_TREASURY_PAYOUT_URL = "http://127.0.0.1:4200/payout";
    expect(onChainSageWithdrawEnabled()).toBe(true);
  });

  it("can be forced off even when a treasury URL is set", () => {
    process.env.DAT_ENABLE_ONCHAIN_WITHDRAW = "false";
    process.env.DAT_TREASURY_PAYOUT_URL = "http://127.0.0.1:4200/payout";
    expect(onChainSageWithdrawEnabled()).toBe(false);
  });

  it("rejects the treasury Sage address", () => {
    process.env.TREASURY_XCH_ADDRESS = "xch1treasurywalletaddress";
    expect(treasurySelfPayoutError("xch1treasurywalletaddress")).toMatch(/treasury wallet/i);
    expect(treasurySelfPayoutError("xch1playerwalletaddress00")).toBeNull();
    expect(looksLikeXchAddress("xch1sngunlock")).toBe(true);
  });
});
