import { describe, expect, it } from "vitest";
import {
  BIG_WIN_MULTIPLIER,
  REEL_STRIPS,
  buildGrid,
  scoreGrid,
  spinSlots,
  type SlotSymbol,
  type SpinRng,
} from "./dat-slots.js";

function stopForRow(strip: readonly SlotSymbol[], symbol: SlotSymbol, row: number): number {
  const at = strip.indexOf(symbol);
  if (at < 0) throw new Error(`missing ${symbol}`);
  return (at - row + strip.length) % strip.length;
}

describe("dat slots", () => {
  it("scores three sevens on the middle line as an 8× big win", () => {
    const grid: SlotSymbol[][] = [
      ["cherry", "lemon", "bar"],
      ["seven", "seven", "seven"],
      ["lemon", "bar", "bell"],
    ];
    const spin = scoreGrid(grid, 2_000n);
    expect(spin.wins).toHaveLength(1);
    expect(spin.wins[0]?.multiplier).toBe(40);
    expect(spin.payoutMojos).toBe(80_000n);
    expect(spin.totalBetMojos).toBe(10_000n);
    expect(spin.bigWin).toBe(true);
    expect(spin.payoutMojos / spin.totalBetMojos).toBe(BigInt(BIG_WIN_MULTIPLIER));
  });

  it("sums two paying lines and stays under a big win for clover", () => {
    const clover: SlotSymbol[][] = [
      ["cherry", "lemon", "bar"],
      ["clover", "clover", "clover"],
      ["lemon", "bar", "bell"],
    ];
    const spin = scoreGrid(clover, 1_000n);
    expect(spin.payoutMojos).toBe(25_000n);
    expect(spin.bigWin).toBe(false);
  });

  it("pays nothing when no line matches", () => {
    const grid: SlotSymbol[][] = [
      ["cherry", "lemon", "bar"],
      ["lemon", "bar", "bell"],
      ["bell", "cherry", "clover"],
    ];
    const spin = scoreGrid(grid, 1_000n);
    expect(spin.wins).toHaveLength(0);
    expect(spin.payoutMojos).toBe(0n);
    expect(spin.bigWin).toBe(false);
  });

  it("reads the visible window from the reel stop", () => {
    let calls = 0;
    const rng: SpinRng = {
      nextInt(max) {
        calls += 1;
        expect(max).toBe(REEL_STRIPS[calls - 1]!.length);
        return 0;
      },
    };
    const grid = buildGrid(rng);
    expect(calls).toBe(3);
    expect(grid[0]![0]).toBe(REEL_STRIPS[0][0]);
    expect(grid[1]![1]).toBe(REEL_STRIPS[1][1]);
    expect(grid[2]![2]).toBe(REEL_STRIPS[2][2]);
  });

  it("can force a DAT line from reel indexes", () => {
    const stops = REEL_STRIPS.map((strip) => stopForRow(strip, "dat", 1));
    let i = 0;
    const spin = spinSlots(2_000n, { nextInt: () => stops[i++]! });
    expect(spin.grid[1]).toEqual(["dat", "dat", "dat"]);
    expect(spin.bigWin).toBe(true);
    expect(spin.payoutMojos).toBe(200_000n);
  });

  it("lands big wins often enough for a short how-to", () => {
    const n = 3_000;
    let big = 0;
    for (let i = 0; i < n; i += 1) {
      if (spinSlots(1_000n).bigWin) big += 1;
    }
    const rate = big / n;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.4);
  });
});
