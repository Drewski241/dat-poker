import { describe, expect, it } from "vitest";
import { evaluateMineSpin, mineGridFromRows } from "./mine-mojo.js";
import { evaluatePokerSpin } from "./poker-hands.js";
import { spinForGame } from "./game-registry.js";

describe("multi-game slot engines", () => {
  it("mine-mojo cascades increase payout", () => {
    const grid = mineGridFromRows([
      ["ruby", "lemon", "bell"],
      ["ruby", "lemon", "bell"],
      ["ruby", "lemon", "bell"],
      ["emerald", "lemon", "bell"],
      ["bell", "lemon", "bell"],
    ]);
    const result = evaluateMineSpin(grid, 1);
    expect(result.totalPayout).toBeGreaterThan(0);
    expect(result.meta?.cascadeSteps).toBeGreaterThanOrEqual(1);
  });

  it("poker-hands pays pair on center line", () => {
    const grid = [
      ["h2", "hA", "h4"],
      ["d3", "dA", "d5"],
      ["c6", "cK", "c8"],
      ["h9", "hQ", "hT"],
      ["s2", "sJ", "s3"],
    ];
    const result = evaluatePokerSpin(grid, 1);
    expect(result.lineWins.some((w) => w.symbol === "pair")).toBe(true);
  });

  it("stampede produces ways wins", () => {
    const result = spinForGame("spirit-stampede", 1);
    expect(result.waysWins).toBeDefined();
  });
});
