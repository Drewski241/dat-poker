import { describe, expect, it } from "vitest";
import { cardFace, isRedSuit, playingCardLabel, rankFace, suitGlyph, suitMark } from "./playing-card.js";

describe("playing cards", () => {
  it("uses a readable 10 instead of T", () => {
    expect(rankFace("T")).toBe("10");
    expect(rankFace("A")).toBe("A");
  });

  it("colors hearts and diamonds red", () => {
    expect(isRedSuit("h")).toBe(true);
    expect(isRedSuit("d")).toBe(true);
    expect(isRedSuit("s")).toBe(false);
    expect(isRedSuit("c")).toBe(false);
  });

  it("names cards for screen readers", () => {
    expect(playingCardLabel({ rank: "A", suit: "h" })).toBe("Ace of hearts");
    expect(playingCardLabel({ rank: "T", suit: "s" })).toBe("10 of spades");
    expect(suitGlyph("c")).toBe("♣");
    expect(suitMark("h")).toBe("♥\uFE0E");
  });

  it("lays out a printed deck", () => {
    expect(cardFace("A").kind).toBe("ace");
    expect(cardFace("K").kind).toBe("court");
    expect(cardFace("Q").kind).toBe("court");
    expect(cardFace("J").kind).toBe("court");
    for (const [rank, count] of [
      ["2", 2],
      ["3", 3],
      ["4", 4],
      ["5", 5],
      ["6", 6],
      ["7", 7],
      ["8", 8],
      ["9", 9],
      ["T", 10],
      ["10", 10],
    ] as const) {
      const face = cardFace(rank);
      expect(face.kind).toBe("pips");
      if (face.kind === "pips") expect(face.pips).toHaveLength(count);
    }
    const five = cardFace("5");
    if (five.kind === "pips") {
      expect(five.pips.filter((spot) => spot.x === 50 && !spot.flip)).toHaveLength(1);
      expect(five.pips.filter((spot) => spot.flip)).toHaveLength(2);
    }
  });
});
