import type { Street } from "@dat-poker/shared";
import type { Card } from "./card.js";
import { rankValue } from "./card.js";
import { evaluateBestHand, type HandCategory } from "./hand-evaluator.js";
import type { PlayerAction } from "./nlhe-table.js";

export const HOUSE_PLAYER_ID = "dat-poker:house";

export interface HouseDecisionInput {
  street: Street;
  board: Card[];
  holeCards: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  betThisStreetMojos: bigint;
  stackMojos: bigint;
  bigBlindMojos: bigint;
}

export interface HouseDecision {
  action: PlayerAction;
  amountMojos: bigint;
}

const CATEGORY_STRENGTH: Record<HandCategory, number> = {
  high_card: 0.22,
  pair: 0.5,
  two_pair: 0.68,
  three_kind: 0.78,
  straight: 0.86,
  flush: 0.9,
  full_house: 0.95,
  four_kind: 0.98,
  straight_flush: 1,
};

/**
 * Deterministic house policy for heads-up play.
 * Folds weak hands facing a bet, checks medium hands, and bets or raises strong ones.
 */
export function chooseHouseAction(input: HouseDecisionInput): HouseDecision {
  const toCall = input.currentBetMojos - input.betThisStreetMojos;
  const maxTo = input.betThisStreetMojos + input.stackMojos;
  const strength = handStrength(input);

  if (toCall <= 0n) {
    if (strength >= 0.8) return openBet(input, maxTo, 75n);
    if (strength >= 0.62) return openBet(input, maxTo, 50n);
    return { action: "check", amountMojos: 0n };
  }

  if (strength >= 0.84 && maxTo > input.currentBetMojos) {
    const extra = input.potMojos > input.bigBlindMojos ? input.potMojos / 2n : input.bigBlindMojos;
    let raiseTo = input.currentBetMojos + extra;
    if (raiseTo <= input.currentBetMojos) {
      raiseTo = input.currentBetMojos + input.bigBlindMojos;
    }
    if (raiseTo > maxTo) raiseTo = maxTo;
    if (raiseTo > input.currentBetMojos) {
      return { action: "raise", amountMojos: raiseTo };
    }
  }

  if (strength >= 0.5 || (toCall <= input.bigBlindMojos && strength >= 0.32)) {
    return { action: "call", amountMojos: 0n };
  }

  return { action: "fold", amountMojos: 0n };
}

function openBet(input: HouseDecisionInput, maxTo: bigint, percent: bigint): HouseDecision {
  const potPart = (input.potMojos * percent) / 100n;
  const add = potPart > input.bigBlindMojos ? potPart : input.bigBlindMojos;
  let to = input.betThisStreetMojos + add;
  if (to > maxTo) to = maxTo;
  if (to <= input.currentBetMojos || input.stackMojos <= 0n) {
    return { action: "check", amountMojos: 0n };
  }
  return { action: "bet", amountMojos: to };
}

function handStrength(input: HouseDecisionInput): number {
  if (input.board.length >= 3 && input.holeCards.length >= 2) {
    return CATEGORY_STRENGTH[evaluateBestHand([...input.holeCards, ...input.board]).category];
  }
  return preflopStrength(input.holeCards);
}

function preflopStrength(cards: Card[]): number {
  if (cards.length < 2) return 0.2;
  const highRank = rankValue(cards[0].rank);
  const lowRank = rankValue(cards[1].rank);
  const high = Math.max(highRank, lowRank);
  const low = Math.min(highRank, lowRank);
  if (highRank === lowRank) return Math.min(0.99, 0.55 + high / 40);
  const gap = high - low;
  let strength = 0.22 + high / 40 + low / 80 - Math.min(gap, 6) * 0.03;
  if (cards[0].suit === cards[1].suit) strength += 0.08;
  if (gap === 1) strength += 0.04;
  return Math.max(0.05, Math.min(0.95, strength));
}
