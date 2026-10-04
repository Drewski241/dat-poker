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

const RANK_WORD: Record<number, string> = {
  14: "Ace",
  13: "King",
  12: "Queen",
  11: "Jack",
  10: "10",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};

function rankWord(value: number): string {
  return RANK_WORD[value] ?? String(value);
}

function rankWordPlural(value: number): string {
  if (value === 14) return "Aces";
  if (value === 13) return "Kings";
  if (value === 12) return "Queens";
  if (value === 11) return "Jacks";
  return `${rankWord(value)}s`;
}

function describeEvaluated(ev: EvaluatedHand): string {
  switch (ev.category) {
    case "high_card":
      return `${rankWord(ev.kickers[0])} high`;
    case "pair":
      return `pair of ${rankWordPlural(ev.kickers[0])}`;
    case "two_pair":
      return `two pair, ${rankWordPlural(ev.kickers[0])} and ${rankWordPlural(ev.kickers[1])}`;
    case "three_kind":
      return `three of a kind, ${rankWordPlural(ev.kickers[0])}`;
    case "straight":
      return `${rankWord(ev.kickers[0])}-high straight`;
    case "flush":
      return `${rankWord(ev.kickers[0])}-high flush`;
    case "full_house":
      return `full house, ${rankWordPlural(ev.kickers[0])} full of ${rankWordPlural(ev.kickers[1])}`;
    case "four_kind":
      return `four of a kind, ${rankWordPlural(ev.kickers[0])}`;
    case "straight_flush":
      return ev.kickers[0] === 14 ? "royal flush" : `${rankWord(ev.kickers[0])}-high straight flush`;
  }
}

function describePartial(cards: Card[]): string {
  const counts = rankCounts(cards);
  const byCount = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || rankValue(b[0]) - rankValue(a[0]),
  );
  const maxCount = byCount[0][1];

  if (maxCount === 4) {
    return `four of a kind, ${rankWordPlural(rankValue(byCount[0][0]))}`;
  }
  if (maxCount === 3) {
    return `three of a kind, ${rankWordPlural(rankValue(byCount[0][0]))}`;
  }
  if (maxCount === 2 && byCount[1]?.[1] === 2) {
    return `two pair, ${rankWordPlural(rankValue(byCount[0][0]))} and ${rankWordPlural(rankValue(byCount[1][0]))}`;
  }
  if (maxCount === 2) {
    return `pair of ${rankWordPlural(rankValue(byCount[0][0]))}`;
  }

  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
  if (cards.length === 2) {
    const combo = `${rankWord(rankValue(sorted[0].rank))}-${rankWord(rankValue(sorted[1].rank))}`;
    return sorted[0].suit === sorted[1].suit ? `${combo} suited` : combo;
  }
  return `${rankWord(rankValue(sorted[0].rank))} high`;
}

/**
 * Player-facing made-hand label from the cards currently showing.
 * 2–4 cards: pair / trips / two pair / unpaired combo (preflop suited).
 * 5–7 cards: best five-card poker hand.
 */
export function describeBestMadeHand(cards: Card[]): string | null {
  if (cards.length === 0) return null;
  if (cards.length >= 5) {
    return describeEvaluated(evaluateBestHand(cards));
  }
  return describePartial(cards);
}
