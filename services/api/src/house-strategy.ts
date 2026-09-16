import {
  evaluateBestHand,
  rankValue,
  type Card,
  type PlayerAction,
} from "@dat-poker/game-engine";
import { computeNlheBetRange, snapRaiseTo } from "@dat-poker/shared";
import type { Street } from "@dat-poker/shared";

export interface HouseView {
  street: Street;
  holeCards: Card[];
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  betThisStreetMojos: bigint;
  stackMojos: bigint;
  bigBlindMojos: bigint;
  opponentsAllIn: boolean;
}

export interface HouseChoice {
  action: PlayerAction;
  amountMojos: bigint;
}

const VALUE_BET_FREQ = 0.9;
const STRONG_BET_FREQ = 0.68;
const STAB_BET_FREQ = 0.4;
const BLUFF_BET_FREQ = 0.18;
const VALUE_RAISE_FREQ = 0.48;
const STRONG_RAISE_FREQ = 0.24;
const BLUFF_RAISE_FREQ = 0.08;

export function chooseHouseAction(
  view: HouseView,
  random: () => number = Math.random,
): HouseChoice {
  const toCall = view.currentBetMojos - view.betThisStreetMojos;
  const passive: HouseChoice =
    toCall > 0n ? { action: "call", amountMojos: 0n } : { action: "check", amountMojos: 0n };

  if (view.holeCards.length !== 2) {
    return passive;
  }

  if (view.opponentsAllIn && toCall <= 0n) {
    return { action: "check", amountMojos: 0n };
  }

  const strength = estimateHouseStrength(view);
  const roll = () => clamp01(random());

  if (toCall > 0n) {
    return facingBet(view, toCall, strength, roll) ?? { action: "fold", amountMojos: 0n };
  }
  return checkedTo(view, strength, roll) ?? passive;
}

export function estimateHouseStrength(view: HouseView): number {
  if (view.holeCards.length !== 2) {
    return 0;
  }
  if (view.street === "preflop" || view.board.length < 3) {
    return preflopStrength(view.holeCards[0], view.holeCards[1]);
  }

  const hero = evaluateBestHand([...view.holeCards, ...view.board]);
  let score = categoryScore(hero.category);

  if (hero.category === "pair") {
    score = pairScore(view.holeCards, view.board);
  } else if (hero.category === "high_card") {
    score = 0.16 + Math.max(...view.holeCards.map((c) => rankValue(c.rank))) / 200;
  }

  if (view.board.length === 5) {
    const boardOnly = evaluateBestHand(view.board);
    if (hero.score <= boardOnly.score) {
      score = Math.min(score, 0.28);
    }
  } else if (!holePlays(view.holeCards, view.board) && hero.category === "pair") {
    score = Math.min(score, 0.24);
  }

  if (view.street !== "river") {
    if (hasFlushDraw(view.holeCards, view.board)) {
      score = Math.max(score, 0.46);
      score = Math.min(0.74, score + 0.12);
    }
    const draw = straightDraw(view.holeCards, view.board);
    if (draw === "oesd") {
      score = Math.max(score, 0.42);
      score = Math.min(0.72, score + 0.1);
    } else if (draw === "gutshot") {
      score = Math.min(0.62, score + 0.06);
    }
  }

  return clamp01(score);
}

function facingBet(
  view: HouseView,
  toCall: bigint,
  strength: number,
  roll: () => number,
): HouseChoice | null {
  const potWithCall = view.potMojos + toCall;
  const price = ratio(toCall, potWithCall);
  const cheap = price <= 0.22 || toCall <= view.bigBlindMojos;
  const huge = price >= 0.55;

  if (view.opponentsAllIn) {
    if (strength >= 0.32 || cheap) {
      return { action: "call", amountMojos: 0n };
    }
    return { action: "fold", amountMojos: 0n };
  }

  if (view.street === "preflop") {
    const unraised = view.currentBetMojos <= view.bigBlindMojos;
    if (strength >= 0.55 && roll() < 0.82) {
      return preflopOpen(view) ?? { action: "call", amountMojos: 0n };
    }
    if (unraised && strength >= 0.22) {
      return { action: "call", amountMojos: 0n };
    }
    if (unraised && roll() < 0.12) {
      return { action: "call", amountMojos: 0n };
    }
    if (strength >= 0.4 && !huge && roll() < 0.3) {
      return preflopOpen(view) ?? { action: "call", amountMojos: 0n };
    }
    if (cheap && strength >= 0.18) {
      return { action: "call", amountMojos: 0n };
    }
    return { action: "fold", amountMojos: 0n };
  }

  if (strength >= 0.85) {
    if (roll() < VALUE_RAISE_FREQ) {
      return raiseChoice(view, 2, 3) ?? { action: "call", amountMojos: 0n };
    }
    return { action: "call", amountMojos: 0n };
  }
  if (strength >= 0.68) {
    if (!huge && roll() < STRONG_RAISE_FREQ) {
      return raiseChoice(view, 1, 2) ?? { action: "call", amountMojos: 0n };
    }
    return { action: "call", amountMojos: 0n };
  }
  if (strength >= 0.48) {
    if (huge && roll() > 0.35) {
      return { action: "fold", amountMojos: 0n };
    }
    return { action: "call", amountMojos: 0n };
  }
  if (strength >= 0.32) {
    if (cheap || (!huge && roll() < 0.45)) {
      return { action: "call", amountMojos: 0n };
    }
    return { action: "fold", amountMojos: 0n };
  }

  if (!huge && roll() < BLUFF_RAISE_FREQ) {
    return raiseChoice(view, 1, 2);
  }
  if (cheap && roll() < 0.25) {
    return { action: "call", amountMojos: 0n };
  }
  return { action: "fold", amountMojos: 0n };
}

function checkedTo(view: HouseView, strength: number, roll: () => number): HouseChoice | null {
  if (view.street === "preflop") {
    if (strength >= 0.55 && roll() < 0.82) {
      return preflopOpen(view);
    }
    if (strength >= 0.4 && roll() < 0.35) {
      return preflopOpen(view);
    }
    return { action: "check", amountMojos: 0n };
  }

  if (strength >= 0.85) {
    if (roll() < VALUE_BET_FREQ) {
      return raiseChoice(view, 2, 3);
    }
    return { action: "check", amountMojos: 0n };
  }
  if (strength >= 0.68) {
    if (roll() < STRONG_BET_FREQ) {
      return raiseChoice(view, 2, 3);
    }
    return { action: "check", amountMojos: 0n };
  }
  if (strength >= 0.48) {
    if (roll() < STAB_BET_FREQ) {
      return raiseChoice(view, 1, 2);
    }
    return { action: "check", amountMojos: 0n };
  }
  if (roll() < BLUFF_BET_FREQ) {
    return raiseChoice(view, 1, 2);
  }
  return { action: "check", amountMojos: 0n };
}

function preflopOpen(view: HouseView): HouseChoice | null {
  const threeBb = view.bigBlindMojos * 3n;
  const iso = view.currentBetMojos > 0n ? view.currentBetMojos * 3n : threeBb;
  const range = betRange(view);
  if (!range.canBetOrRaise) {
    return { action: "check", amountMojos: 0n };
  }
  const amount = snapRaiseTo(iso, range.minRaiseTo, range.maxRaiseTo, view.bigBlindMojos);
  return {
    action: view.currentBetMojos === 0n ? "bet" : "raise",
    amountMojos: amount,
  };
}

function raiseChoice(view: HouseView, potNum: number, potDen: number): HouseChoice | null {
  const range = betRange(view);
  if (!range.canBetOrRaise) {
    return null;
  }
  const extra = (view.potMojos * BigInt(potNum)) / BigInt(potDen);
  const opening = view.currentBetMojos === 0n;
  const desired = opening
    ? extra > view.bigBlindMojos
      ? extra
      : view.bigBlindMojos
    : view.currentBetMojos + extra;
  const amount = snapRaiseTo(desired, range.minRaiseTo, range.maxRaiseTo, view.bigBlindMojos);
  if (amount <= view.currentBetMojos) {
    return null;
  }
  return {
    action: opening ? "bet" : "raise",
    amountMojos: amount,
  };
}

function betRange(view: HouseView) {
  return computeNlheBetRange({
    bigBlindMojos: view.bigBlindMojos,
    currentBetMojos: view.currentBetMojos,
    myBetThisStreetMojos: view.betThisStreetMojos,
    myStackMojos: view.stackMojos,
  });
}

function preflopStrength(a: Card, b: Card): number {
  const va = rankValue(a.rank);
  const vb = rankValue(b.rank);
  const high = Math.max(va, vb);
  const low = Math.min(va, vb);
  const pair = a.rank === b.rank;
  const suited = a.suit === b.suit;

  const highPts: Record<number, number> = {
    14: 10,
    13: 8,
    12: 7,
    11: 6,
    10: 5,
  };
  let chen = highPts[high] ?? high / 2;

  if (pair) {
    chen = Math.max(5, chen * 2);
    if (high === 5) chen += 1;
    return clamp01(chen / 20);
  }

  if (suited) chen += 2;
  let gap = high - low - 1;
  if (high === 14 && low <= 5) {
    gap = Math.min(gap, suited ? 1 : 2);
  }
  if (gap === 0) chen += 1;
  else if (gap === 1) chen -= 1;
  else if (gap === 2) chen -= 2;
  else if (gap === 3) chen -= 4;
  else chen -= 5;

  return clamp01(chen / 20);
}

function categoryScore(
  category: ReturnType<typeof evaluateBestHand>["category"],
): number {
  switch (category) {
    case "straight_flush":
      return 1;
    case "four_kind":
      return 0.99;
    case "full_house":
      return 0.96;
    case "flush":
      return 0.9;
    case "straight":
      return 0.88;
    case "three_kind":
      return 0.82;
    case "two_pair":
      return 0.72;
    case "pair":
      return 0.45;
    default:
      return 0.18;
  }
}

function pairScore(hole: Card[], board: Card[]): number {
  if (!holePlays(hole, board)) {
    return 0.22;
  }
  const boardHigh = Math.max(...board.map((c) => rankValue(c.rank)));
  const boardRanks = board.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const pocket = hole[0].rank === hole[1].rank;
  const pairRank = pocket
    ? rankValue(hole[0].rank)
    : rankValue(hole.find((h) => board.some((b) => b.rank === h.rank))?.rank ?? hole[0].rank);

  if (pocket && pairRank > boardHigh) {
    return 0.66;
  }
  if (pairRank === boardHigh) {
    const kicker = pocket ? pairRank : rankValue(hole.find((h) => rankValue(h.rank) !== pairRank)?.rank ?? hole[0].rank);
    return 0.52 + (kicker >= 14 ? 0.06 : kicker >= 12 ? 0.03 : 0);
  }
  if (pairRank === boardRanks[1]) {
    return 0.4;
  }
  return 0.32;
}

function holePlays(hole: Card[], board: Card[]): boolean {
  if (hole[0].rank === hole[1].rank) {
    return true;
  }
  return hole.some((h) => board.some((b) => b.rank === h.rank));
}

function hasFlushDraw(hole: Card[], board: Card[]): boolean {
  for (const suit of ["c", "d", "h", "s"] as const) {
    const fromHole = hole.filter((c) => c.suit === suit).length;
    const total = [...hole, ...board].filter((c) => c.suit === suit).length;
    if (fromHole >= 1 && total === 4) {
      return true;
    }
  }
  return false;
}

function straightDraw(hole: Card[], board: Card[]): "oesd" | "gutshot" | null {
  const vals = new Set([...hole, ...board].map((c) => rankValue(c.rank)));
  if (vals.has(14)) vals.add(1);
  let best: "oesd" | "gutshot" | null = null;
  for (let start = 1; start <= 10; start++) {
    const window = [0, 1, 2, 3, 4].map((i) => start + i);
    const have = window.filter((r) => vals.has(r));
    if (have.length !== 4) continue;
    const missing = window.find((r) => !vals.has(r));
    if (missing === start || missing === start + 4) {
      best = "oesd";
    } else if (best !== "oesd") {
      best = "gutshot";
    }
  }
  return best;
}

function ratio(a: bigint, b: bigint): number {
  if (b <= 0n) return 1;
  return Number(a) / Number(b);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
