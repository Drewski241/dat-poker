import { describe, expect, it } from "vitest";
import { PAYLINES } from "./paylines.js";
import { payoutDenominatorOf, payoutUnitsToMojos } from "./payout-mojos.js";
import {
  combineStampedeRespin,
  evaluateStampedeSpin,
  STAMPEDE_WAYS_BET_DIVISOR,
} from "./stampede.js";

const lineBetMojos = 1_000n / BigInt(PAYLINES.length);

describe("payoutUnitsToMojos", () => {
  it("keeps integer line multipliers exact", () => {
    expect(payoutUnitsToMojos(10, lineBetMojos)).toBe(10n * lineBetMojos);
    expect(payoutUnitsToMojos(4, 111n)).toBe(444n);
  });

  it("settles the Spirit Stampede float that BigInt rejects", () => {
    const fractional = 60 / STAMPEDE_WAYS_BET_DIVISOR;
    expect(String(fractional)).toBe("8.571428571428571");
    expect(() => BigInt(fractional)).toThrow(/not an integer/);
    expect(payoutUnitsToMojos(fractional, lineBetMojos)).toBe((60n * lineBetMojos) / 7n);
  });

  it("rounds fractional cascade multipliers instead of throwing", () => {
    expect(payoutUnitsToMojos(4.6, 111n)).toBe(510n);
  });

  it("reads a positive integer denominator from spin meta", () => {
    expect(payoutDenominatorOf({ payoutDenominator: 7 })).toBe(7);
    expect(payoutDenominatorOf({ payoutDenominator: 1.5 })).toBe(1);
    expect(payoutDenominatorOf(undefined)).toBe(1);
  });
});

describe("Spirit Stampede ways settlement", () => {
  it("pays an eagle 5-of-a-kind as 60/7 line stakes in whole mojos", () => {
    const grid = [
      ["eagle", "cactus", "tumbleweed"],
      ["coyote", "eagle", "bison"],
      ["horseshoe", "cactus", "eagle"],
      ["tumbleweed", "coyote", "eagle"],
      ["bison", "horseshoe", "eagle"],
    ];
    const result = evaluateStampedeSpin(grid, 1);
    expect(result.waysWins).toEqual([
      expect.objectContaining({
        symbol: "eagle",
        reelCount: 5,
        ways: 1,
        multiplier: 60,
        payout: 60,
        payoutDenominator: 7,
      }),
    ]);
    expect(result.totalPayout).toBe(60);
    expect(result.meta?.payoutDenominator).toBe(7);
    expect(Number.isInteger(result.totalPayout)).toBe(true);
    const mojos = payoutUnitsToMojos(result.totalPayout, lineBetMojos, 7);
    expect(mojos).toBe(951n);
    expect(result.waysWins[0]?.cells).toHaveLength(5);
    expect(mojos).toBe((60n * lineBetMojos) / BigInt(STAMPEDE_WAYS_BET_DIVISOR));
  });

  it("halves only the respin when combining two integer numerators", () => {
    const first = evaluateStampedeSpin(
      [
        ["eagle", "cactus", "tumbleweed"],
        ["coyote", "eagle", "bison"],
        ["horseshoe", "cactus", "eagle"],
        ["tumbleweed", "coyote", "eagle"],
        ["bison", "horseshoe", "eagle"],
      ],
      1,
    );
    const second = evaluateStampedeSpin(
      [
        ["cactus", "tumbleweed", "coyote"],
        ["eagle", "cactus", "bison"],
        ["horseshoe", "eagle", "cactus"],
        ["tumbleweed", "coyote", "eagle"],
        ["bison", "horseshoe", "tumbleweed"],
      ],
      1,
    );
    expect(second.totalPayout).toBe(5);
    const combined = combineStampedeRespin(first, second, first.grid);
    expect(combined.waysWins.every((w, i) => w.phase === (i < first.waysWins.length ? "base" : "respin"))).toBe(
      true,
    );
    expect(combined.meta?.payoutDenominator).toBe(14);
    expect(combined.meta?.baseScatterCells).toEqual(first.meta?.scatterCells);
    expect(combined.meta?.scatterCells).toEqual(second.meta?.scatterCells);
    expect(combined.totalPayout).toBe(60 * 2 + 5);
    expect(Number.isInteger(combined.totalPayout)).toBe(true);
    expect(payoutUnitsToMojos(combined.totalPayout, lineBetMojos, 14)).toBe(
      ((60n * 2n + 5n) * lineBetMojos) / 14n,
    );
  });
});
