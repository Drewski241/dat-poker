import { describe, expect, it } from "vitest";
import { parseCard, type Card } from "@dat-poker/game-engine";
import { chooseHouseAction, estimateHouseStrength, huPreflopScore, type HouseView } from "./house-strategy.js";

function cards(...s: string[]): Card[] {
  return s.map(parseCard);
}

function view(partial: Partial<HouseView> & Pick<HouseView, "holeCards" | "board" | "street">): HouseView {
  return {
    potMojos: 30_000n,
    currentBetMojos: 0n,
    betThisStreetMojos: 0n,
    stackMojos: 1_000_000n,
    bigBlindMojos: 10_000n,
    lastRaiseIncrementMojos: 10_000n,
    opponentsAllIn: false,
    ...partial,
  };
}

describe("house strategy", () => {
  it("value-bets a river full house when checked to", () => {
    const v = view({
      street: "river",
      holeCards: cards("Kh", "Kd"),
      board: cards("Kc", "2s", "2h", "9c", "3d"),
      potMojos: 80_000n,
    });
    expect(estimateHouseStrength(v)).toBeGreaterThan(0.9);
    const choice = chooseHouseAction(v, () => 0.5);
    expect(choice.action).toBe("bet");
    expect(choice.amountMojos).toBeGreaterThan(0n);
  });

  it("does not put extra chips in when the opponent is already all-in", () => {
    const v = view({
      street: "river",
      holeCards: cards("Kh", "Kd"),
      board: cards("Kc", "2s", "2h", "9c", "3d"),
      opponentsAllIn: true,
    });
    expect(chooseHouseAction(v, () => 0.5)).toEqual({ action: "check", amountMojos: 0n });
  });

  it("folds junk on the river facing a large bet", () => {
    const v = view({
      street: "river",
      holeCards: cards("7h", "2d"),
      board: cards("Tc", "9s", "3h", "Kd", "Ac"),
      currentBetMojos: 60_000n,
      potMojos: 50_000n,
    });
    expect(estimateHouseStrength(v)).toBeLessThan(0.32);
    expect(chooseHouseAction(v, () => 0.5).action).toBe("fold");
  });

  it("checks air when the pot is checked to (typical roll)", () => {
    const v = view({
      street: "flop",
      holeCards: cards("7h", "2d"),
      board: cards("Tc", "9s", "3h"),
    });
    expect(chooseHouseAction(v, () => 0.5).action).toBe("check");
  });

  it("bluffs air some of the time when checked to", () => {
    const v = view({
      street: "flop",
      holeCards: cards("7h", "2d"),
      board: cards("Tc", "9s", "3h"),
      potMojos: 40_000n,
    });
    const choice = chooseHouseAction(v, () => 0.05);
    expect(choice.action).toBe("bet");
    expect(choice.amountMojos).toBeGreaterThanOrEqual(10_000n);
  });

  it("raises premium pairs preflop", () => {
    const v = view({
      street: "preflop",
      holeCards: cards("Ah", "Ad"),
      board: [],
      currentBetMojos: 10_000n,
      betThisStreetMojos: 5_000n,
      potMojos: 15_000n,
      headsUp: true,
    });
    expect(estimateHouseStrength(v)).toBeGreaterThan(0.9);
    const choice = chooseHouseAction(v, () => 0.5);
    expect(choice.action).toBe("raise");
    expect(choice.amountMojos).toBeGreaterThanOrEqual(25_000n);
  });

  it("raises K9o from the HU small blind instead of folding", () => {
    const v = view({
      street: "preflop",
      holeCards: cards("Kh", "9d"),
      board: [],
      currentBetMojos: 10_000n,
      betThisStreetMojos: 5_000n,
      potMojos: 15_000n,
      headsUp: true,
    });
    expect(huPreflopScore(v.holeCards[0], v.holeCards[1])).toBeGreaterThan(0.2);
    expect(chooseHouseAction(v, () => 0.5).action).toBe("raise");
  });

  it("defends the HU big blind vs a 3x open with Q8o", () => {
    const v = view({
      street: "preflop",
      holeCards: cards("Qh", "8d"),
      board: [],
      currentBetMojos: 30_000n,
      betThisStreetMojos: 10_000n,
      potMojos: 45_000n,
      headsUp: true,
    });
    expect(chooseHouseAction(v, () => 0.5).action).not.toBe("fold");
  });

  it("calls a HU min-raise in the big blind with J4s", () => {
    const v = view({
      street: "preflop",
      holeCards: cards("Jh", "4h"),
      board: [],
      currentBetMojos: 20_000n,
      betThisStreetMojos: 10_000n,
      potMojos: 30_000n,
      headsUp: true,
    });
    expect(chooseHouseAction(v, () => 0.5).action).toBe("call");
  });

  it("folds 72o preflop to a 4x open heads-up", () => {
    const v = view({
      street: "preflop",
      holeCards: cards("7h", "2d"),
      board: [],
      currentBetMojos: 40_000n,
      betThisStreetMojos: 5_000n,
      potMojos: 55_000n,
      headsUp: true,
    });
    expect(huPreflopScore(v.holeCards[0], v.holeCards[1])).toBeLessThan(0.16);
    expect(chooseHouseAction(v, () => 0.5).action).toBe("fold");
  });

  it("calls a modest flop bet with a flush draw", () => {
    const v = view({
      street: "flop",
      holeCards: cards("Ah", "2h"),
      board: cards("Kh", "7h", "9c"),
      currentBetMojos: 10_000n,
      potMojos: 30_000n,
    });
    expect(estimateHouseStrength(v)).toBeGreaterThan(0.45);
    expect(chooseHouseAction(v, () => 0.5).action).toBe("call");
  });
});
