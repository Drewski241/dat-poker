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
  ruby: { label: "Ruby", emoji: "🔴", tier: "low" },
  emerald: { label: "Emerald", emoji: "🟢", tier: "low" },
  sapphire: { label: "Sapphire", emoji: "🔵", tier: "mid" },
  pick: { label: "Pickaxe", emoji: "⛏️", tier: "special" },
  dynamite: { label: "Dynamite", emoji: "🧨", tier: "special" },
  motherlode: { label: "Mother Lode", emoji: "💎", tier: "high" },
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

const MINE_PAYTABLE: Partial<Record<MineSymbolId, [number, number, number]>> = {
  ruby: [2, 5, 12],
  emerald: [3, 7, 15],
  sapphire: [5, 12, 25],
  motherlode: [15, 40, 100],
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

function evaluateMineGrid(grid: Grid, lineBet: number, cascadeMultiplier: number): {
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
  totalPayout: number;
} {
  const lineWins: LineWin[] = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li]!;
    const symbols = pattern.map((row, reel) => grid[reel]![row]! as string);
    const base = paylineBaseMine(symbols);
    if (!base) continue;
    const table = MINE_PAYTABLE[base];
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
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) {
      if (grid[reel]![row] === "dynamite") scatterCount++;
    }
  }
  let scatterMultiplier = 0;
  if (scatterCount >= 5) scatterMultiplier = 100;
  else if (scatterCount >= 4) scatterMultiplier = 20;
  else if (scatterCount >= 3) scatterMultiplier = 5;

  const lineMultiplier = lineWins.reduce((s, w) => s + w.multiplier, 0);
  const linePayout = lineWins.reduce((s, w) => s + w.payout, 0);
  const scatterPayout = scatterMultiplier * lineBet;
  return {
    lineWins,
    scatterCount,
    scatterMultiplier,
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
    const round = evaluateMineGrid(working, lineBet, cascadeMultiplier);
    if (round.lineWins.length === 0 && round.scatterMultiplier === 0) break;
    cascadeSteps++;
    totalPayout += round.totalPayout;
    totalMultiplier += round.totalMultiplier;
    allLineWins.push(...round.lineWins);

    const cells = round.lineWins.flatMap((w) => w.cells);
    if (cells.length === 0) break;
    working = removeWinCells(working, cells);
    cascadeMultiplier = Math.min(cascadeMultiplier + 1, 6);
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
