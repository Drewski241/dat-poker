import { describe, expect, it } from "vitest";
import { computeNlheBetRange, computePotLimitBetRange, snapRaiseTo } from "./bet-sizing.js";

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

describe("computePotLimitBetRange", () => {
  it("caps a heads-up preflop raise at the pot", () => {
    const range = computePotLimitBetRange({
      bigBlindMojos: 20_000n,
      potMojos: 30_000n,
      currentBetMojos: 20_000n,
      myBetThisStreetMojos: 10_000n,
      myStackMojos: 990_000n,
      raiseIncrementMojos: 20_000n,
    });
    expect(range.minRaiseTo).toBe(40_000n);
    expect(range.maxRaiseTo).toBe(60_000n);
    expect(range.canBetOrRaise).toBe(true);
  });

  it("caps an opening bet at the pot", () => {
    const range = computePotLimitBetRange({
      bigBlindMojos: 20_000n,
      potMojos: 60_000n,
      currentBetMojos: 0n,
      myBetThisStreetMojos: 0n,
      myStackMojos: 1_000_000n,
      raiseIncrementMojos: 20_000n,
    });
    expect(range.isOpeningBet).toBe(true);
    expect(range.minRaiseTo).toBe(20_000n);
    expect(range.maxRaiseTo).toBe(60_000n);
  });
});

describe("snapRaiseTo", () => {
  it("snaps to step increments", () => {
    expect(snapRaiseTo(25_000n, 10_000n, 100_000n, 10_000n)).toBe(20_000n);
  });
});
