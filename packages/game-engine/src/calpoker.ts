import type { Card } from "./card.js";
import { rankValue, standardDeck } from "./card.js";
import { describeEvaluatedHand, evaluateBestHand, type EvaluatedHand } from "./hand-evaluator.js";
import { assertSessionWager, lossRoomMojos, sessionLimitReached, sessionResultMojos } from "./session-limit.js";
import { createCommit, generateServerSeed, shuffleDeck } from "./shuffle.js";

export type CalpokerPhase = "betting" | "selecting" | "done";
export type CalpokerWinner = "player" | "house" | "tie";

export interface CalpokerCard extends Card {
  /** True when this card is in the best five-card hand after the swap. */
  played: boolean;
}

export interface CalpokerSnapshot {
  id: string;
  playerId: string;
  displayName: string;
  stackMojos: bigint;
  minAnteMojos: bigint;
  maxAnteMojos: bigint;
  sessionStartMojos: bigint;
  lossLimitMojos: bigint | null;
  phase: CalpokerPhase;
  playerCards: Card[];
  houseCards: Card[];
  shoe: Card[];
  anteMojos: bigint;
  winner: CalpokerWinner | null;
  payoutMojos: bigint | null;
  profitMojos: bigint | null;
  commitHash: string | null;
  serverSeed: string | null;
}

export interface CalpokerView {
  tableId: string;
  displayName: string;
  stackMojos: bigint;
  minAnteMojos: bigint;
  maxAnteMojos: bigint;
  phase: CalpokerPhase;
  playerCards: CalpokerCard[];
  houseCards: CalpokerCard[];
  anteMojos: bigint;
  winner: CalpokerWinner | null;
  playerHand: string | null;
  houseHand: string | null;
  payoutMojos: bigint | null;
  profitMojos: bigint | null;
  sessionStartMojos: bigint;
  sessionResultMojos: bigint;
  lossLimitMojos: bigint | null;
  lossRoomMojos: bigint | null;
  limitReached: boolean;
  commitHash: string | null;
  serverSeed: string | null;
}

function combinations(indexes: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (indexes.length < k) return [];
  const [first, ...rest] = indexes;
  return [
    ...combinations(rest, k - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, k),
  ];
}

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank) || a.suit.localeCompare(b.suit));
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function splitGive(cards: Card[], give: number[]): { kept: Card[]; given: Card[] } {
  const giving = new Set(give);
  const kept: Card[] = [];
  const given: Card[] = [];
  cards.forEach((card, index) => {
    (giving.has(index) ? given : kept).push({ ...card });
  });
  return { kept, given };
}

export function applyCalpokerSwap(
  playerCards: Card[],
  houseCards: Card[],
  playerGive: number[],
  houseGive: number[],
): { playerFinal: Card[]; houseFinal: Card[] } {
  const player = splitGive(playerCards, playerGive);
  const house = splitGive(houseCards, houseGive);
  return {
    playerFinal: [...player.kept, ...house.given],
    houseFinal: [...house.kept, ...player.given],
  };
}

function bestHand(cards: Card[], memo: Map<string, EvaluatedHand>): EvaluatedHand {
  const key = cards.map(cardKey).sort().join("");
  const cached = memo.get(key);
  if (cached) return cached;
  const evaluated = evaluateBestHand(cards);
  memo.set(key, evaluated);
  return evaluated;
}

/** Four cards the house gives away. It keeps the swap that hurts least against every reply. */
export function chooseCalpokerGiveaway(houseCards: Card[], playerCards: Card[]): number[] {
  const memo = new Map<string, EvaluatedHand>();
  const indexes = [0, 1, 2, 3, 4, 5, 6, 7];
  const houseChoices = combinations(indexes, 4);
  const playerChoices = combinations(indexes, 4);
  let best: { give: number[]; worst: number; total: number } | null = null;

  for (const give of houseChoices) {
    let worst = Number.POSITIVE_INFINITY;
    let total = 0;
    for (const reply of playerChoices) {
      const finals = applyCalpokerSwap(playerCards, houseCards, reply, give);
      const delta = bestHand(finals.houseFinal, memo).score - bestHand(finals.playerFinal, memo).score;
      if (delta < worst) worst = delta;
      total += delta;
    }
    if (!best || worst > best.worst || (worst === best.worst && total > best.total)) {
      best = { give, worst, total };
    }
  }

  return best!.give;
}

function bestFive(cards: Card[]): Card[] {
  let best: { score: number; cards: Card[] } | null = null;
  const indexes = cards.map((_, index) => index);
  for (const combo of combinations(indexes, 5)) {
    const five = combo.map((index) => cards[index]);
    const score = evaluateBestHand(five).score;
    if (!best || score > best.score) best = { score, cards: five };
  }
  return best!.cards;
}

function present(cards: Card[], showBest: boolean): CalpokerCard[] {
  const played = showBest ? new Set(bestFive(cards).map(cardKey)) : new Set<string>();
  return sortHand(cards).map((card) => ({ ...card, played: played.has(cardKey(card)) }));
}

function assertGive(indexes: number[]): void {
  if (indexes.length !== 4 || new Set(indexes).size !== 4) {
    throw new Error("Give exactly four cards");
  }
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index > 7)) {
    throw new Error("That card is not in the hand");
  }
}

export class CalpokerTable {
  private id: string;
  private playerId: string;
  private displayName: string;
  private stackMojos: bigint;
  private minAnteMojos: bigint;
  private maxAnteMojos: bigint;
  private sessionStartMojos: bigint;
  private lossLimitMojos: bigint | null;
  private phase: CalpokerPhase = "betting";
  private playerCards: Card[] = [];
  private houseCards: Card[] = [];
  private shoe: Card[] = [];
  private anteMojos = 0n;
  private winner: CalpokerWinner | null = null;
  private payoutMojos: bigint | null = null;
  private profitMojos: bigint | null = null;
  private commitHash: string | null = null;
  private serverSeed: string | null = null;

  constructor(options: {
    id: string;
    playerId: string;
    displayName: string;
    stackMojos: bigint;
    minAnteMojos?: bigint;
    maxAnteMojos?: bigint;
    lossLimitMojos?: bigint | null;
  }) {
    this.id = options.id;
    this.playerId = options.playerId;
    this.displayName = options.displayName;
    this.stackMojos = options.stackMojos;
    this.sessionStartMojos = options.stackMojos;
    this.minAnteMojos = options.minAnteMojos ?? 10_000n;
    this.maxAnteMojos = options.maxAnteMojos ?? 100_000n;
    this.lossLimitMojos = options.lossLimitMojos ?? null;
  }

  setLossLimit(limitMojos: bigint | null): void {
    if (this.phase === "selecting") throw new Error("Finish the hand before changing the session limit");
    if (limitMojos !== null && limitMojos <= 0n) throw new Error("Set a session limit above zero");
    this.lossLimitMojos = limitMojos;
  }

  deal(anteMojos: bigint, shoe?: Card[]): void {
    if (this.phase === "selecting") throw new Error("Hand in progress");
    if (anteMojos <= 0n) throw new Error("Ante must be larger than zero");
    if (anteMojos < this.minAnteMojos) throw new Error("Ante is below the table minimum");
    if (anteMojos > this.maxAnteMojos) throw new Error("Ante is above the table maximum");
    this.assertWager(anteMojos);
    if (anteMojos > this.stackMojos) throw new Error("Ante is bigger than your stack");

    this.stackMojos -= anteMojos;
    this.anteMojos = anteMojos;
    this.winner = null;
    this.payoutMojos = null;
    this.profitMojos = null;
    this.playerCards = [];
    this.houseCards = [];

    if (shoe) {
      this.shoe = shoe.map((card) => ({ ...card }));
      this.serverSeed = null;
      this.commitHash = null;
    } else {
      const commit = createCommit(generateServerSeed());
      this.serverSeed = commit.serverSeed;
      this.commitHash = commit.commitHash;
      this.shoe = shuffleDeck(standardDeck(), commit.serverSeed);
    }

    for (let i = 0; i < 8; i++) this.playerCards.push(this.take());
    for (let i = 0; i < 8; i++) this.houseCards.push(this.take());
    this.playerCards = sortHand(this.playerCards);
    this.houseCards = sortHand(this.houseCards);
    this.phase = "selecting";
  }

  swap(giveIndexes: number[]): void {
    if (this.phase !== "selecting") throw new Error("No hand to swap");
    assertGive(giveIndexes);
    const houseGive = chooseCalpokerGiveaway(this.houseCards, this.playerCards);
    const finals = applyCalpokerSwap(this.playerCards, this.houseCards, giveIndexes, houseGive);
    this.playerCards = finals.playerFinal;
    this.houseCards = finals.houseFinal;

    const playerScore = evaluateBestHand(this.playerCards).score;
    const houseScore = evaluateBestHand(this.houseCards).score;
    const payout = playerScore > houseScore ? this.anteMojos * 2n : playerScore === houseScore ? this.anteMojos : 0n;
    this.winner = playerScore > houseScore ? "player" : playerScore === houseScore ? "tie" : "house";
    this.payoutMojos = payout;
    this.profitMojos = payout - this.anteMojos;
    this.stackMojos += payout;
    this.phase = "done";
  }

  view(): CalpokerView {
    const done = this.phase === "done";
    const outstanding = this.outstandingMojos();
    return {
      tableId: this.id,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      minAnteMojos: this.minAnteMojos,
      maxAnteMojos: this.maxAnteMojos,
      phase: this.phase,
      playerCards: present(this.playerCards, done),
      houseCards: present(this.houseCards, done),
      anteMojos: this.anteMojos,
      winner: this.winner,
      playerHand: done ? describeEvaluatedHand(evaluateBestHand(this.playerCards)) : null,
      houseHand: done ? describeEvaluatedHand(evaluateBestHand(this.houseCards)) : null,
      payoutMojos: this.payoutMojos,
      profitMojos: this.profitMojos,
      sessionStartMojos: this.sessionStartMojos,
      sessionResultMojos: sessionResultMojos(this.sessionStartMojos, this.stackMojos, outstanding),
      lossLimitMojos: this.lossLimitMojos,
      lossRoomMojos: lossRoomMojos(this.sessionStartMojos, this.stackMojos, outstanding, this.lossLimitMojos),
      limitReached: this.phase !== "selecting" && sessionLimitReached(this.sessionStartMojos, this.stackMojos, this.lossLimitMojos),
      commitHash: this.commitHash,
      serverSeed: done ? this.serverSeed : null,
    };
  }

  toSnapshot(): CalpokerSnapshot {
    return {
      id: this.id,
      playerId: this.playerId,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      minAnteMojos: this.minAnteMojos,
      maxAnteMojos: this.maxAnteMojos,
      sessionStartMojos: this.sessionStartMojos,
      lossLimitMojos: this.lossLimitMojos,
      phase: this.phase,
      playerCards: this.playerCards.map((card) => ({ ...card })),
      houseCards: this.houseCards.map((card) => ({ ...card })),
      shoe: this.shoe.map((card) => ({ ...card })),
      anteMojos: this.anteMojos,
      winner: this.winner,
      payoutMojos: this.payoutMojos,
      profitMojos: this.profitMojos,
      commitHash: this.commitHash,
      serverSeed: this.serverSeed,
    };
  }

  static fromSnapshot(snapshot: CalpokerSnapshot): CalpokerTable {
    const table = new CalpokerTable({
      id: snapshot.id,
      playerId: snapshot.playerId,
      displayName: snapshot.displayName,
      stackMojos: snapshot.stackMojos,
      minAnteMojos: snapshot.minAnteMojos,
      maxAnteMojos: snapshot.maxAnteMojos,
      lossLimitMojos: snapshot.lossLimitMojos ?? null,
    });
    table.sessionStartMojos = snapshot.sessionStartMojos ?? snapshot.stackMojos;
    table.phase = snapshot.phase;
    table.playerCards = snapshot.playerCards.map((card) => ({ ...card }));
    table.houseCards = snapshot.houseCards.map((card) => ({ ...card }));
    table.shoe = snapshot.shoe.map((card) => ({ ...card }));
    table.anteMojos = snapshot.anteMojos;
    table.winner = snapshot.winner;
    table.payoutMojos = snapshot.payoutMojos;
    table.profitMojos = snapshot.profitMojos;
    table.commitHash = snapshot.commitHash;
    table.serverSeed = snapshot.serverSeed;
    return table;
  }

  private take(): Card {
    const card = this.shoe.shift();
    if (!card) throw new Error("The deck is empty");
    return card;
  }

  private outstandingMojos(): bigint {
    return this.phase === "selecting" ? this.anteMojos : 0n;
  }

  private assertWager(wagerMojos: bigint): void {
    assertSessionWager({
      sessionStartMojos: this.sessionStartMojos,
      stackMojos: this.stackMojos,
      outstandingMojos: this.outstandingMojos(),
      wagerMojos,
      lossLimitMojos: this.lossLimitMojos,
    });
  }
}
