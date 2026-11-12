import type { Card } from "./card.js";
import { standardDeck } from "./card.js";
import { createCommit, generateServerSeed, shuffleDeck } from "./shuffle.js";

export type BlackjackPhase = "betting" | "acting" | "done";
export type BlackjackOutcome = "blackjack" | "win" | "push" | "lose" | "bust";

export interface BlackjackHand {
  cards: Card[];
  betMojos: bigint;
  stood: boolean;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  busted: boolean;
  outcome: BlackjackOutcome | null;
  profitMojos: bigint;
}

export interface BlackjackSnapshot {
  id: string;
  playerId: string;
  displayName: string;
  stackMojos: bigint;
  minBetMojos: bigint;
  maxBetMojos: bigint;
  phase: BlackjackPhase;
  hands: BlackjackHand[];
  activeIndex: number;
  dealer: Card[];
  revealed: boolean;
  shoe: Card[];
  commitHash: string | null;
  serverSeed: string | null;
}

export interface BlackjackView {
  tableId: string;
  displayName: string;
  stackMojos: bigint;
  minBetMojos: bigint;
  maxBetMojos: bigint;
  phase: BlackjackPhase;
  dealerCards: Card[];
  dealerTotal: string | null;
  hands: Array<{
    cards: Card[];
    betMojos: bigint;
    total: string;
    outcome: BlackjackOutcome | null;
    profitMojos: bigint;
    active: boolean;
  }>;
  actions: { hit: boolean; stand: boolean; double: boolean; split: boolean };
  commitHash: string | null;
  serverSeed: string | null;
}

const TEN_RANKS = new Set(["T", "J", "Q", "K"]);

export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (TEN_RANKS.has(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function describeHand(cards: Card[], natural = true): string {
  if (cards.length === 0) return "";
  const { total, soft } = handTotal(cards);
  if (natural && cards.length === 2 && total === 21) return "Blackjack";
  if (total > 21) return "Bust";
  if (soft && total < 21) return `soft ${total}`;
  return String(total);
}

export class BlackjackTable {
  private id: string;
  private playerId: string;
  private displayName: string;
  private stackMojos: bigint;
  private minBetMojos: bigint;
  private maxBetMojos: bigint;
  private phase: BlackjackPhase = "betting";
  private hands: BlackjackHand[] = [];
  private activeIndex = 0;
  private dealer: Card[] = [];
  private revealed = false;
  private shoe: Card[] = [];
  private commitHash: string | null = null;
  private serverSeed: string | null = null;

  constructor(options: {
    id: string;
    playerId: string;
    displayName: string;
    stackMojos: bigint;
    minBetMojos?: bigint;
    maxBetMojos?: bigint;
  }) {
    this.id = options.id;
    this.playerId = options.playerId;
    this.displayName = options.displayName;
    this.stackMojos = options.stackMojos;
    this.minBetMojos = options.minBetMojos ?? 10_000n;
    this.maxBetMojos = options.maxBetMojos ?? 500_000n;
  }

  placeBet(amountMojos: bigint, shoe?: Card[]): void {
    if (this.phase === "acting") throw new Error("Hand in progress");
    if (amountMojos > this.stackMojos) throw new Error("Bet is bigger than your stack");
    if (amountMojos < this.minBetMojos) throw new Error("Bet is below the table minimum");
    if (amountMojos > this.maxBetMojos) throw new Error("Bet is above the table maximum");
    if (amountMojos <= 0n) throw new Error("Bet must be larger than zero");

    this.stackMojos -= amountMojos;
    this.hands = [this.freshHand(amountMojos)];
    this.activeIndex = 0;
    this.dealer = [];
    this.revealed = false;
    this.phase = "acting";

    if (shoe) {
      this.shoe = shoe.map((card) => ({ ...card }));
      this.serverSeed = null;
      this.commitHash = null;
    } else {
      const { serverSeed, commitHash } = createCommit(generateServerSeed());
      this.serverSeed = serverSeed;
      this.commitHash = commitHash;
      this.shoe = shuffleDeck(standardDeck(), serverSeed);
    }

    this.hands[0].cards.push(this.draw());
    this.dealer.push(this.draw());
    this.hands[0].cards.push(this.draw());
    this.dealer.push(this.draw());

    const playerNatural = this.isNatural(this.hands[0]);
    const dealerNatural = this.isNaturalCards(this.dealer);
    if (playerNatural || dealerNatural) this.settle();
  }

  hit(): void {
    const hand = this.requireActing();
    if (hand.splitAces) throw new Error("Split aces take one card");
    hand.cards.push(this.draw());
    if (handTotal(hand.cards).total >= 21) this.finishHand();
  }

  stand(): void {
    const hand = this.requireActing();
    hand.stood = true;
    this.finishHand();
  }

  double(): void {
    const hand = this.requireActing();
    if (hand.cards.length !== 2 || hand.splitAces) throw new Error("Double is only on the first two cards");
    if (hand.betMojos > this.stackMojos) throw new Error("Not enough chips to double");
    this.stackMojos -= hand.betMojos;
    hand.betMojos += hand.betMojos;
    hand.doubled = true;
    hand.cards.push(this.draw());
    hand.stood = true;
    this.finishHand();
  }

  split(): void {
    const hand = this.requireActing();
    if (this.hands.length !== 1 || hand.cards.length !== 2) throw new Error("Split is only on the first two cards");
    if (hand.cards[0].rank !== hand.cards[1].rank) throw new Error("Those cards do not match");
    if (hand.betMojos > this.stackMojos) throw new Error("Not enough chips to split");

    const aces = hand.cards[0].rank === "A";
    this.stackMojos -= hand.betMojos;
    const second = this.freshHand(hand.betMojos);
    second.cards.push(hand.cards.pop()!);
    second.fromSplit = true;
    hand.fromSplit = true;
    hand.cards.push(this.draw());
    second.cards.push(this.draw());
    if (aces) {
      hand.splitAces = true;
      second.splitAces = true;
      hand.stood = true;
      second.stood = true;
    }
    this.hands = [hand, second];
    this.activeIndex = 0;
    if (aces) this.playDealer();
  }

  view(): BlackjackView {
    const hand = this.hands[this.activeIndex];
    const acting = this.phase === "acting" && hand && !hand.stood && !hand.busted;
    const total = hand ? handTotal(hand.cards).total : 0;
    const twoCards = Boolean(hand && hand.cards.length === 2);
    return {
      tableId: this.id,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      minBetMojos: this.minBetMojos,
      maxBetMojos: this.maxBetMojos,
      phase: this.phase,
      dealerCards: this.revealed ? this.dealer.map((card) => ({ ...card })) : this.dealer.slice(0, 1),
      dealerTotal: this.dealer.length === 0 ? null : describeHand(this.revealed ? this.dealer : this.dealer.slice(0, 1), this.revealed),
      hands: this.hands.map((playerHand, index) => ({
        cards: playerHand.cards.map((card) => ({ ...card })),
        betMojos: playerHand.betMojos,
        total: describeHand(playerHand.cards, !playerHand.fromSplit),
        outcome: playerHand.outcome,
        profitMojos: playerHand.profitMojos,
        active: this.phase === "acting" && index === this.activeIndex,
      })),
      actions: {
        hit: Boolean(acting && total < 21 && !hand.splitAces),
        stand: Boolean(acting && !hand.splitAces),
        double: Boolean(acting && twoCards && !hand.splitAces && this.stackMojos >= hand.betMojos),
        split: Boolean(
          acting &&
            this.hands.length === 1 &&
            twoCards &&
            hand.cards[0]?.rank === hand.cards[1]?.rank &&
            this.stackMojos >= hand.betMojos,
        ),
      },
      commitHash: this.commitHash,
      serverSeed: this.revealed ? this.serverSeed : null,
    };
  }

  toSnapshot(): BlackjackSnapshot {
    return {
      id: this.id,
      playerId: this.playerId,
      displayName: this.displayName,
      stackMojos: this.stackMojos,
      minBetMojos: this.minBetMojos,
      maxBetMojos: this.maxBetMojos,
      phase: this.phase,
      hands: structuredClone(this.hands),
      activeIndex: this.activeIndex,
      dealer: this.dealer.map((card) => ({ ...card })),
      revealed: this.revealed,
      shoe: this.shoe.map((card) => ({ ...card })),
      commitHash: this.commitHash,
      serverSeed: this.serverSeed,
    };
  }

  static fromSnapshot(snapshot: BlackjackSnapshot): BlackjackTable {
    const table = new BlackjackTable({
      id: snapshot.id,
      playerId: snapshot.playerId,
      displayName: snapshot.displayName,
      stackMojos: snapshot.stackMojos,
      minBetMojos: snapshot.minBetMojos,
      maxBetMojos: snapshot.maxBetMojos,
    });
    table.phase = snapshot.phase;
    table.hands = structuredClone(snapshot.hands);
    table.activeIndex = snapshot.activeIndex;
    table.dealer = snapshot.dealer.map((card) => ({ ...card }));
    table.revealed = snapshot.revealed;
    table.shoe = snapshot.shoe.map((card) => ({ ...card }));
    table.commitHash = snapshot.commitHash;
    table.serverSeed = snapshot.serverSeed;
    return table;
  }

  private freshHand(betMojos: bigint): BlackjackHand {
    return {
      cards: [],
      betMojos,
      stood: false,
      doubled: false,
      fromSplit: false,
      splitAces: false,
      busted: false,
      outcome: null,
      profitMojos: 0n,
    };
  }

  private requireActing(): BlackjackHand {
    if (this.phase !== "acting") throw new Error("No hand to act on");
    const hand = this.hands[this.activeIndex];
    if (!hand || hand.stood || hand.busted) throw new Error("No hand to act on");
    return hand;
  }

  private draw(): Card {
    const card = this.shoe.shift();
    if (!card) throw new Error("The shoe is empty");
    return card;
  }

  private isNatural(hand: BlackjackHand): boolean {
    return !hand.fromSplit && this.isNaturalCards(hand.cards);
  }

  private isNaturalCards(cards: Card[]): boolean {
    return cards.length === 2 && handTotal(cards).total === 21;
  }

  private finishHand(): void {
    const hand = this.hands[this.activeIndex];
    if (handTotal(hand.cards).total > 21) hand.busted = true;
    if (this.activeIndex < this.hands.length - 1) {
      this.activeIndex += 1;
      const next = this.hands[this.activeIndex];
      if (next.stood || next.busted || handTotal(next.cards).total >= 21) this.finishHand();
      return;
    }
    this.playDealer();
  }

  private playDealer(): void {
    this.revealed = true;
    const live = this.hands.some((hand) => !hand.busted && handTotal(hand.cards).total <= 21);
    if (live) {
      while (handTotal(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    this.settle();
  }

  private settle(): void {
    this.revealed = true;
    const dealerTotal = handTotal(this.dealer).total;
    const dealerNatural = this.isNaturalCards(this.dealer);
    for (const hand of this.hands) {
      const playerTotal = handTotal(hand.cards).total;
      const natural = this.isNatural(hand);
      if (hand.busted || playerTotal > 21) {
        hand.busted = true;
        hand.outcome = "bust";
        hand.profitMojos = -hand.betMojos;
        continue;
      }
      if (natural && !dealerNatural) {
        const profit = (hand.betMojos * 3n) / 2n;
        hand.outcome = "blackjack";
        hand.profitMojos = profit;
        this.stackMojos += hand.betMojos + profit;
        continue;
      }
      if (dealerNatural || (dealerTotal <= 21 && dealerTotal > playerTotal)) {
        hand.outcome = "lose";
        hand.profitMojos = -hand.betMojos;
        continue;
      }
      if (dealerTotal > 21 || playerTotal > dealerTotal) {
        hand.outcome = "win";
        hand.profitMojos = hand.betMojos;
        this.stackMojos += hand.betMojos * 2n;
        continue;
      }
      hand.outcome = "push";
      hand.profitMojos = 0n;
      this.stackMojos += hand.betMojos;
    }
    this.phase = "done";
  }
}
