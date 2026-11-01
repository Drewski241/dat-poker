import { PAYLINES } from "./paylines.js";
import type { Grid, LineWin, SlotSpinCore } from "./types.js";

export type MineSymbolId =
  | "ruby"
  | "emerald"
  | "sapphire"
  | "pick"
  | "dynamite"
  | "motherlode";

export const MINE_SYMBOLS: Record<
  MineSymbolId,
  { label: string; emoji: string; tier: "low" | "mid" | "high" | "special" }
> = {
  ruby: { label: "Gold Nugget", emoji: "🪙", tier: "low" },
  emerald: { label: "Mojo Ore", emoji: "💚", tier: "low" },
  sapphire: { label: "Cave Crystal", emoji: "💠", tier: "mid" },
  pick: { label: "Pickaxe Wild", emoji: "⛏️", tier: "special" },
  dynamite: { label: "Blast Charge", emoji: "🧨", tier: "special" },
  motherlode: { label: "Mother Lode", emoji: "🏆", tier: "high" },
};

const MINE_STRIP: MineSymbolId[] = [
  "ruby",
  "ruby",
  "emerald",
  "emerald",
  "sapphire",
  "sapphire",
  "pick",
  "dynamite",
  "motherlode",
  "ruby",
  "emerald",
  "sapphire",
  "pick",
  "ruby",
  "emerald",
];

export const MINE_LINE_PAYTABLE: Partial<Record<MineSymbolId, [number, number, number]>> = {
  ruby: [2, 4, 10],
  emerald: [2, 5, 12],
  sapphire: [3, 8, 18],
  motherlode: [8, 22, 55],
};

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

export function spinMineGrid(): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const start = randomInt(MINE_STRIP.length);
    for (let row = 0; row < 3; row++) {
      grid[reel]!.push(MINE_STRIP[(start + row) % MINE_STRIP.length]!);
    }
  }
  return grid;
}

function paylineBaseMine(symbols: string[]): MineSymbolId | null {
  for (const s of symbols) {
    if (s === "pick" || s === "dynamite") continue;
    return s as MineSymbolId;
  }
  return null;
}

function countMineRun(symbols: string[], base: MineSymbolId): number {
  let n = 0;
  for (const s of symbols) {
    if (s === base || s === "pick") n++;
    else break;
  }
  return n;
}

function evaluateMineGrid(
  grid: Grid,
  lineBet: number,
  cascadeMultiplier: number,
  includeScatter: boolean,
): {
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  linePayout: number;
  totalMultiplier: number;
  totalPayout: number;
} {
  const lineWins: LineWin[] = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li]!;
    const symbols = pattern.map((row, reel) => grid[reel]![row]! as string);
    const base = paylineBaseMine(symbols);
    if (!base) continue;
    const table = MINE_LINE_PAYTABLE[base];
    if (!table) continue;
    const count = countMineRun(symbols, base);
    if (count < 3) continue;
    const mult = (table[count - 3] ?? 0) * cascadeMultiplier;
    if (mult <= 0) continue;
    lineWins.push({
      lineIndex: li,
      symbol: base,
      count,
      multiplier: mult,
      payout: mult * lineBet,
      cells: pattern.slice(0, count).map((row, reel) => ({ reel, row })),
    });
  }

  let scatterCount = 0;
  let scatterMultiplier = 0;
  if (includeScatter) {
    for (let reel = 0; reel < 5; reel++) {
      for (let row = 0; row < 3; row++) {
        if (grid[reel]![row] === "dynamite") scatterCount++;
      }
    }
    if (scatterCount >= 5) scatterMultiplier = 40;
    else if (scatterCount >= 4) scatterMultiplier = 12;
    else if (scatterCount >= 3) scatterMultiplier = 4;
  }

  const lineMultiplier = lineWins.reduce((s, w) => s + w.multiplier, 0);
  const linePayout = lineWins.reduce((s, w) => s + w.payout, 0);
  const scatterPayout = scatterMultiplier * lineBet;
  return {
    lineWins,
    scatterCount,
    scatterMultiplier,
    linePayout,
    totalMultiplier: lineMultiplier + scatterMultiplier,
    totalPayout: linePayout + scatterPayout,
  };
}

function removeWinCells(grid: Grid, cells: { reel: number; row: number }[]): Grid {
  const drop = new Set(cells.map((c) => `${c.reel}-${c.row}`));
  const next: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const remaining: string[] = [];
    for (let row = 0; row < 3; row++) {
      if (!drop.has(`${reel}-${row}`)) remaining.push(grid[reel]![row]! as string);
    }
    while (remaining.length < 3) {
      remaining.unshift(MINE_STRIP[randomInt(MINE_STRIP.length)]!);
    }
    next[reel] = remaining.slice(-3) as Grid[number];
  }
  return next;
}

export function evaluateMineSpin(grid: Grid, lineBet: number): SlotSpinCore {
  let working = grid.map((c) => [...c]) as Grid;
  let totalPayout = 0;
  let totalMultiplier = 0;
  const allLineWins: LineWin[] = [];
  let cascadeSteps = 0;
  let cascadeMultiplier = 1;

  for (let step = 0; step < 8; step++) {
    const round = evaluateMineGrid(working, lineBet, cascadeMultiplier, step === 0);
    if (round.lineWins.length === 0) {
      if (step === 0 && round.scatterMultiplier > 0) {
        cascadeSteps = 1;
        totalPayout += round.scatterMultiplier * lineBet;
        totalMultiplier += round.scatterMultiplier;
      }
      break;
    }
    cascadeSteps++;
    totalPayout += round.linePayout;
    totalMultiplier += round.lineWins.reduce((s, w) => s + w.multiplier, 0);
    if (step === 0 && round.scatterMultiplier > 0) {
      totalPayout += round.scatterMultiplier * lineBet;
      totalMultiplier += round.scatterMultiplier;
    }
    allLineWins.push(...round.lineWins);

    const cells = round.lineWins.flatMap((w) => w.cells);
    working = removeWinCells(working, cells);
    cascadeMultiplier = Math.min(1 + step * 0.15, 1.75);
  }

  let scatterCount = 0;
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) {
      if (working[reel]![row] === "dynamite") scatterCount++;
    }
  }

  return {
    grid: working,
    lineWins: allLineWins,
    waysWins: [],
    scatterCount,
    scatterMultiplier: 0,
    totalMultiplier,
    totalPayout,
    meta: { cascadeSteps, finalCascadeMultiplier: cascadeMultiplier, initialGrid: grid },
  };
}

export function isMineProgressiveGrid(grid: Grid): boolean {
  const center = PAYLINES[0]!;
  return center.every((row, reel) => grid[reel]![row] === "motherlode");
}

/** @internal test helper */
export function mineGridFromRows(rows: MineSymbolId[][]): Grid {
  return rows.map((col) => [...col]) as Grid;
}
