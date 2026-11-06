import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import {
  evaluateAceToFiveLow,
  evaluateBadugi,
  evaluateDeuceToSevenLow,
  evaluateOmahaEightOrBetterLow,
} from "./lowball-evaluator.js";

const c = (s: string) => parseCard(s);

describe("Ace-to-5 lowball", () => {
  it("ranks the wheel best", () => {
    const wheel = evaluateAceToFiveLow([c("As"), c("2h"), c("3d"), c("4c"), c("5s")]);
    const seven = evaluateAceToFiveLow([c("7s"), c("5h"), c("4d"), c("3c"), c("2s")]);
    expect(wheel.score).toBeLessThan(seven.score);
  });

  it("penalizes pairs", () => {
    const smooth = evaluateAceToFiveLow([c("8s"), c("5h"), c("4d"), c("3c"), c("2s")]);
    const paired = evaluateAceToFiveLow([c("8s"), c("8h"), c("4d"), c("3c"), c("2s")]);
    expect(smooth.score).toBeLessThan(paired.score);
  });
});

describe("Deuce-to-seven lowball", () => {
  it("prefers 7-5-4-3-2 over 7-6-4-3-2", () => {
    const best = evaluateDeuceToSevenLow([c("7s"), c("5h"), c("4d"), c("3c"), c("2s")]);
    const worse = evaluateDeuceToSevenLow([c("7s"), c("6h"), c("4d"), c("3c"), c("2s")]);
    expect(best.score).toBeLessThan(worse.score);
  });

  it("penalizes straights and flushes", () => {
    const smooth = evaluateDeuceToSevenLow([c("7s"), c("5h"), c("4d"), c("3c"), c("2s")]);
    const straight = evaluateDeuceToSevenLow([c("6s"), c("5h"), c("4d"), c("3c"), c("2s")]);
    const flush = evaluateDeuceToSevenLow([c("7s"), c("5s"), c("4s"), c("3s"), c("2s")]);
    expect(smooth.score).toBeLessThan(straight.score);
    expect(smooth.score).toBeLessThan(flush.score);
  });
});

describe("Omaha 8-or-better low", () => {
  it("qualifies with 2+3 eight-or-better", () => {
    const low = evaluateOmahaEightOrBetterLow(
      [c("As"), c("2h"), c("Kd"), c("Qc")],
      [c("3d"), c("4c"), c("5s"), c("9h"), c("Jh")],
    );
    expect(low).not.toBeNull();
    expect(low!.values).toEqual([5, 4, 3, 2, 1]);
  });

  it("returns null when no qualifying low", () => {
    const low = evaluateOmahaEightOrBetterLow(
      [c("As"), c("Kh"), c("Qd"), c("Jc")],
      [c("Td"), c("9c"), c("8s"), c("7h"), c("6h")],
    );
    expect(low).toBeNull();
  });
});

describe("Badugi", () => {
  it("prefers a 4-card badugi over a 3-card", () => {
    const four = evaluateBadugi([c("As"), c("2h"), c("3d"), c("4c")]);
    const three = evaluateBadugi([c("As"), c("2h"), c("3d"), c("3c")]);
    expect(four.cards.length).toBe(4);
    expect(three.cards.length).toBe(3);
    expect(four.score).toBeLessThan(three.score);
  });

  it("Ace is low", () => {
    const aceLow = evaluateBadugi([c("As"), c("2h"), c("3d"), c("4c")]);
    const kingHigh = evaluateBadugi([c("Ks"), c("2h"), c("3d"), c("4c")]);
    expect(aceLow.score).toBeLessThan(kingHigh.score);
  });
});
