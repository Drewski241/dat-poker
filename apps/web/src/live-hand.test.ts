import { describe, expect, it } from "vitest";
import { describeLiveHand } from "./live-hand.js";

describe("describeLiveHand", () => {
  it("returns null without hole cards", () => {
    expect(describeLiveHand([])).toBeNull();
    expect(describeLiveHand([], [{ rank: "A", suit: "h" }])).toBeNull();
  });

  it("names the preflop combo", () => {
    expect(describeLiveHand([{ rank: "A", suit: "s" }, { rank: "A", suit: "h" }])).toBe(
      "pair of Aces",
    );
    expect(describeLiveHand([{ rank: "A", suit: "h" }, { rank: "K", suit: "h" }])).toBe(
      "Ace-King suited",
    );
  });

  it("uses hole plus board for the made hand", () => {
    expect(
      describeLiveHand(
        [
          { rank: "K", suit: "h" },
          { rank: "K", suit: "d" },
        ],
        [
          { rank: "K", suit: "c" },
          { rank: "2", suit: "s" },
          { rank: "2", suit: "h" },
        ],
      ),
    ).toBe("full house, Kings full of 2s");
  });

  it("ignores invalid cards", () => {
    expect(describeLiveHand([{ rank: "X", suit: "h" }, { rank: "A", suit: "s" }])).toBeNull();
  });

  it("evaluates Omaha with the 2+3 rule", () => {
    expect(
      describeLiveHand(
        [
          { rank: "9", suit: "h" },
          { rank: "8", suit: "d" },
          { rank: "2", suit: "c" },
          { rank: "2", suit: "s" },
        ],
        [
          { rank: "7", suit: "c" },
          { rank: "6", suit: "h" },
          { rank: "5", suit: "d" },
          { rank: "K", suit: "s" },
          { rank: "A", suit: "d" },
        ],
        "plo4",
      ),
    ).toMatch(/straight/i);
  });
});
