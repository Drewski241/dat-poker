import { describe, expect, it } from "vitest";
import { evaluateSpin, gridFromRows, isProgressiveJackpotGrid, winTier } from "./slot-engine.js";

describe("slot-engine", () => {
  it("pays a middle-line three-of-a-kind", () => {
    const grid = gridFromRows([
      ["lemon", "cherry", "bell"],
      ["bell", "cherry", "chip"],
      ["chip", "cherry", "ace"],
      ["ace", "cherry", "king"],
      ["king", "cherry", "seven"],
    ]);
    const result = evaluateSpin(grid, 10);
    expect(result.lineWins.length).toBeGreaterThan(0);
    expect(result.totalPayout).toBeGreaterThan(0);
  });

  it("detects progressive grid", () => {
    const grid = gridFromRows([
      ["bell", "seven", "cherry"],
      ["bell", "seven", "cherry"],
      ["bell", "seven", "cherry"],
      ["bell", "seven", "cherry"],
      ["bell", "seven", "cherry"],
    ]);
    expect(isProgressiveJackpotGrid(grid)).toBe(true);
  });

  it("pays three aces when wilds lead on the middle payline", () => {
    const grid = gridFromRows([
      ["king", "wild", "king"],
      ["king", "wild", "ace"],
      ["ace", "ace", "chip"],
      ["scatter", "seven", "bell"],
      ["seven", "cherry", "lemon"],
    ]);
    const result = evaluateSpin(grid, 1);
    const middle = result.lineWins.find((w) => w.lineIndex === 0);
    expect(middle).toMatchObject({ symbol: "ace", count: 3, multiplier: 10 });
    expect(result.totalPayout).toBeGreaterThanOrEqual(10);
  });

  it("classifies jackpot tier", () => {
    expect(winTier(100)).toBe("jackpot");
    expect(winTier(25)).toBe("mega");
    expect(winTier(10)).toBe("big");
    expect(winTier(0)).toBe("none");
  });
});
