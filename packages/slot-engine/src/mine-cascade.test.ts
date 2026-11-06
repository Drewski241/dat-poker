import { describe, expect, it } from "vitest";
import { evaluateMineSpin, mineGridFromRows, type MineCascadeFrame, type MineSymbolId } from "./mine-mojo.js";

function dropWins(grid: string[][], cells: { reel: number; row: number }[], fill: MineSymbolId): string[][] {
  const removed = new Set(cells.map((cell) => `${cell.reel}-${cell.row}`));
  return grid.map((col, reel) => {
    const remaining = col.filter((_, row) => !removed.has(`${reel}-${row}`));
    while (remaining.length < 3) remaining.unshift(fill);
    return remaining.slice(-3);
  });
}

describe("mine cascade frames", () => {
  it("records every winning board in the order the reels should show it", () => {
    const grid = mineGridFromRows([
      ["emerald", "ruby", "sapphire"],
      ["emerald", "ruby", "sapphire"],
      ["emerald", "ruby", "sapphire"],
      ["motherlode", "emerald", "sapphire"],
      ["motherlode", "emerald", "sapphire"],
    ]);
    const result = evaluateMineSpin(grid, 1, () => 0);
    const cascades = result.meta?.cascades as MineCascadeFrame[];
    expect(cascades.length).toBe(result.meta?.cascadeSteps);
    expect(cascades.length).toBeGreaterThanOrEqual(1);

    let expected = grid.map((col) => [...col]);
    for (const frame of cascades) {
      expect(frame.grid).toEqual(expected);
      expect(frame.lineWins.length).toBeGreaterThan(0);
      expected = dropWins(
        expected,
        frame.lineWins.flatMap((win) => win.cells),
        "ruby",
      );
    }
    expect(result.grid).toEqual(expected);
    expect(cascades[0]?.lineWins.some((win) => win.symbol === "ruby" && win.count === 3)).toBe(true);
    const paid = cascades.reduce(
      (sum, frame) => sum + frame.lineWins.reduce((inner, win) => inner + win.multiplier, 0),
      0,
    );
    expect(result.totalPayout).toBeCloseTo(paid, 8);
  });

  it("keeps a scatter-only board so the blast charges can be shown", () => {
    const grid = mineGridFromRows([
      ["dynamite", "pick", "pick"],
      ["dynamite", "pick", "pick"],
      ["dynamite", "pick", "pick"],
      ["pick", "pick", "pick"],
      ["pick", "pick", "pick"],
    ]);
    const result = evaluateMineSpin(grid, 1, () => 0);
    const cascades = result.meta?.cascades as MineCascadeFrame[];
    expect(result.totalPayout).toBe(4);
    expect(result.lineWins).toHaveLength(0);
    expect(cascades).toHaveLength(1);
    expect(cascades[0]).toMatchObject({
      scatterCount: 3,
      scatterMultiplier: 4,
      lineWins: [],
    });
    expect(cascades[0]?.grid).toEqual(grid);
    expect(result.grid).toEqual(grid);
  });

  it("records nothing when the spin does not pay", () => {
    const grid = mineGridFromRows([
      ["ruby", "ruby", "ruby"],
      ["emerald", "emerald", "emerald"],
      ["sapphire", "sapphire", "sapphire"],
      ["motherlode", "motherlode", "motherlode"],
      ["dynamite", "dynamite", "ruby"],
    ]);
    const result = evaluateMineSpin(grid, 1, () => 0);
    expect(result.totalPayout).toBe(0);
    expect(result.meta?.cascades).toEqual([]);
    expect(result.meta?.cascadeSteps).toBe(0);
  });
});
