import { describe, expect, it } from "vitest";
import {
  cellsThatFall,
  MINE_FALL_MS,
  MINE_LINE_MS,
  MINE_POP_MS,
  MINE_STOP_MS,
  mineTimeline,
  type MineCascadeFrame,
} from "./mine-presentation.js";

const opening = [
  ["emerald", "ruby", "sapphire"],
  ["emerald", "ruby", "sapphire"],
  ["emerald", "ruby", "sapphire"],
  ["motherlode", "emerald", "sapphire"],
  ["motherlode", "emerald", "sapphire"],
];

const afterFirst = [
  ["ruby", "emerald", "sapphire"],
  ["ruby", "emerald", "sapphire"],
  ["ruby", "emerald", "sapphire"],
  ["motherlode", "emerald", "sapphire"],
  ["motherlode", "emerald", "sapphire"],
];

const finalGrid = [
  ["ruby", "emerald", "sapphire"],
  ["pick", "emerald", "sapphire"],
  ["ruby", "emerald", "sapphire"],
  ["motherlode", "emerald", "sapphire"],
  ["dynamite", "emerald", "sapphire"],
];

function frame(grid: string[][], wins: MineCascadeFrame["lineWins"]): MineCascadeFrame {
  return {
    grid,
    multiplier: 1,
    lineWins: wins,
    scatterCount: 0,
    scatterMultiplier: 0,
    scatterCells: [],
  };
}

describe("mineTimeline", () => {
  it("holds each winning line on its own board, then drops to the next", () => {
    const cues = mineTimeline({
      finalGrid,
      meta: {
        cascades: [
          frame(opening, [
            {
              lineIndex: 0,
              symbol: "ruby",
              count: 3,
              multiplier: 2,
              cells: [
                { reel: 0, row: 1 },
                { reel: 1, row: 1 },
                { reel: 2, row: 1 },
              ],
            },
            {
              lineIndex: 5,
              symbol: "emerald",
              count: 3,
              multiplier: 2,
              cells: [
                { reel: 0, row: 0 },
                { reel: 1, row: 0 },
                { reel: 2, row: 1 },
              ],
            },
          ]),
          frame(afterFirst, [
            {
              lineIndex: 4,
              symbol: "sapphire",
              count: 3,
              multiplier: 3,
              cells: [
                { reel: 0, row: 2 },
                { reel: 1, row: 1 },
                { reel: 2, row: 0 },
              ],
            },
          ]),
        ],
      },
    });

    expect(cues.map((cue) => cue.kind)).toEqual(["spin", "line", "line", "drop", "line", "drop"]);
    expect(cues[0]).toMatchObject({ kind: "spin", grid: opening, stopMs: MINE_STOP_MS });
    expect(cues[1]).toMatchObject({
      kind: "line",
      lineIndex: 0,
      ms: MINE_LINE_MS,
      label: "Cascade 1 of 2 · Line 1 · Center row: Gold Nugget ×3 (2×)",
    });
    expect(cues[2]).toMatchObject({
      kind: "line",
      lineIndex: 5,
      label: "Cascade 1 of 2 · Line 6 · Zig down: Mojo Ore ×3 (2×)",
    });
    expect(cues[3]).toMatchObject({
      kind: "drop",
      grid: afterFirst,
      label: "Winning gems clear",
      popMs: MINE_POP_MS,
      fallMs: MINE_FALL_MS,
    });
    expect(cues[4]).toMatchObject({
      kind: "line",
      grid: afterFirst,
      lineIndex: 4,
      label: "Cascade 2 of 2 · Line 5 · V up: Cave Crystal ×3 (3×)",
    });
    expect(cues[5]).toMatchObject({ kind: "drop", grid: finalGrid });
  });

  it("returns no cues for a spin with nothing to show", () => {
    expect(mineTimeline({ finalGrid, meta: { cascades: [] } })).toEqual([]);
    expect(mineTimeline({ finalGrid })).toEqual([]);
  });

  it("shows a blast-charge scatter without dropping the board", () => {
    const cues = mineTimeline({
      finalGrid: opening,
      meta: {
        cascades: [
          {
            grid: opening,
            multiplier: 1,
            lineWins: [],
            scatterCount: 3,
            scatterMultiplier: 4,
            scatterCells: [
              { reel: 0, row: 0 },
              { reel: 1, row: 1 },
              { reel: 2, row: 2 },
            ],
          },
        ],
      },
    });
    expect(cues.map((cue) => cue.kind)).toEqual(["spin", "line"]);
    expect(cues[1]).toMatchObject({
      lineIndex: null,
      label: "Cascade 1 of 1 · Blast Charge ×3 (4×)",
      cells: [
        { reel: 0, row: 0 },
        { reel: 1, row: 1 },
        { reel: 2, row: 2 },
      ],
    });
  });
});

describe("cellsThatFall", () => {
  it("fills new symbols from the top and drops only the survivors that move", () => {
    expect(cellsThatFall([{ reel: 0, row: 2 }])).toEqual([
      { reel: 0, row: 0 },
      { reel: 0, row: 1 },
      { reel: 0, row: 2 },
    ]);
    expect(cellsThatFall([{ reel: 1, row: 0 }])).toEqual([{ reel: 1, row: 0 }]);
    expect(cellsThatFall([{ reel: 2, row: 1 }])).toEqual([
      { reel: 2, row: 0 },
      { reel: 2, row: 1 },
    ]);
  });
});
