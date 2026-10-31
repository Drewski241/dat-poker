import { PAYLINES } from "./paylines.js";
import {
  PAYTABLE,
  REEL_STRIP,
  SCATTER_PAY_ANYWHERE,
  type SymbolId,
} from "./symbols.js";

export type Grid = SymbolId[][];

export interface LineWin {
  lineIndex: number;
  symbol: SymbolId;
  count: number;
  multiplier: number;
  payout: number;
  cells: { reel: number; row: number }[];
}

export interface SpinResult {
  grid: Grid;
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
  totalPayout: number;
}

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

/** Build 5 reels × 3 visible rows (top/mid/bot from consecutive strip positions). */
export function spinGrid(): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const start = randomInt(REEL_STRIP.length);
    for (let row = 0; row < 3; row++) {
      grid[reel]!.push(REEL_STRIP[(start + row) % REEL_STRIP.length]!);
    }
  }
  return grid;
}

function resolveLineSymbol(symbols: SymbolId[]): SymbolId | null {
  const nonWild = symbols.filter((s) => s !== "wild" && s !== "scatter");
  if (nonWild.length === 0) return null;
  const base = nonWild[0]!;
  if (nonWild.some((s) => s !== base)) return null;
  return base;
}

function countRun(symbols: SymbolId[], base: SymbolId): number {
  let n = 0;
  for (const s of symbols) {
    if (s === base || s === "wild") n++;
    else break;
  }
  return n;
}

export function evaluateSpin(grid: Grid, lineBet: number): SpinResult {
  const lineWins: LineWin[] = [];

  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li]!;
    const symbols: SymbolId[] = pattern.map((row, reel) => grid[reel]![row]!);
    const base = resolveLineSymbol(symbols);
    if (!base || base === "scatter") continue;
    const table = PAYTABLE[base];
    if (!table) continue;

    const count = countRun(symbols, base);
    if (count < 3) continue;

    const multiplier = table[count - 3] ?? 0;
    if (multiplier <= 0) continue;

    const payout = multiplier * lineBet;
    const cells = pattern.slice(0, count).map((row, reel) => ({ reel, row }));
    lineWins.push({
      lineIndex: li,
      symbol: base,
      count,
      multiplier,
      payout,
      cells,
    });
  }

  let scatterCount = 0;
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) {
      if (grid[reel]![row] === "scatter") scatterCount++;
    }
  }

  let scatterMultiplier = 0;
  for (const [need, mult] of Object.entries(SCATTER_PAY_ANYWHERE)) {
    if (scatterCount >= Number(need)) scatterMultiplier = mult;
  }

  const lineMultiplier = lineWins.reduce((s, w) => s + w.multiplier, 0);
  const linePayout = lineWins.reduce((s, w) => s + w.payout, 0);
  const scatterPayout = scatterMultiplier * lineBet;
  const totalMultiplier = lineMultiplier + scatterMultiplier;
  const totalPayout = linePayout + scatterPayout;

  return {
    grid,
    lineWins,
    scatterCount,
    scatterMultiplier,
    totalMultiplier,
    totalPayout,
  };
}

export type WinTier = "none" | "win" | "big" | "mega" | "jackpot";

export function winTier(totalMultiplier: number): WinTier {
  if (totalMultiplier >= 100) return "jackpot";
  if (totalMultiplier >= 25) return "mega";
  if (totalMultiplier >= 10) return "big";
  if (totalMultiplier > 0) return "win";
  return "none";
}

export function spin(lineBet: number): SpinResult {
  return evaluateSpin(spinGrid(), lineBet);
}

/** Five Lucky 7s on the center payline wins the progressive jackpot. */
export function isProgressiveJackpotGrid(grid: Grid): boolean {
  const centerLine = PAYLINES[0]!;
  return centerLine.every((row, reel) => grid[reel]![row] === "seven");
}

/** Deterministic grid for demos / tests. */
export function gridFromRows(rows: [SymbolId, SymbolId, SymbolId][]): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const col = rows[reel];
    if (!col) throw new Error("gridFromRows needs 5 columns");
    grid[reel] = [...col];
  }
  return grid;
}
