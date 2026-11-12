import type { Card, Rank } from "./card.js";
import { rankValue } from "./card.js";

export type HandCategory =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_kind"
  | "straight_flush";

export interface EvaluatedHand {
  category: HandCategory;
  /** Higher is better; comparable across same category. */
  score: number;
  kickers: number[];
}

const CATEGORY_SCORE: Record<HandCategory, number> = {
  high_card: 1,
  pair: 2,
  two_pair: 3,
  three_kind: 4,
  straight: 5,
  flush: 6,
  full_house: 7,
  four_kind: 8,
  straight_flush: 9,
};

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function rankCounts(cards: Card[]): Map<Rank, number> {
  const m = new Map<Rank, number>();
  for (const c of cards) {
    m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  }
  return m;
}

function isFlush(cards: Card[]): boolean {
  const suit = cards[0].suit;
  return cards.every((c) => c.suit === suit);
}

function straightHigh(cards: Card[]): number | null {
  const values = [...new Set(cards.map((c) => rankValue(c.rank)))].sort((a, b) => b - a);
  if (values.length !== 5) return null;

  const isWheel = values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2;
  if (isWheel) return 5;

  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] - values[i + 1] !== 1) return null;
  }
  return values[0];
}

function evaluateFive(cards: Card[]): EvaluatedHand {
  const counts = rankCounts(cards);
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || rankValue(b[0]) - rankValue(a[0]));
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const flush = isFlush(cards);
  const straight = straightHigh(cards);

  if (flush && straight !== null) {
    return {
      category: "straight_flush",
      score: CATEGORY_SCORE.straight_flush * 1_000_000 + straight,
      kickers: [straight],
    };
  }

  const maxCount = byCount[0][1];
  if (maxCount === 4) {
    const quad = rankValue(byCount[0][0]);
    const kicker = rankValue(byCount[1][0]);
    return {
      category: "four_kind",
      score: CATEGORY_SCORE.four_kind * 1_000_000 + quad * 100 + kicker,
      kickers: [quad, kicker],
    };
  }

  if (maxCount === 3 && byCount[1][1] === 2) {
    const trip = rankValue(byCount[0][0]);
    const pair = rankValue(byCount[1][0]);
    return {
      category: "full_house",
      score: CATEGORY_SCORE.full_house * 1_000_000 + trip * 100 + pair,
      kickers: [trip, pair],
    };
  }

  if (flush) {
    return {
      category: "flush",
      score: CATEGORY_SCORE.flush * 1_000_000 + values[0] * 10_000 + values[1] * 1_000 + values[2] * 100 + values[3] * 10 + values[4],
      kickers: values,
    };
  }

  if (straight !== null) {
    return {
      category: "straight",
      score: CATEGORY_SCORE.straight * 1_000_000 + straight,
      kickers: [straight],
    };
  }

  if (maxCount === 3) {
    const trip = rankValue(byCount[0][0]);
    const kickers = byCount.slice(1).map(([r]) => rankValue(r)).sort((a, b) => b - a);
    return {
      category: "three_kind",
      score: CATEGORY_SCORE.three_kind * 1_000_000 + trip * 10_000 + kickers[0] * 100 + kickers[1],
      kickers: [trip, ...kickers],
    };
  }

  if (maxCount === 2 && byCount[1][1] === 2) {
    const highPair = rankValue(byCount[0][0]);
    const lowPair = rankValue(byCount[1][0]);
    const kicker = rankValue(byCount[2][0]);
    return {
      category: "two_pair",
      score: CATEGORY_SCORE.two_pair * 1_000_000 + highPair * 10_000 + lowPair * 100 + kicker,
      kickers: [highPair, lowPair, kicker],
    };
  }

  if (maxCount === 2) {
    const pair = rankValue(byCount[0][0]);
    const kickers = byCount.slice(1).map(([r]) => rankValue(r)).sort((a, b) => b - a);
    return {
      category: "pair",
      score: CATEGORY_SCORE.pair * 1_000_000 + pair * 10_000 + kickers[0] * 100 + kickers[1] * 10 + kickers[2],
      kickers: [pair, ...kickers],
    };
  }

  return {
    category: "high_card",
    score: CATEGORY_SCORE.high_card * 1_000_000 + values[0] * 10_000 + values[1] * 1_000 + values[2] * 100 + values[3] * 10 + values[4],
    kickers: values,
  };
}

/**
 * Pot-limit Omaha showdown. Exactly two hole cards and exactly three board cards.
 * A five-card board on its own does not play.
 */
export function evaluateOmahaHand(holeCards: Card[], board: Card[]): EvaluatedHand {
  if (holeCards.length < 4) {
    throw new Error(`Omaha needs 4 hole cards, got ${holeCards.length}`);
  }
  if (board.length < 3) {
    throw new Error(`Omaha needs at least 3 board cards, got ${board.length}`);
  }

  let best: EvaluatedHand | null = null;
  for (const hole of combinations(holeCards, 2)) {
    for (const fromBoard of combinations(board, 3)) {
      const ev = evaluateFive([...hole, ...fromBoard]);
      if (!best || ev.score > best.score) best = ev;
    }
  }
  return best!;
}

/** Best 5-card hand from 5–7 cards (Hold'em showdown). */
export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return evaluateFive(cards);
  }

  let best: EvaluatedHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const ev = evaluateFive(combo);
    if (!best || ev.score > best.score) {
      best = ev;
    }
  }
  return best!;
}

export function compareHands(a: EvaluatedHand, b: EvaluatedHand): number {
  return a.score - b.score;
}

const RANK_WORD: Record<number, { singular: string; plural: string }> = {
  14: { singular: "ace", plural: "aces" },
  13: { singular: "king", plural: "kings" },
  12: { singular: "queen", plural: "queens" },
  11: { singular: "jack", plural: "jacks" },
  10: { singular: "ten", plural: "tens" },
  9: { singular: "nine", plural: "nines" },
  8: { singular: "eight", plural: "eights" },
  7: { singular: "seven", plural: "sevens" },
  6: { singular: "six", plural: "sixes" },
  5: { singular: "five", plural: "fives" },
  4: { singular: "four", plural: "fours" },
  3: { singular: "three", plural: "threes" },
  2: { singular: "two", plural: "twos" },
};

function rankSingular(value: number): string {
  return RANK_WORD[value]?.singular ?? String(value);
}

function rankPlural(value: number): string {
  return RANK_WORD[value]?.plural ?? String(value);
}

/** Short showdown name, such as "two pair, kings and fives". */
export function describeEvaluatedHand(hand: EvaluatedHand): string {
  const k = hand.kickers;
  switch (hand.category) {
    case "straight_flush":
      return k[0] === 14 ? "a royal flush" : `a straight flush, ${rankSingular(k[0])} high`;
    case "four_kind":
      return `four of a kind, ${rankPlural(k[0])}`;
    case "full_house":
      return `a full house, ${rankPlural(k[0])} full of ${rankPlural(k[1])}`;
    case "flush":
      return `a flush, ${rankSingular(k[0])} high`;
    case "straight":
      return `a straight, ${rankSingular(k[0])} high`;
    case "three_kind":
      return `three of a kind, ${rankPlural(k[0])}`;
    case "two_pair":
      return `two pair, ${rankPlural(k[0])} and ${rankPlural(k[1])}`;
    case "pair":
      return `a pair of ${rankPlural(k[0])}`;
    default:
      return `${rankSingular(k[0])} high`;
  }
}
