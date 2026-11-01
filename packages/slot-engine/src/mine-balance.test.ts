import { describe, expect, it } from "vitest";
import { evaluateMineSpin, mineGridFromRows } from "./mine-mojo.js";

describe("mine-mojo balance fixes", () => {
  it("pays scatter once when there are no line wins", () => {
    const grid = mineGridFromRows([
      ["dynamite", "pick", "pick"],
      ["dynamite", "pick", "pick"],
      ["dynamite", "pick", "pick"],
      ["pick", "pick", "pick"],
      ["pick", "pick", "pick"],
    ]);
    const result = evaluateMineSpin(grid, 1);
    expect(result.lineWins.length).toBe(0);
    expect(result.totalPayout).toBe(4);
  });
});
