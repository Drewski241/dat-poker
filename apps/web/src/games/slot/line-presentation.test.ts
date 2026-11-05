import { describe, expect, it } from "vitest";
import { LINE_HOLD_MS, lineWinCues } from "./line-presentation.js";

const grid = [
  ["seven", "bar", "scatter"],
  ["seven", "bar", "cherry"],
  ["seven", "wild", "scatter"],
  ["bar", "bar", "cherry"],
  ["cherry", "bar", "scatter"],
];

describe("lineWinCues", () => {
  it("holds each winning line long enough to read", () => {
    const cues = lineWinCues({
      grid,
      lineWins: [
        { lineIndex: 1, symbol: "seven", count: 3, multiplier: 5, cells: [{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 2, row: 0 }] },
        { lineIndex: 0, symbol: "bar", count: 4, multiplier: 10, cells: [{ reel: 0, row: 1 }] },
      ],
      symbolLabel: (symbol) => symbol,
    });
    expect(cues.map((cue) => cue.label)).toEqual([
      "Line 2 · Top row: seven ×3 (5×)",
      "Line 1 · Center row: bar ×4 (10×)",
    ]);
    expect(cues.every((cue) => cue.ms === LINE_HOLD_MS)).toBe(true);
    expect(LINE_HOLD_MS).toBeGreaterThanOrEqual(2200);
    expect(cues[0]?.lineIndex).toBe(1);
    expect(cues[1]?.cells).toEqual([{ reel: 0, row: 1 }]);
  });

  it("returns nothing when the spin does not pay", () => {
    expect(lineWinCues({ grid, lineWins: [], symbolLabel: (symbol) => symbol })).toEqual([]);
  });

  it("lights scatter symbols and the progressive on their own beats", () => {
    const cues = lineWinCues({
      grid,
      lineWins: [],
      scatterCount: 3,
      scatterMultiplier: 4,
      scatterSymbol: "scatter",
      wonProgressive: true,
      progressiveLabel: "Progressive jackpot!",
      symbolLabel: (symbol) => symbol,
    });
    expect(cues[0]).toMatchObject({
      lineIndex: null,
      label: "Scatter ×3 (4×)",
      cells: [
        { reel: 0, row: 2 },
        { reel: 2, row: 2 },
        { reel: 4, row: 2 },
      ],
    });
    expect(cues[1]).toMatchObject({ lineIndex: 0, label: "Progressive jackpot!" });
    expect(cues[1]?.cells).toHaveLength(5);
  });
});
