import { PAYLINES } from "./paylines.js";
import type { Grid, HouseEdgeState, LineWin, SlotSpinCore } from "./types.js";

export type HouseSymbolId = "chip" | "cards" | "dice" | "vault" | "dealer" | "wild" | "skull";

export const HOUSE_SYMBOLS: Record<
  HouseSymbolId,
  { label: string; emoji: string }
> = {
  chip: { label: "High-Roller Stack", emoji: "🎰" },
  cards: { label: "Marked Deck", emoji: "🃏" },
  dice: { label: "Loaded Dice", emoji: "🎲" },
  vault: { label: "House Vault", emoji: "🔐" },
  dealer: { label: "The House", emoji: "🎩" },
  wild: { label: "Inside Job", emoji: "🎭" },
  skull: { label: "The Rake", emoji: "☠️" },
};

const HOUSE_STRIP: HouseSymbolId[] = [
  "chip",
  "chip",
  "cards",
  "cards",
  "dice",
  "dice",
  "vault",
  "wild",
  "skull",
  "dealer",
  "chip",
  "cards",
  "dice",
  "vault",
  "dealer",
];

export const HOUSE_LINE_PAYTABLE: Partial<Record<HouseSymbolId, [number, number, number]>> = {
  chip: [2, 5, 10],
  cards: [3, 8, 16],
  dice: [4, 10, 20],
  vault: [6, 15, 30],
  dealer: [10, 25, 60],
};

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

export function defaultHouseEdgeState(): HouseEdgeState {
  return { bossHp: 100, freeSpinsRemaining: 0, bossBonusActive: false };
}

export function spinHouseGrid(bossBonusActive: boolean): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    const start = randomInt(HOUSE_STRIP.length);
    for (let row = 0; row < 3; row++) {
      let sym = HOUSE_STRIP[(start + row) % HOUSE_STRIP.length]!;
      if (bossBonusActive && reel === 2 && row === 1 && randomInt(100) < 40) {
        sym = "wild";
      }
      grid[reel]!.push(sym);
    }
  }
  return grid;
}

function paylineBase(symbols: string[]): HouseSymbolId | null {
  for (const s of symbols) {
    if (s === "wild" || s === "skull") continue;
    return s as HouseSymbolId;
  }
  return null;
}

function countRun(symbols: string[], base: HouseSymbolId): number {
  let n = 0;
  for (const s of symbols) {
    if (s === base || s === "wild") n++;
    else break;
  }
  return n;
}

export function evaluateHouseSpin(
  grid: Grid,
  lineBet: number,
  state: HouseEdgeState,
): SlotSpinCore & { nextState: HouseEdgeState } {
  const lineWins: LineWin[] = [];
  const bonusMult = state.bossBonusActive ? 2 : 1;

  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li]!;
    const symbols = pattern.map((row, reel) => grid[reel]![row]! as string);
    const base = paylineBase(symbols);
    if (!base) continue;
    const table = HOUSE_LINE_PAYTABLE[base];
    if (!table) continue;
    const count = countRun(symbols, base);
    if (count < 3) continue;
    const mult = (table[count - 3] ?? 0) * bonusMult;
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
      if (grid[reel]![row] === "skull") scatterCount++;
    }
  }
  let scatterMultiplier = 0;
  if (scatterCount >= 3) scatterMultiplier = 8 * bonusMult;

  const totalMultiplier =
    lineWins.reduce((s, w) => s + w.multiplier, 0) + scatterMultiplier;
  const totalPayout =
    lineWins.reduce((s, w) => s + w.payout, 0) + scatterMultiplier * lineBet;

  let nextState: HouseEdgeState = { ...state };
  if (totalPayout > 0) {
    const drain = Math.min(35, 10 + Math.floor(totalMultiplier / 2));
    nextState.bossHp = Math.max(0, nextState.bossHp - drain);
  } else {
    nextState.bossHp = Math.min(100, nextState.bossHp + 3);
  }

  if (nextState.bossHp <= 0 && nextState.freeSpinsRemaining <= 0) {
    nextState.bossHp = 100;
    nextState.freeSpinsRemaining = 5;
    nextState.bossBonusActive = true;
  }

  if (nextState.freeSpinsRemaining > 0) {
    nextState.freeSpinsRemaining -= 1;
    if (nextState.freeSpinsRemaining <= 0) {
      nextState.bossBonusActive = false;
    }
  }

  return {
    grid,
    lineWins,
    waysWins: [],
    scatterCount,
    scatterMultiplier,
    totalMultiplier,
    totalPayout,
    nextState,
    meta: {
      bossHp: nextState.bossHp,
      freeSpinsRemaining: nextState.freeSpinsRemaining,
      bossBonusActive: nextState.bossBonusActive,
    },
  };
}

export function isHouseProgressiveGrid(grid: Grid, bossBonusActive: boolean): boolean {
  if (!bossBonusActive) return false;
  const center = PAYLINES[0]!;
  return center.every((row, reel) => grid[reel]![row] === "dealer");
}
