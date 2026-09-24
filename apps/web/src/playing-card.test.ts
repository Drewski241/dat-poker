import { describe, expect, it } from "vitest";
import { isRedSuit, playingCardLabel, rankFace, suitGlyph } from "./playing-card.js";

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
  });
});
