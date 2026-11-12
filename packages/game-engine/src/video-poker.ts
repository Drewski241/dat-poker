import type { Card } from "./card.js";
import { standardDeck } from "./card.js";
import { describeEvaluatedHand, evaluateBestHand } from "./hand-evaluator.js";
import { assertSessionWager, lossRoomMojos, sessionLimitReached, sessionResultMojos } from "./session-limit.js";
import { createCommit, generateServerSeed, shuffleDeck } from "./shuffle.js";

export type VideoPokerPhase = "betting" | "holding" | "done";

export type VideoPokerResult =
  | "royal_flush"
  | "straight_flush"
  | "four_kind"
  | "full_house"
  | "flush"
  | "straight"
  | "three_kind"
  | "two_pair"
  | "jacks_or_better"
  | "nothing";

export interface VideoPokerPayRow {
  id: Exclude<VideoPokerResult, "nothing">;
  label: string;
  /** Credits returned per coin. A jacks-or-better pays the stake back. */
  perCoin: number;
}

/** 9/6 Jacks or Better. A five-coin royal returns 800 per coin instead of 250. */
export const VIDEO_POKER_PAYTABLE: VideoPokerPayRow[] = [
  { id: "royal_flush", label: "Royal flush", perCoin: 250 },
  { id: "straight_flush", label: "Straight flush", perCoin: 50 },
  { id: "four_kind", label: "Four of a kind", perCoin: 25 },
  { id: "full_house", label: "Full house", perCoin: 9 },
  { id: "flush", label: "Flush", perCoin: 6 },
  { id: "straight", label: "Straight", perCoin: 4 },
  { id: "three_kind", label: "Three of a kind", perCoin: 3 },
  { id: "two_pair", label: "Two pair", perCoin: 2 },
  { id: "jacks_or_better", label: "Jacks or better", perCoin: 1 },
];

const PER_COIN = new Map(VIDEO_POKER_PAYTABLE.map((row) => [row.id, row.perCoin]));
const MAX_ROYAL_PER_COIN = 800;

export function classifyVideoPoker(cards: Card[]): VideoPokerResult {
  const hand = evaluateBestHand(cards);
  if (hand.category === "straight_flush") {
    return hand.kickers[0] === 14 ? "royal_flush" : "straight_flush";
  }
  if (hand.category === "pair") {
    return hand.kickers[0] >= 11 ? "jacks_or_better" : "nothing";
  }
  if (hand.category === "high_card") return "nothing";
  return hand.category;
}

/** Credits returned to the stack, including the original stake when the hand pays. */
export function videoPokerReturn(result: VideoPokerResult, betMojos: bigint, coins: number, maxCoins: number): bigint {
  if (result === "nothing") return 0n;
  const perCoin = result === "royal_flush" && coins === maxCoins ? MAX_ROYAL_PER_COIN : PER_COIN.get(result)!;
  return betMojos * BigInt(perCoin);
}

export interface VideoPokerSnapshot {
  id: string;
  playerId: string;
  displayName: string;
  stackMojos: bigint;
  coinMojos: bigint;
  maxCoins: number;
  phase: VideoPokerPhase;
  cards: Card[];
  held: boolean[];
  shoe: Card[];
  coins: number;
  betMojos: bigint;
  result: VideoPokerResult | null;
  payoutMojos: bigint | null;
  profitMojos: bigint | null;
  commitHash: string | null;
  serverSeed: string | null;
  sessionStartMojos: bigint;
  lossLimitMojos: bigint | null;
}

export interface VideoPokerView {
  tableId: string;
  displayName: string;
  stackMojos: bigint;
  coinMojos: bigint;
  maxCoins: number;
  phase: VideoPokerPhase;
  cards: Card[];
  held: boolean[];
  coins: number;
  betMojos: bigint;
  result: VideoPokerResult | null;
  handName: string | null;
  payoutMojos: bigint | null;
  profitMojos: bigint | null;
  paytable: VideoPokerPayRow[];
  royalMaxPerCoin: number;
  commitHash: string | null;
  serverSeed: string | null;
  sessionStartMojos: bigint;
  sessionResultMojos: bigint;
  lossLimitMojos: bigint | null;
  lossRoomMojos: bigint | null;
  limitReached: boolean;
}

export class VideoPokerTable {
  private id: string;
  private playerId: string;
  private displayName: string;
  private stackMojos: bigint;
  private coinMojos: bigint;
  private maxCoins: number;
  private phase: VideoPokerPhase = "betting";
  private cards: Card[] = [];
  private held: boolean[] = [false, false, false, false, false];
  private shoe: Card[] = [];
  private coins = 0;
  private betMojos = 0n;
  private result: VideoPokerResult | null = null;
  private payoutMojos: bigint | null = null;
  private profitMojos: bigint | null = null;
  private commitHash: string | null = null;
  private serverSeed: string | null = null;
  private sessionStartMojos: bigint;
  private lossLimitMojos: bigint | null = null;

  constructor(options: {
    id: string;
    playerId: string;
    displayName: string;
    stackMojos: bigint;
    coinMojos?: bigint;
    maxCoins?: number;
    lossLimitMojos?: bigint | null;
  }) {
    this.id = options.id;
    this.playerId = options.playerId;
    this.displayName = options.displayName;
    this.stackMojos = options.stackMojos;
    this.sessionStartMojos = options.stackMojos;
    this.coinMojos = options.coinMojos ?? 10_000n;
    this.maxCoins = options.maxCoins ?? 5;
    this.lossLimitMojos = options.lossLimitMojos ?? null;
  }

  setLossLimit(limitMojos: bigint | null): void {
    if (this.phase === "holding") throw new Error("Finish the hand before changing the session limit");
    if (limitMojos !== null && limitMojos <= 0n) throw new Error("Set a session limit above zero");
    this.lossLimitMojos = limitMojos;
  }

  deal(coins: number, shoe?: Card[]): void {
    if (this.phase === "holding") throw new Error("Hand in progress");
    if (!Number.isInteger(coins) || coins < 1 || coins > this.maxCoins) {
      throw new Error(`Bet 1 to ${this.maxCoins} coins`);
    }
    const bet = this.coinMojos * BigInt(coins);
    this.assertWager(bet);
    if (bet > this.stackMojos) throw new Error("Bet is bigger than your stack");

    this.stackMojos -= bet;
    this.coins = coins;
    this.betMojos = bet;
    this.held = [false, false, false, false, false];
    this.result = null;
    this.payoutMojos = null;
    this.profitMojos = null;
    this.cards = [];

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

    for (let i = 0; i < 5; i++) this.cards.push(this.take());
    this.phase = "holding";
  }

  toggleHold(index: number): void {
    if (this.phase !== "holding") throw new Error("No hand to hold");
    if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error("That card is not in the hand");
    this.held[index] = !this.held[index];
  }

  draw(): void {
    if (this.phase !== "holding") throw new Error("No hand to draw");
    for (let i = 0; i < 5; i++) {
      if (!this.held[i]) this.cards[i] = this.take();
    }
    const result = classifyVideoPoker(this.cards);
    const payout = videoPokerReturn(result, this.betMojos, this.coins, this.maxCoins);
    this.result = result;
    this.payoutMojos = payout;
    this.profitMojos = payout - this.betMojos;
    this.stackMojos += payout;
    this.phase = "done";
  }

  view(): VideoPokerView {
    const dealt = this.cards.length === 5;
    return {
      tableId: this.id,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      coinMojos: this.coinMojos,
      maxCoins: this.maxCoins,
      phase: this.phase,
      cards: this.cards.map((card) => ({ ...card })),
      held: [...this.held],
      coins: this.coins,
      betMojos: this.betMojos,
      result: this.result,
      handName: dealt ? describeEvaluatedHand(evaluateBestHand(this.cards)) : null,
      payoutMojos: this.payoutMojos,
      profitMojos: this.profitMojos,
      paytable: VIDEO_POKER_PAYTABLE,
      royalMaxPerCoin: MAX_ROYAL_PER_COIN,
      commitHash: this.commitHash,
      serverSeed: this.phase === "done" ? this.serverSeed : null,
      ...this.sessionView(),
    };
  }

  toSnapshot(): VideoPokerSnapshot {
    return {
      id: this.id,
      playerId: this.playerId,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      coinMojos: this.coinMojos,
      maxCoins: this.maxCoins,
      phase: this.phase,
      cards: this.cards.map((card) => ({ ...card })),
      held: [...this.held],
      shoe: this.shoe.map((card) => ({ ...card })),
      coins: this.coins,
      betMojos: this.betMojos,
      result: this.result,
      payoutMojos: this.payoutMojos,
      profitMojos: this.profitMojos,
      commitHash: this.commitHash,
      serverSeed: this.serverSeed,
      sessionStartMojos: this.sessionStartMojos,
      lossLimitMojos: this.lossLimitMojos,
    };
  }

  static fromSnapshot(snapshot: VideoPokerSnapshot): VideoPokerTable {
    const table = new VideoPokerTable({
      id: snapshot.id,
      playerId: snapshot.playerId,
      displayName: snapshot.displayName,
      stackMojos: snapshot.stackMojos,
      coinMojos: snapshot.coinMojos,
      maxCoins: snapshot.maxCoins,
    });
    table.phase = snapshot.phase;
    table.cards = snapshot.cards.map((card) => ({ ...card }));
    table.held = [...snapshot.held];
    table.shoe = snapshot.shoe.map((card) => ({ ...card }));
    table.coins = snapshot.coins;
    table.betMojos = snapshot.betMojos;
    table.result = snapshot.result;
    table.payoutMojos = snapshot.payoutMojos;
    table.profitMojos = snapshot.profitMojos;
    table.commitHash = snapshot.commitHash;
    table.serverSeed = snapshot.serverSeed;
    table.sessionStartMojos = snapshot.sessionStartMojos ?? snapshot.stackMojos;
    table.lossLimitMojos = snapshot.lossLimitMojos ?? null;
    return table;
  }

  private outstandingMojos(): bigint {
    return this.phase === "holding" ? this.betMojos : 0n;
  }

  private sessionView(): Pick<
    VideoPokerView,
    "sessionStartMojos" | "sessionResultMojos" | "lossLimitMojos" | "lossRoomMojos" | "limitReached"
  > {
    const outstanding = this.outstandingMojos();
    return {
      sessionStartMojos: this.sessionStartMojos,
      sessionResultMojos: sessionResultMojos(this.sessionStartMojos, this.stackMojos, outstanding),
      lossLimitMojos: this.lossLimitMojos,
      lossRoomMojos: lossRoomMojos(this.sessionStartMojos, this.stackMojos, outstanding, this.lossLimitMojos),
      limitReached: this.phase !== "holding" && sessionLimitReached(this.sessionStartMojos, this.stackMojos, this.lossLimitMojos),
    };
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

  private take(): Card {
    const card = this.shoe.shift();
    if (!card) throw new Error("The deck is empty");
    return card;
  }
}
