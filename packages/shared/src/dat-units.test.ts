import { describe, expect, it } from "vitest";
import {
  CAT_MOJOS_PER_TOKEN,
  formatDatAmount,
  formatDatMojos,
  parseDatTokensToMojos,
  playthroughHandsRequired,
  playthroughUnlockedMojos,
  playthroughWithdrawableMojos,
  redeemCooldownRemainingMs,
  resolveDatDailyRedeemMojos,
  resolveDatMinBuyInMojos,
  nextRedeemAtIso,
  DAT_DAILY_REDEEM_COOLDOWN_MS,
} from "./dat-units.js";

describe("formatDatMojos", () => {
  it("formats whole DAT tokens from CAT mojos", () => {
    expect(formatDatMojos(40_000_000n)).toBe("40000 DAT");
    expect(formatDatMojos("1000000")).toBe("1000 DAT");
  });

  it("formats fractional DAT", () => {
    expect(formatDatMojos(1500n)).toBe("1.5 DAT");
    expect(formatDatMojos(1n)).toBe("0.001 DAT");
  });

  it("parses typed DAT amounts to mojos", () => {
    expect(parseDatTokensToMojos("10")).toBe(10_000n);
    expect(parseDatTokensToMojos("10 DAT")).toBe(10_000n);
    expect(parseDatTokensToMojos("1.5")).toBe(1_500n);
    expect(parseDatTokensToMojos("nope")).toBeNull();
    expect(formatDatAmount(10_000n)).toBe("10");
    expect(formatDatAmount(1_500n)).toBe("1.5");
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

describe("resolveDatDailyRedeemMojos", () => {
  it("defaults to 5000 DAT", () => {
    expect(resolveDatDailyRedeemMojos(undefined)).toBe(5_000_000n);
    expect(resolveDatDailyRedeemMojos("5000000")).toBe(5_000_000n);
  });
});

describe("playthroughHandsRequired", () => {
  it("requires one hand per whole DAT token of buy-in", () => {
    expect(playthroughHandsRequired(1_000_000n)).toBe(1000);
    expect(playthroughHandsRequired("2000")).toBe(2);
    expect(playthroughHandsRequired(0n)).toBe(0);
  });
});

describe("playthroughUnlockedMojos", () => {
  it("unlocks one DAT per completed hand, capped at the buy-in", () => {
    expect(playthroughUnlockedMojos(50, 1_000_000n)).toBe(50_000n);
    expect(playthroughUnlockedMojos(1000, 1_000_000n)).toBe(1_000_000n);
    expect(playthroughUnlockedMojos(2000, 1_000_000n)).toBe(1_000_000n);
    expect(playthroughUnlockedMojos(0, 1_000_000n)).toBe(0n);
  });

  it("withdraws whole unlocked tokens limited by the chips on hand", () => {
    expect(playthroughWithdrawableMojos(50, 1_000_000n, 1_000_000n)).toBe(50_000n);
    expect(playthroughWithdrawableMojos(50, 1_000_000n, 40_000n)).toBe(40_000n);
    expect(playthroughWithdrawableMojos(50, 1_000_000n, 40_500n)).toBe(40_000n);
    expect(playthroughWithdrawableMojos(0, 1_000_000n, 1_000_000n)).toBe(0n);
  });
});

describe("daily redeem cooldown", () => {
  it("blocks until 24 hours after the last redeem", () => {
    const last = "2026-09-16T12:00:00.000Z";
    const t0 = Date.parse(last);
    expect(redeemCooldownRemainingMs(last, t0 + 1000)).toBe(DAT_DAILY_REDEEM_COOLDOWN_MS - 1000);
    expect(redeemCooldownRemainingMs(last, t0 + DAT_DAILY_REDEEM_COOLDOWN_MS)).toBe(0);
    expect(nextRedeemAtIso(last, t0 + 1000)).toBe(new Date(t0 + DAT_DAILY_REDEEM_COOLDOWN_MS).toISOString());
  });
});
