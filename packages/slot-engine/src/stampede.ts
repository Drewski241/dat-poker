import { REEL_STRIP, type SymbolId } from "./symbols.js";
import type { Grid, SlotSpinCore, WaysWin } from "./types.js";

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

export function spinStampedeGrid(): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const start = randomInt(REEL_STRIP.length);
    for (let row = 0; row < 3; row++) {
      grid[reel]!.push(REEL_STRIP[(start + row) % REEL_STRIP.length]!);
    }
  }
  return grid;
}

const WAYS_PAYTABLE: Partial<Record<SymbolId, [number, number, number, number, number]>> = {
  cherry: [1, 2, 5, 10, 20],
  lemon: [1, 3, 6, 12, 25],
  bell: [2, 4, 10, 20, 40],
  chip: [2, 5, 15, 30, 60],
  ace: [3, 8, 20, 40, 80],
  king: [3, 10, 25, 50, 100],
  seven: [5, 15, 50, 100, 250],
};

function waysForSymbol(grid: Grid, symbol: SymbolId): WaysWin | null {
  let reel = 0;
  let ways = 1;
  const counts: number[] = [];
  while (reel < 5) {
    let hits = 0;
    for (let row = 0; row < 3; row++) {
      const cell = grid[reel]![row]!;
      if (cell === symbol || cell === "wild") hits++;
    }
    if (hits === 0) break;
    counts.push(hits);
    ways *= hits;
    reel++;
  }
  if (reel < 3) return null;
  const table = WAYS_PAYTABLE[symbol];
  if (!table) return null;
  const mult = table[reel - 1] ?? 0;
  if (mult <= 0) return null;
  return {
    symbol,
    reelCount: reel,
    ways,
    multiplier: mult * ways,
    payout: mult * ways,
  };
}

export function evaluateStampedeSpin(grid: Grid, lineBet: number): SlotSpinCore {
  const symbols = Object.keys(WAYS_PAYTABLE) as SymbolId[];
  const waysWins: WaysWin[] = [];
  for (const sym of symbols) {
    const w = waysForSymbol(grid, sym);
    if (w) {
      waysWins.push({
        ...w,
        payout: w.payout * lineBet,
        multiplier: w.multiplier,
      });
    }
  }

  let scatterCount = 0;
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) {
      if (grid[reel]![row] === "scatter") scatterCount++;
    }
  }
  let scatterMultiplier = 0;
  if (scatterCount >= 3) scatterMultiplier = 10;

  const waysMultiplier = waysWins.reduce((s, w) => s + w.multiplier, 0);
  const waysPayout = waysWins.reduce((s, w) => s + w.payout, 0);
  const scatterPayout = scatterMultiplier * lineBet;

  return {
    grid,
    lineWins: [],
    waysWins,
    scatterCount,
    scatterMultiplier,
    totalMultiplier: waysMultiplier + scatterMultiplier,
    totalPayout: waysPayout + scatterPayout,
  };
}

/** Expanding wild on reel index 2 (middle reel) triggers one respin of other reels. */
export function applyStampedeExpandingWild(grid: Grid): { grid: Grid; respun: boolean } {
  let wildOnMiddle = false;
  for (let row = 0; row < 3; row++) {
    if (grid[2]![row] === "wild") wildOnMiddle = true;
  }
  if (!wildOnMiddle) return { grid, respun: false };

  const next = grid.map((col) => [...col]) as Grid;
  for (let row = 0; row < 3; row++) next[2]![row] = "wild";

  for (const reel of [0, 1, 3, 4]) {
    const start = randomInt(REEL_STRIP.length);
    for (let row = 0; row < 3; row++) {
      next[reel]![row] = REEL_STRIP[(start + row) % REEL_STRIP.length]!;
    }
  }
  return { grid: next, respun: true };
}

export function spinStampedeRound(lineBet: number): SlotSpinCore {
  let grid = spinStampedeGrid();
  const first = evaluateStampedeSpin(grid, lineBet);
  const expanded = applyStampedeExpandingWild(grid);
  if (!expanded.respun) {
    return { ...first, meta: { expandingWild: false } };
  }
  const second = evaluateStampedeSpin(expanded.grid, lineBet);
  return {
    ...second,
    totalMultiplier: first.totalMultiplier + second.totalMultiplier,
    totalPayout: first.totalPayout + second.totalPayout,
    waysWins: [...first.waysWins, ...second.waysWins],
    meta: { expandingWild: true, preRespinGrid: grid },
  };
}

export function isStampedeProgressiveGrid(grid: Grid): boolean {
  for (let reel = 0; reel < 5; reel++) {
    let hasWild = false;
    for (let row = 0; row < 3; row++) {
      if (grid[reel]![row] === "wild") hasWild = true;
    }
    if (!hasWild) return false;
  }
  return true;
}
