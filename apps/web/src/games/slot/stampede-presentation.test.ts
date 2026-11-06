import { describe, expect, it } from "vitest";
import { readStampedeShow, stampedeTimeline, WIN_BEAT_MS, EXPAND_HOLD_MS } from "./stampede-presentation.js";

describe("readStampedeShow", () => {
  it("plays the opening wins, the scatter, then the respin coyote", () => {
    const show = readStampedeShow({
      meta: {
        expandingWild: true,
        preRespinGrid: [
          ["cactus", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
          ["dust", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
        ],
        baseScatterCount: 3,
        baseScatterCells: [
          { reel: 0, row: 0 },
          { reel: 1, row: 1 },
          { reel: 4, row: 2 },
        ],
      },
      waysWins: [
        { symbol: "cactus", reelCount: 5, ways: 8, multiplier: 160, phase: "base", cells: [{ reel: 0, row: 0 }] },
        {
          symbol: "coyote",
          reelCount: 4,
          ways: 6,
          multiplier: 120,
          phase: "respin",
          cells: [
            { reel: 0, row: 2 },
            { reel: 1, row: 0 },
          ],
        },
      ],
    });
    expect(show.expanding).toBe(true);
    expect(show.openingBeats.map((beat) => beat.label)).toEqual([
      "Opening spin · Cactus 5-reel · 8 ways (160×)",
      "Opening spin · Moon scatter ×3",
    ]);
    expect(show.respinBeats.map((beat) => beat.label)).toEqual([
      "Respin · Coyote 4-reel · 6 ways (120×)",
    ]);
    expect(show.openingBeats[1]?.cells).toHaveLength(3);
  });

  it("keeps a single board when the wild does not expand", () => {
    const show = readStampedeShow({
      waysWins: [{ symbol: "eagle", reelCount: 5, ways: 1, multiplier: 60, phase: "base", cells: [] }],
      scatterCount: 3,
      scatterMultiplier: 10,
      meta: {
        scatterCells: [
          { reel: 0, row: 1 },
          { reel: 2, row: 0 },
          { reel: 4, row: 2 },
        ],
      },
    });
    expect(show.expanding).toBe(false);
    expect(show.openingBeats.map((beat) => beat.label)).toEqual([
      "Eagle 5-reel · 1 way (60×)",
      "Moon scatter ×3",
    ]);
    expect(show.respinBeats).toHaveLength(0);
    expect(show.openingBeats[1]?.cells).toHaveLength(3);
  });

  it("holds each opening win, the expand, and the respin before the total", () => {
    const show = readStampedeShow({
      meta: {
        expandingWild: true,
        preRespinGrid: [
          ["cactus", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
          ["dust", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
          ["cactus", "cactus", "cactus"],
        ],
      },
      waysWins: [
        { symbol: "cactus", reelCount: 5, ways: 8, multiplier: 160, phase: "base", cells: [{ reel: 0, row: 0 }] },
        { symbol: "coyote", reelCount: 4, ways: 6, multiplier: 120, phase: "respin", cells: [{ reel: 0, row: 2 }] },
      ],
    });
    const finalGrid = [
      ["cactus", "tumbleweed", "coyote"],
      ["coyote", "coyote", "eagle"],
      ["dust", "dust", "dust"],
      ["dust", "moon", "cactus"],
      ["cactus", "tumbleweed", "tumbleweed"],
    ];
    const cues = stampedeTimeline({ show, finalGrid });
    expect(cues.map((cue) => cue.kind)).toEqual(["spin", "beat", "expand", "spin", "beat"]);
    expect(cues[0]).toMatchObject({ banner: "Spinning…", lockedReels: [] });
    expect(cues[1]).toMatchObject({ label: "Opening spin · Cactus 5-reel · 8 ways (160×)", ms: WIN_BEAT_MS });
    expect(cues[2]).toMatchObject({ banner: "Dust Wild expands across reel 3", ms: EXPAND_HOLD_MS });
    expect(cues[3]).toMatchObject({ banner: "Respinning…", lockedReels: [2], grid: finalGrid });
    expect(cues[4]).toMatchObject({ label: "Respin · Coyote 4-reel · 6 ways (120×)", ms: WIN_BEAT_MS });
  });
});
