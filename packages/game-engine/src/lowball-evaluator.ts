import type { Card, Rank } from "./card.js";
import { rankValue } from "./card.js";

/** Ace-to-5 low: Ace = 1. */
export function aceToFiveRankValue(rank: Rank): number {
  if (rank === "A") return 1;
  return rankValue(rank);
}

/** Deuce-to-seven low: Ace is high (14); straights/flushes count against you. */
export function deuceToSevenRankValue(rank: Rank): number {
  return rankValue(rank);
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function isFlush(cards: Card[]): boolean {
  const suit = cards[0]!.suit;
  return cards.every((c) => c.suit === suit);
}

function isStraightAceToFive(values: number[]): boolean {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length !== 5) return false;
  for (let i = 0; i < 4; i++) {
    if (sorted[i]! + 1 !== sorted[i + 1]) return false;
  }
  return true;
}

function isStraightDeuceToSeven(values: number[]): boolean {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  if (uniq.length !== 5) return false;
  // Wheel A-2-3-4-5 counts as a straight in 2-7 (Ace high makes it A-5).
  const isWheel =
    uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14;
  if (isWheel) return true;
  for (let i = 0; i < 4; i++) {
    if (uniq[i]! + 1 !== uniq[i + 1]) return false;
  }
  return true;
}

/**
 * Ace-to-5 lowball score for exactly 5 cards.
 * Lower score is better. Pairs / made hands get a large penalty.
 * Kickers encoded high→low so 7-5-4-3-2 beats 7-6-4-3-2.
 */
export function evaluateAceToFiveLowFive(cards: Card[]): { score: number; values: number[] } {
  if (cards.length !== 5) throw new Error("Ace-to-5 low needs 5 cards");
  const values = cards.map((c) => aceToFiveRankValue(c.rank)).sort((a, b) => b - a);
  const uniq = new Set(values);
  const paired = uniq.size < 5;
  // Straights and flushes do NOT count against the player in Ace-to-5.
  let score = 0;
  if (paired) {
    score = 1_000_000_000;
    // Prefer fewer pairs / lower pair ranks when forced.
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    score += byCount[0]![1] * 10_000_000 + byCount[0]![0] * 100_000;
  }
  // Encode descending values so lower high-card is better.
  score +=
    values[0]! * 1_000_000 +
    values[1]! * 10_000 +
    values[2]! * 100 +
    values[3]! * 10 +
    values[4]!;
  return { score, values };
}

/** Best Ace-to-5 low from 5–7 cards (Razz / stud low). Lower score wins. */
export function evaluateAceToFiveLow(cards: Card[]): { score: number; values: number[] } {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);
  if (cards.length === 5) return evaluateAceToFiveLowFive(cards);
  let best: { score: number; values: number[] } | null = null;
  for (const combo of combinations(cards, 5)) {
    const ev = evaluateAceToFiveLowFive(combo);
    if (!best || ev.score < best.score) best = ev;
  }
  return best!;
}

/**
 * Deuce-to-seven lowball for exactly 5 cards.
 * Straights and flushes count against you. Ace is high. Lower score wins.
 */
export function evaluateDeuceToSevenLowFive(cards: Card[]): { score: number; values: number[] } {
  if (cards.length !== 5) throw new Error("2-7 low needs 5 cards");
  const values = cards.map((c) => deuceToSevenRankValue(c.rank)).sort((a, b) => b - a);
  const uniq = new Set(values);
  const paired = uniq.size < 5;
  const flush = isFlush(cards);
  const straight = isStraightDeuceToSeven(values);
  let score = 0;
  if (paired || flush || straight) {
    score = 1_000_000_000;
    if (flush && straight) score += 400_000_000;
    else if (flush) score += 300_000_000;
    else if (straight) score += 200_000_000;
    else score += 100_000_000;
  }
  score +=
    values[0]! * 1_000_000 +
    values[1]! * 10_000 +
    values[2]! * 100 +
    values[3]! * 10 +
    values[4]!;
  return { score, values };
}

export function evaluateDeuceToSevenLow(cards: Card[]): { score: number; values: number[] } {
  if (cards.length !== 5) {
    throw new Error(`2-7 triple draw uses exactly 5 cards, got ${cards.length}`);
  }
  return evaluateDeuceToSevenLowFive(cards);
}

/**
 * Omaha / Hold'em 8-or-better low using Ace-to-5.
 * Returns null if no qualifying low (five unpaired ranks ≤ 8).
 * Omaha: exactly 2 hole + 3 board.
 */
export function evaluateOmahaEightOrBetterLow(
  hole: Card[],
  board: Card[],
): { score: number; values: number[] } | null {
  if (hole.length < 2 || board.length < 3) return null;
  let best: { score: number; values: number[] } | null = null;
  for (const holePair of combinations(hole, 2)) {
    for (const boardTrip of combinations(board, 3)) {
      const five = [...holePair, ...boardTrip];
      const values = five.map((c) => aceToFiveRankValue(c.rank));
      if (new Set(values).size !== 5) continue;
      if (values.some((v) => v > 8)) continue;
      const ev = evaluateAceToFiveLowFive(five);
      if (!best || ev.score < best.score) best = ev;
    }
  }
  return best;
}

export function compareLowScores(a: number, b: number): number {
  // Lower is better → invert for "positive means a wins".
  return b - a;
}

/** Badugi: best unpaired, unsame-suited subset; Ace low. Lower score wins. */
export interface BadugiHand {
  /** 1–4 cards used in the Badugi. */
  cards: Card[];
  /** Lower is better. Encodes length (more cards better) then ranks high→low. */
  score: number;
}

function badugiScore(cards: Card[]): number {
  // Prefer more cards: 4-card badugi always beats 3-card.
  const lengthPenalty = (4 - cards.length) * 100_000_000;
  const values = cards.map((c) => aceToFiveRankValue(c.rank)).sort((a, b) => b - a);
  let encoded = 0;
  for (let i = 0; i < 4; i++) {
    encoded = encoded * 20 + (values[i] ?? 0);
  }
  return lengthPenalty + encoded;
}

/**
 * Evaluate a Badugi hand from up to 4 cards.
 * Valid subset: all different ranks and all different suits.
 */
export function evaluateBadugi(cards: Card[]): BadugiHand {
  if (cards.length === 0) throw new Error("Badugi needs at least 1 card");
  if (cards.length > 4) throw new Error("Badugi uses at most 4 cards");

  let best: BadugiHand | null = null;
  const n = cards.length;
  for (let k = n; k >= 1; k--) {
    for (const combo of combinations(cards, k)) {
      const ranks = new Set(combo.map((c) => c.rank));
      const suits = new Set(combo.map((c) => c.suit));
      if (ranks.size !== combo.length || suits.size !== combo.length) continue;
      const hand: BadugiHand = { cards: combo, score: badugiScore(combo) };
      if (!best || hand.score < best.score) best = hand;
    }
    // Once we found any valid k-card hand, longer is always better — but we
    // already iterate k from high to low and keep the best score, so continue.
  }
  return best!;
}

export function compareBadugi(a: BadugiHand, b: BadugiHand): number {
  return b.score - a.score;
}

// Keep unused helper referenced for clarity / future wheel checks.
void isStraightAceToFive;
