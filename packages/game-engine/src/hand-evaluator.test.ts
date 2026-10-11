import { describe, expect, it } from "vitest";
import { parseCard } from "./card.js";
import {
  compareHands,
  describeBestMadeHand,
  describeOmahaMadeHand,
  evaluateBestHand,
  evaluateOmahaBestHand,
} from "./hand-evaluator.js";

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
  });
});

describe("describeBestMadeHand", () => {
  it("returns null for no cards", () => {
    expect(describeBestMadeHand([])).toBeNull();
  });

  it("names a pocket pair", () => {
    expect(describeBestMadeHand(["Ah", "Ad"].map(parseCard))).toBe("pair of Aces");
  });

  it("names unpaired hole cards, noting suited", () => {
    expect(describeBestMadeHand(["Ah", "Kh"].map(parseCard))).toBe("Ace-King suited");
    expect(describeBestMadeHand(["As", "9h"].map(parseCard))).toBe("Ace-9");
  });

  it("names trips and two pair before the flop is complete", () => {
    expect(describeBestMadeHand(["Kh", "Kd", "Kc"].map(parseCard))).toBe("three of a kind, Kings");
    expect(describeBestMadeHand(["Ah", "Ad", "2s", "2h"].map(parseCard))).toBe(
      "two pair, Aces and 2s",
    );
  });

  it("names the best five-card hand on the flop and river", () => {
    expect(
      describeBestMadeHand(["Ah", "Kh", "9h", "7h", "2h"].map(parseCard)),
    ).toBe("Ace-high flush");
    expect(
      describeBestMadeHand(["Kh", "Kd", "Kc", "2s", "2h", "9c", "3d"].map(parseCard)),
    ).toBe("full house, Kings full of 2s");
    expect(
      describeBestMadeHand(["Ah", "Kh", "Qh", "Jh", "Th"].map(parseCard)),
    ).toBe("royal flush");
    expect(
      describeBestMadeHand(["Ah", "2c", "3d", "4s", "5h"].map(parseCard)),
    ).toBe("5-high straight");
  });
});

describe("Omaha evaluator", () => {
  it("must use exactly two hole cards (board nut flush does not play alone)", () => {
    // Hole has no heart — cannot make the board flush in Omaha.
    const hole = ["As", "Kd", "Qc", "Jh"].map(parseCard);
    const board = ["Ah", "Kh", "9h", "7h", "2h"].map(parseCard);
    const omaha = evaluateOmahaBestHand(hole, board);
    expect(omaha.category).not.toBe("flush");
    expect(omaha.category).not.toBe("straight_flush");
  });

  it("uses two hole cards for a wrap straight", () => {
    const hole = ["9h", "8d", "2c", "2s"].map(parseCard);
    const board = ["7c", "6h", "5d", "Ks", "Ad"].map(parseCard);
    const omaha = evaluateOmahaBestHand(hole, board);
    expect(omaha.category).toBe("straight");
    expect(describeOmahaMadeHand(hole, board)).toMatch(/straight/i);
  });
});
