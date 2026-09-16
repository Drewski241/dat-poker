import { describe, expect, it } from "vitest";
import { computeNlheBetRange, snapRaiseTo, betSizePresets } from "./bet-sizing.js";

describe("computeNlheBetRange", () => {
  const bb = 10_000n;

  it("returns opening bet range from BB to all-in", () => {
    const range = computeNlheBetRange({
      bigBlindMojos: bb,
      currentBetMojos: 0n,
      myBetThisStreetMojos: 0n,
      myStackMojos: 1_000_000n,
    });
    expect(range.isOpeningBet).toBe(true);
    expect(range.minRaiseTo).toBe(bb);
    expect(range.maxRaiseTo).toBe(1_000_000n);
    expect(range.canBetOrRaise).toBe(true);
  });

  it("returns raise range above current bet", () => {
    const range = computeNlheBetRange({
      bigBlindMojos: bb,
      currentBetMojos: 20_000n,
      myBetThisStreetMojos: 0n,
      myStackMojos: 1_000_000n,
    });
    expect(range.isOpeningBet).toBe(false);
    expect(range.minRaiseTo).toBe(30_000n);
    expect(range.maxRaiseTo).toBe(1_000_000n);
  });
});

describe("snapRaiseTo", () => {
  it("snaps to step increments", () => {
    expect(snapRaiseTo(25_000n, 10_000n, 100_000n, 10_000n)).toBe(20_000n);
  });
});

describe("betSizePresets", () => {
  it("lists 1×–4× BB when BB is 5 DAT", () => {
    const bb = 5_000n;
    expect(betSizePresets(bb, bb, 1_000_000n)).toEqual([
      5_000n, 10_000n, 15_000n, 20_000n,
    ]);
  });

  it("omits sizes below the min raise", () => {
    const bb = 10_000n;
    expect(betSizePresets(bb, 30_000n, 100_000n)).toEqual([30_000n, 40_000n]);
  });
});
