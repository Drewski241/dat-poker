import { PAYLINES } from "./paylines.js";
import type { Grid, LineWin, SlotSpinCore } from "./types.js";

export type CardRank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type CardSuit = "c" | "d" | "h" | "s";

export type CardCode = `${CardSuit}${CardRank}`;

const RANKS: CardRank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: CardSuit[] = ["c", "d", "h", "s"];

const RANK_VALUE: Record<CardRank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export const CARD_EMOJI: Record<CardSuit, string> = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

export function cardLabel(code: CardCode): string {
  const suit = code[0] as CardSuit;
  const rank = code.slice(1) as CardRank;
  return `${CARD_EMOJI[suit]}${rank === "T" ? "10" : rank}`;
}

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

export function spinPokerGrid(): Grid {
  const grid: Grid = [[], [], [], [], []];
  for (let reel = 0; reel < 5; reel++) {
    for (let row = 0; row < 3; row++) {
      const suit = SUITS[randomInt(SUITS.length)]!;
      const rank = RANKS[randomInt(RANKS.length)]!;
      grid[reel]!.push(`${suit}${rank}`);
    }
  }
  return grid;
}

type HandCategory =
  | "high"
  | "pair"
  | "two_pair"
  | "trips"
  | "straight"
  | "flush"
  | "full_house"
  | "quads"
  | "straight_flush"
  | "royal";

export const POKER_HAND_PAYTABLE: {
  id: HandCategory;
  label: string;
  multiplier: number;
}[] = [
  { id: "pair", label: "Pair", multiplier: 1 },
  { id: "two_pair", label: "Two pair", multiplier: 2 },
  { id: "trips", label: "Three of a kind", multiplier: 4 },
  { id: "straight", label: "Straight", multiplier: 8 },
  { id: "flush", label: "Flush", multiplier: 12 },
  { id: "full_house", label: "Full house", multiplier: 20 },
  { id: "quads", label: "Four of a kind", multiplier: 40 },
  { id: "straight_flush", label: "Straight flush", multiplier: 150 },
  { id: "royal", label: "Royal flush", multiplier: 400 },
];

const HAND_PAYOUT: Partial<Record<HandCategory, number>> = Object.fromEntries(
  POKER_HAND_PAYTABLE.map((r) => [r.id, r.multiplier]),
) as Partial<Record<HandCategory, number>>;

function parseCard(code: string): { rank: CardRank; suit: CardSuit; value: number } {
  const suit = code[0] as CardSuit;
  const rank = code.slice(1) as CardRank;
  return { rank, suit, value: RANK_VALUE[rank] };
}

function evalFiveHand(codes: string[]): { category: HandCategory; label: string } {
  const cards = codes.map(parseCard);
  const values = cards.map((c) => c.value).sort((a, b) => a - b);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)].sort((a, b) => a - b);
  let isStraight = false;
  if (unique.length === 5) {
    isStraight = unique[4]! - unique[0]! === 4;
    if (!isStraight && unique.join(",") === "2,3,4,5,14") isStraight = true;
  }
  const isRoyal =
    isStraight &&
    isFlush &&
    (values.includes(14) && values.includes(13) && values.includes(12) && values.includes(11) && values.includes(10));

  if (isRoyal) return { category: "royal", label: "Royal flush" };
  if (isStraight && isFlush) return { category: "straight_flush", label: "Straight flush" };
  if (groups[0]![1] === 4) return { category: "quads", label: "Four of a kind" };
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return { category: "full_house", label: "Full house" };
  if (isFlush) return { category: "flush", label: "Flush" };
  if (isStraight) return { category: "straight", label: "Straight" };
  if (groups[0]![1] === 3) return { category: "trips", label: "Three of a kind" };
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return { category: "two_pair", label: "Two pair" };
  if (groups[0]![1] === 2) return { category: "pair", label: "Pair" };
  return { category: "high", label: "High card" };
}

export function evaluatePokerSpin(grid: Grid, lineBet: number): SlotSpinCore {
  const lineWins: LineWin[] = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const pattern = PAYLINES[li]!;
    const cards = pattern.map((row, reel) => grid[reel]![row]! as string);
    const hand = evalFiveHand(cards);
    const mult = HAND_PAYOUT[hand.category] ?? 0;
    if (mult <= 0) continue;
    lineWins.push({
      lineIndex: li,
      symbol: hand.category,
      count: 5,
      multiplier: mult,
      payout: mult * lineBet,
      cells: pattern.map((row, reel) => ({ reel, row })),
    });
  }

  const totalMultiplier = lineWins.reduce((s, w) => s + w.multiplier, 0);
  const totalPayout = lineWins.reduce((s, w) => s + w.payout, 0);
  return {
    grid,
    lineWins,
    waysWins: [],
    scatterCount: 0,
    scatterMultiplier: 0,
    totalMultiplier,
    totalPayout,
  };
}

export function isPokerProgressiveGrid(grid: Grid): boolean {
  const center = PAYLINES[0]!;
  const cards = center.map((row, reel) => grid[reel]![row]! as string);
  return evalFiveHand(cards).category === "royal";
}

export function redrawPokerGrid(grid: Grid, heldReels: number[]): Grid {
  const next = grid.map((col) => [...col]) as Grid;
  for (let reel = 0; reel < 5; reel++) {
    if (heldReels.includes(reel)) continue;
    for (let row = 0; row < 3; row++) {
      const suit = SUITS[randomInt(SUITS.length)]!;
      const rank = RANKS[randomInt(RANKS.length)]!;
      next[reel]![row] = `${suit}${rank}`;
    }
  }
  return next;
}

/** Offer hold/draw after ~25% of spins or any paying hand. */
export function shouldOfferHoldDraw(lineWins: LineWin[]): boolean {
  if (lineWins.length > 0) return true;
  return randomInt(100) < 25;
}
