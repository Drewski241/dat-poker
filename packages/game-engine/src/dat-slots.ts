import { randomBytes } from "node:crypto";

export const SLOT_SYMBOLS = ["cherry", "lemon", "bar", "bell", "clover", "seven", "dat"] as const;

export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** Five classic lines on a 3×3 window. Row 0 is the top. */
export const PAYLINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
] as const;

/** Payout multiplier applied to the per-line bet for three of a kind. */
export const THREE_KIND_MULTIPLIER: Record<SlotSymbol, number> = {
  cherry: 5,
  lemon: 5,
  bar: 10,
  bell: 15,
  clover: 25,
  seven: 40,
  dat: 100,
};

export const SYMBOL_LABEL: Record<SlotSymbol, string> = {
  cherry: "Cherry",
  lemon: "Lemon",
  bar: "Bar",
  bell: "Bell",
  clover: "Clover",
  seven: "Seven",
  dat: "DAT",
};

/**
 * Big win when the spin pays at least this many times the total stake
 * (per-line bet × line count). Three sevens is exactly 8×.
 */
export const BIG_WIN_MULTIPLIER = 8;

export const SLOTS_LINE_COUNT = PAYLINES.length;

/** Demo stake choices, in CAT mojos (1000 mojos = 1 DAT). */
export const SLOTS_BET_OPTIONS_MOJOS = [1_000n, 2_000n, 5_000n, 10_000n] as const;

export const SLOTS_DEFAULT_BET_PER_LINE_MOJOS = 2_000n;

export const SLOTS_STARTING_BANKROLL_MOJOS = 5_000_000n;

/**
 * Each reel shows a 3-symbol window. Sevens and DAT are common enough that a
 * short how-to session can reach an 8× win without a scripted result.
 */
export const REEL_STRIPS = [
  ["seven", "cherry", "dat", "seven", "lemon", "bell", "seven", "bar", "dat", "clover"],
  ["dat", "seven", "lemon", "cherry", "seven", "bar", "bell", "seven", "clover", "dat"],
  ["seven", "bell", "dat", "cherry", "seven", "lemon", "bar", "dat", "clover", "seven"],
] as const;

export const SLOT_PAYTABLE = (Object.keys(THREE_KIND_MULTIPLIER) as SlotSymbol[])
  .map((symbol) => ({
    symbol,
    label: SYMBOL_LABEL[symbol],
    multiplier: THREE_KIND_MULTIPLIER[symbol],
  }))
  .sort((a, b) => b.multiplier - a.multiplier);

export interface SpinRng {
  nextInt(maxExclusive: number): number;
}

export interface SlotWin {
  lineIndex: number;
  symbol: SlotSymbol;
  multiplier: number;
  payoutMojos: bigint;
  cells: Array<{ row: number; col: number }>;
}

export interface SlotSpin {
  grid: SlotSymbol[][];
  wins: SlotWin[];
  totalBetMojos: bigint;
  payoutMojos: bigint;
  bigWin: boolean;
}

export function cryptoSpinRng(): SpinRng {
  return {
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 1) {
        return 0;
      }
      const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
      let value = 0;
      do {
        value = randomBytes(4).readUInt32BE(0);
      } while (value >= limit);
      return value % maxExclusive;
    },
  };
}

export function isAllowedBetPerLine(betPerLineMojos: bigint): boolean {
  return SLOTS_BET_OPTIONS_MOJOS.some((option) => option === betPerLineMojos);
}

export function buildGrid(rng: SpinRng): SlotSymbol[][] {
  const stops = REEL_STRIPS.map((strip) => rng.nextInt(strip.length));
  return [0, 1, 2].map((row) =>
    stops.map((stop, col) => {
      const strip = REEL_STRIPS[col]!;
      return strip[(stop + row) % strip.length]!;
    }),
  );
}

export function scoreGrid(grid: readonly (readonly SlotSymbol[])[], betPerLineMojos: bigint): SlotSpin {
  if (betPerLineMojos <= 0n) {
    throw new Error("Bet must be positive");
  }
  if (grid.length !== 3 || grid.some((row) => row.length !== 3)) {
    throw new Error("Slot grid must be 3×3");
  }

  const wins: SlotWin[] = [];
  PAYLINES.forEach((line, lineIndex) => {
    const symbols = [0, 1, 2].map((col) => grid[line[col]!]![col]!);
    const [a, b, c] = symbols;
    if (a !== undefined && a === b && b === c) {
      const multiplier = THREE_KIND_MULTIPLIER[a];
      wins.push({
        lineIndex,
        symbol: a,
        multiplier,
        payoutMojos: betPerLineMojos * BigInt(multiplier),
        cells: [0, 1, 2].map((col) => ({ row: line[col]!, col })),
      });
    }
  });

  const payoutMojos = wins.reduce((sum, win) => sum + win.payoutMojos, 0n);
  const totalBetMojos = betPerLineMojos * BigInt(SLOTS_LINE_COUNT);
  return {
    grid: grid.map((row) => [...row]),
    wins,
    totalBetMojos,
    payoutMojos,
    bigWin: payoutMojos >= totalBetMojos * BigInt(BIG_WIN_MULTIPLIER),
  };
}

export function spinSlots(betPerLineMojos: bigint, rng: SpinRng = cryptoSpinRng()): SlotSpin {
  return scoreGrid(buildGrid(rng), betPerLineMojos);
}
