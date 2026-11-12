import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import { compareHands, describeEvaluatedHand, evaluateBestHand, evaluateOmahaHand } from "./hand-evaluator.js";

describe("hand evaluator", () => {
  it("detects a flush beating a straight", () => {
    const flush = [
      parseCard("Ah"),
      parseCard("Kh"),
      parseCard("9h"),
      parseCard("7h"),
      parseCard("2h"),
      parseCard("3c"),
      parseCard("4d"),
    ];
    const straight = [
      parseCard("9c"),
      parseCard("8d"),
      parseCard("7s"),
      parseCard("6h"),
      parseCard("5c"),
      parseCard("2d"),
      parseCard("3h"),
    ];
    expect(compareHands(evaluateBestHand(flush), evaluateBestHand(straight))).toBeGreaterThan(0);
  });

  it("detects full house", () => {
    const cards = ["Kh", "Kd", "Kc", "2s", "2h", "9c", "3d"].map(parseCard);
    const ev = evaluateBestHand(cards);
    expect(ev.category).toBe("full_house");
    expect(describeEvaluatedHand(ev)).toBe("a full house, kings full of twos");
  });

  it("plays exactly two hole cards and three from the board", () => {
    const hole = ["As", "Kd", "2c", "3d"].map(parseCard);
    const board = ["Ah", "Kh", "Qh", "Jh", "Th"].map(parseCard);
    const ev = evaluateOmahaHand(hole, board);
    expect(ev.category).toBe("straight");
    expect(describeEvaluatedHand(ev)).toBe("a straight, ace high");
    expect(evaluateBestHand([...hole, ...board]).category).toBe("straight_flush");
  });

  it("does not let a player use the whole board", () => {
    const hole = ["2c", "3d", "4h", "5s"].map(parseCard);
    const board = ["Ah", "Kh", "Qh", "Jh", "9d"].map(parseCard);
    expect(evaluateOmahaHand(hole, board).category).toBe("high_card");
  });

  it("names two pair from the kickers", () => {
    const cards = ["Kh", "Kd", "5c", "5s", "9c"].map(parseCard);
    expect(describeEvaluatedHand(evaluateBestHand(cards))).toBe("two pair, kings and fives");
  });
});
