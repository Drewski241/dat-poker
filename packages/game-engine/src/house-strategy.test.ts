import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import { chooseHouseAction } from "./house-strategy.js";

const blinds = {
  potMojos: 150_000n,
  currentBetMojos: 100_000n,
  betThisStreetMojos: 100_000n,
  stackMojos: 4_900_000n,
  bigBlindMojos: 100_000n,
} as const;

describe("chooseHouseAction", () => {
  it("folds seven-deuce offsuit when facing a large bet", () => {
    const decision = chooseHouseAction({
      street: "preflop",
      board: [],
      holeCards: [parseCard("7c"), parseCard("2d")],
      potMojos: 1_200_000n,
      currentBetMojos: 800_000n,
      betThisStreetMojos: 100_000n,
      stackMojos: 4_200_000n,
      bigBlindMojos: 100_000n,
    });
    expect(decision.action).toBe("fold");
  });

  it("bets pocket aces when it can check", () => {
    const decision = chooseHouseAction({
      street: "preflop",
      board: [],
      holeCards: [parseCard("Ah"), parseCard("Ad")],
      ...blinds,
      currentBetMojos: 100_000n,
      betThisStreetMojos: 100_000n,
    });
    expect(decision.action).toBe("bet");
    expect(decision.amountMojos).toBeGreaterThan(blinds.currentBetMojos);
  });

  it("raises a made straight on the flop", () => {
    const decision = chooseHouseAction({
      street: "flop",
      board: [parseCard("Qh"), parseCard("Jd"), parseCard("Tc")],
      holeCards: [parseCard("Kh"), parseCard("9c")],
      potMojos: 400_000n,
      currentBetMojos: 100_000n,
      betThisStreetMojos: 0n,
      stackMojos: 4_000_000n,
      bigBlindMojos: 100_000n,
    });
    expect(decision.action).toBe("raise");
    expect(decision.amountMojos).toBeGreaterThan(100_000n);
  });

  it("keeps an Omaha raise inside the pot", () => {
    const decision = chooseHouseAction({
      street: "preflop",
      board: [],
      holeCards: [parseCard("Ah"), parseCard("Ad"), parseCard("Kh"), parseCard("Kd")],
      potMojos: 30_000n,
      currentBetMojos: 20_000n,
      betThisStreetMojos: 10_000n,
      stackMojos: 990_000n,
      bigBlindMojos: 20_000n,
      variant: "plo4",
      minRaiseTo: 40_000n,
      maxRaiseTo: 60_000n,
    });
    expect(decision.action === "raise" || decision.action === "call" || decision.action === "fold").toBe(true);
    if (decision.action === "raise") {
      expect(decision.amountMojos).toBeLessThanOrEqual(60_000n);
      expect(decision.amountMojos).toBeGreaterThanOrEqual(40_000n);
    }
  });

  it("checks a weak unpaired flop when nobody has bet", () => {
    const decision = chooseHouseAction({
      street: "flop",
      board: [parseCard("Ah"), parseCard("Kd"), parseCard("9c")],
      holeCards: [parseCard("7s"), parseCard("2d")],
      potMojos: 200_000n,
      currentBetMojos: 0n,
      betThisStreetMojos: 0n,
      stackMojos: 4_000_000n,
      bigBlindMojos: 100_000n,
    });
    expect(decision.action).toBe("check");
  });
});
