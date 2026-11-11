import type { HandId, PlayerId, Street, TableConfig } from "@dat-poker/shared";
import { standardDeck, type Card } from "./card.js";
import { compareHands, describeEvaluatedHand, evaluateBestHand } from "./hand-evaluator.js";
import { nextClockwise, settlePots } from "./pot-settle.js";
import {
  buildShuffleEntropy,
  createCommit,
  generateServerSeed,
  shuffleDeck,
  verifyCommit,
} from "./shuffle.js";

export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface ShownHand {
  playerId: PlayerId;
  holeCards: Card[];
  handLabel: string;
}

export interface HandResultStack {
  playerId: PlayerId;
  seatIndex: number;
  stackMojos: bigint;
}

export interface PotAward {
  playerId: PlayerId;
  amountMojos: bigint;
}

export interface HandResult {
  handId: HandId;
  winnerId: PlayerId;
  potMojos: bigint;
  reason: "fold" | "showdown";
  board: Card[];
  commitHash: string;
  /** Winner's showdown hand. Absent when the pot was won by a fold. */
  handLabel: string | null;
  /** Live hands at showdown. Empty when the pot was won by a fold. */
  shownHands: ShownHand[];
  stacks: HandResultStack[];
  payouts: PotAward[];
}

/** Hand state safe to send to one player. Omits the deck, seeds, and other hole cards. */
export interface PublicHandState {
  handId: HandId;
  street: Street;
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  dealerSeat: number;
  actionSeat: number | null;
  commitHash: string;
  players: Array<{
    playerId: PlayerId;
    seatIndex: number;
    holeCards: Card[];
    stackMojos: bigint;
    betThisStreetMojos: bigint;
    folded: boolean;
    allIn: boolean;
  }>;
}

export interface PlayerHandState {
  playerId: PlayerId;
  seatIndex: number;
  holeCards: Card[];
  stackMojos: bigint;
  betThisStreetMojos: bigint;
  totalBetHandMojos: bigint;
  folded: boolean;
  allIn: boolean;
  /** True after this player voluntarily acts on the current street. Blinds do not count. */
  actedThisStreet: boolean;
}

export interface TableHandState {
  handId: HandId;
  tableId: string;
  street: Street;
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  dealerSeat: number;
  actionSeat: number | null;
  players: PlayerHandState[];
  commitHash: string;
  serverSeed: string | null;
  playerSeeds: Record<PlayerId, string>;
  deck: Card[];
  deckIndex: number;
  seq: number;
}

export class NlheTableEngine {
  private config: TableConfig;
  private seats: Map<number, PlayerId> = new Map();
  private stacks: Map<PlayerId, bigint> = new Map();
  private hand: TableHandState | null = null;
  private lastHandResult: HandResult | null = null;
  /** Button for the next hand. Null until the first hand starts. */
  private buttonSeat: number | null = null;

  constructor(config: TableConfig) {
    this.config = config;
  }

  seatPlayer(playerId: PlayerId, seatIndex: number, buyInMojos: bigint): void {
    if (seatIndex < 0 || seatIndex >= this.config.maxSeats) {
      throw new Error("Invalid seat");
    }
    if (this.seats.has(seatIndex)) {
      throw new Error("Seat taken");
    }
    if (buyInMojos < this.config.minBuyInMojos || buyInMojos > this.config.maxBuyInMojos) {
      throw new Error("Buy-in out of range");
    }
    this.seats.set(seatIndex, playerId);
    this.stacks.set(playerId, buyInMojos);
  }

  getActivePlayerCount(): number {
    return this.seats.size;
  }

  isHandInProgress(): boolean {
    return this.hand !== null;
  }

  getPlayerStack(playerId: PlayerId): bigint | null {
    if (!this.stacks.has(playerId)) {
      return null;
    }
    if (this.hand) {
      const inHand = this.hand.players.find((p) => p.playerId === playerId);
      if (inHand) {
        return inHand.stackMojos;
      }
    }
    return this.stacks.get(playerId) ?? null;
  }

  getSeatedPlayers(): { playerId: PlayerId; seatIndex: number; stackMojos: bigint }[] {
    return [...this.seats.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seatIndex, playerId]) => ({
        playerId,
        seatIndex,
        stackMojos: this.getPlayerStack(playerId) ?? 0n,
      }));
  }

  cashOutPlayer(playerId: PlayerId): { stackMojos: bigint; seatIndex: number } {
    if (this.hand) {
      throw new Error("Cannot cash out during an active hand");
    }
    const stackMojos = this.stacks.get(playerId);
    if (stackMojos === undefined) {
      throw new Error("Player not seated");
    }
    let seatIndex: number | null = null;
    for (const [idx, seatedId] of this.seats) {
      if (seatedId === playerId) {
        seatIndex = idx;
        break;
      }
    }
    if (seatIndex === null) {
      throw new Error("Player not seated");
    }
    this.seats.delete(seatIndex);
    this.stacks.delete(playerId);
    return { stackMojos, seatIndex };
  }

  startHand(handId: HandId): { commitHash: string } {
    if (this.seats.size < 2) {
      throw new Error("Need at least 2 players");
    }
    if (this.hand) {
      throw new Error("Hand already in progress");
    }

    this.lastHandResult = null;
    const serverSeed = generateServerSeed();
    const { commitHash } = createCommit(serverSeed);
    const seated = [...this.seats.entries()].sort((a, b) => a[0] - b[0]);
    const button = this.ensureButton(seated.map(([seatIndex]) => seatIndex));

    const players: PlayerHandState[] = seated.map(([seatIndex, playerId]) => ({
      playerId,
      seatIndex,
      holeCards: [],
      stackMojos: this.stacks.get(playerId) ?? 0n,
      betThisStreetMojos: 0n,
      totalBetHandMojos: 0n,
      folded: false,
      allIn: false,
      actedThisStreet: false,
    }));

    this.hand = {
      handId,
      tableId: this.config.id,
      street: "preflop",
      board: [],
      potMojos: 0n,
      currentBetMojos: 0n,
      dealerSeat: button,
      actionSeat: button,
      players,
      commitHash,
      serverSeed,
      playerSeeds: {},
      deck: standardDeck(),
      deckIndex: 0,
      seq: 0,
    };

    return { commitHash };
  }

  submitPlayerSeed(playerId: PlayerId, seed: string): void {
    const h = this.requireHand();
    if (!h.players.some((p) => p.playerId === playerId)) {
      throw new Error("Player not in hand");
    }
    h.playerSeeds[playerId] = seed;
  }

  revealAndDeal(): void {
    const h = this.requireHand();
    if (!h.serverSeed) {
      throw new Error("No server seed");
    }
    if (!verifyCommit(h.serverSeed, h.commitHash)) {
      throw new Error("Commit mismatch");
    }

    const activeIds = h.players.map((p) => p.playerId);
    const missing = activeIds.filter((id) => !h.playerSeeds[id]);
    if (missing.length > 0) {
      throw new Error(`Missing player seeds: ${missing.join(",")}`);
    }

    const entropy = buildShuffleEntropy(h.serverSeed, h.playerSeeds);
    h.deck = shuffleDeck(h.deck, entropy);

    for (const p of h.players) {
      p.holeCards = [this.draw(h), this.draw(h)];
    }

    this.postBlinds(h);
    h.seq++;
  }

  applyAction(playerId: PlayerId, action: PlayerAction, amountMojos: bigint = 0n): void {
    const h = this.requireHand();
    const player = this.getPlayer(h, playerId);
    if (player.seatIndex !== h.actionSeat) {
      throw new Error("Not this player's turn");
    }
    if (player.folded || player.allIn) {
      throw new Error("Player cannot act");
    }

    switch (action) {
      case "fold":
        player.folded = true;
        break;
      case "check":
        if (player.betThisStreetMojos < h.currentBetMojos) {
          throw new Error("Cannot check facing a bet");
        }
        break;
      case "call": {
        const toCall = h.currentBetMojos - player.betThisStreetMojos;
        this.charge(player, h, toCall);
        break;
      }
      case "bet":
      case "raise": {
        if (amountMojos <= h.currentBetMojos) {
          throw new Error("Raise must exceed current bet");
        }
        const add = amountMojos - player.betThisStreetMojos;
        this.charge(player, h, add);
        h.currentBetMojos = player.betThisStreetMojos;
        break;
      }
      case "all-in": {
        const add = player.stackMojos;
        this.charge(player, h, add);
        player.allIn = true;
        if (player.betThisStreetMojos > h.currentBetMojos) {
          h.currentBetMojos = player.betThisStreetMojos;
        }
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    player.actedThisStreet = true;
    h.seq++;

    if (this.activePlayers(h).length <= 1) {
      this.awardToWinner(h);
      return;
    }

    if (this.bettingRoundComplete(h)) {
      this.advanceStreet(h);
    } else {
      this.advanceActionSeat(h, playerId);
    }
  }

  getBigBlindMojos(): bigint {
    return this.config.bigBlindMojos;
  }

  getSmallBlindMojos(): bigint {
    return this.config.smallBlindMojos;
  }

  getMaxSeats(): number {
    return this.config.maxSeats;
  }

  getButtonSeat(): number | null {
    return this.buttonSeat;
  }

  getHandState(): TableHandState | null {
    return this.hand ? structuredClone(this.hand) : null;
  }

  /** Viewer sees only their own hole cards. Pass null to hide every hand. */
  getPublicHandState(viewerId: PlayerId | null): PublicHandState | null {
    const h = this.hand;
    if (!h) return null;
    return {
      handId: h.handId,
      street: h.street,
      board: h.board.map((c) => ({ ...c })),
      potMojos: h.potMojos,
      currentBetMojos: h.currentBetMojos,
      dealerSeat: h.dealerSeat,
      actionSeat: h.actionSeat,
      commitHash: h.commitHash,
      players: h.players.map((p) => ({
        playerId: p.playerId,
        seatIndex: p.seatIndex,
        holeCards: p.playerId === viewerId ? p.holeCards.map((c) => ({ ...c })) : [],
        stackMojos: p.stackMojos,
        betThisStreetMojos: p.betThisStreetMojos,
        folded: p.folded,
        allIn: p.allIn,
      })),
    };
  }

  getLastHandResult(): HandResult | null {
    return this.lastHandResult ? structuredClone(this.lastHandResult) : null;
  }

  private requireHand(): TableHandState {
    if (!this.hand) throw new Error("No active hand");
    return this.hand;
  }

  private draw(h: TableHandState): Card {
    const card = h.deck[h.deckIndex];
    if (!card) throw new Error("Deck exhausted");
    h.deckIndex++;
    return card;
  }

  private postBlinds(h: TableHandState): void {
    const ring = this.clockwiseFrom(h, h.dealerSeat);
    const headsUp = ring.length === 2;
    const sb = headsUp ? ring[0] : ring[1];
    const bb = headsUp ? ring[1] : ring[2];
    const first = headsUp ? ring[0] : (ring[3] ?? ring[0]);

    this.charge(sb, h, this.config.smallBlindMojos);
    this.charge(bb, h, this.config.bigBlindMojos);
    h.currentBetMojos = bb.betThisStreetMojos;
    h.actionSeat = first.seatIndex;
  }

  /** Seats in clockwise order, starting at `fromSeat` when that player is in the hand. */
  private clockwiseFrom(h: TableHandState, fromSeat: number): PlayerHandState[] {
    const ordered = [...h.players].sort((a, b) => a.seatIndex - b.seatIndex);
    const start = ordered.findIndex((player) => player.seatIndex === fromSeat);
    if (start === -1) return ordered;
    return [...ordered.slice(start), ...ordered.slice(0, start)];
  }

  private ensureButton(occupied: number[]): number {
    if (this.buttonSeat !== null && occupied.includes(this.buttonSeat)) {
      return this.buttonSeat;
    }
    const next = nextClockwise(occupied, this.buttonSeat ?? -1);
    this.buttonSeat = next;
    return next;
  }

  private advanceButton(): void {
    const occupied = [...this.seats.keys()].sort((a, b) => a - b);
    if (occupied.length === 0) {
      this.buttonSeat = null;
      return;
    }
    this.buttonSeat = nextClockwise(occupied, this.buttonSeat ?? -1);
  }

  private charge(player: PlayerHandState, h: TableHandState, amount: bigint): void {
    const pay = amount > player.stackMojos ? player.stackMojos : amount;
    player.stackMojos -= pay;
    player.betThisStreetMojos += pay;
    player.totalBetHandMojos += pay;
    h.potMojos += pay;
    if (player.stackMojos === 0n) {
      player.allIn = true;
    }
    this.stacks.set(player.playerId, player.stackMojos);
  }

  private getPlayer(h: TableHandState, playerId: PlayerId): PlayerHandState {
    const p = h.players.find((x) => x.playerId === playerId);
    if (!p) throw new Error("Player not in hand");
    return p;
  }

  private activePlayers(h: TableHandState): PlayerHandState[] {
    return h.players.filter((p) => !p.folded);
  }

  private bettingRoundComplete(h: TableHandState): boolean {
    const contenders = h.players.filter((p) => !p.folded && !p.allIn);
    if (contenders.length === 0) return true;
    return contenders.every(
      (p) => p.actedThisStreet && p.betThisStreetMojos === h.currentBetMojos,
    );
  }

  private advanceActionSeat(h: TableHandState, fromPlayerId: PlayerId): void {
    const ordered = [...h.players].sort((a, b) => a.seatIndex - b.seatIndex);
    const fromIdx = ordered.findIndex((p) => p.playerId === fromPlayerId);
    if (fromIdx === -1) {
      h.actionSeat = null;
      return;
    }
    for (let i = 1; i <= ordered.length; i++) {
      const next = ordered[(fromIdx + i) % ordered.length];
      if (!next.folded && !next.allIn) {
        h.actionSeat = next.seatIndex;
        return;
      }
    }
    h.actionSeat = null;
  }

  private advanceStreet(h: TableHandState): void {
    for (const p of h.players) {
      p.betThisStreetMojos = 0n;
      p.actedThisStreet = false;
    }
    h.currentBetMojos = 0n;

    const next: Record<Street, Street | "showdown"> = {
      preflop: "flop",
      flop: "turn",
      turn: "river",
      river: "showdown",
      showdown: "showdown",
    };

    while (true) {
      const street = next[h.street];
      if (street === "showdown") {
        this.runShowdown(h);
        return;
      }

      h.street = street;
      const count = street === "flop" ? 3 : 1;
      for (let i = 0; i < count; i++) {
        h.board.push(this.draw(h));
      }
      h.seq++;

      if (h.players.some((p) => !p.folded && !p.allIn)) {
        this.setFirstToAct(h);
        return;
      }
    }
  }

  private setFirstToAct(h: TableHandState): void {
    const ring = this.clockwiseFrom(h, h.dealerSeat);
    for (let i = 1; i <= ring.length; i++) {
      const next = ring[i % ring.length];
      if (!next.folded && !next.allIn) {
        h.actionSeat = next.seatIndex;
        return;
      }
    }
    h.actionSeat = null;
  }

  private runShowdown(h: TableHandState): void {
    h.street = "showdown";
    const live = this.activePlayers(h);
    const shown: ShownHand[] = live.map((p) => ({
      playerId: p.playerId,
      holeCards: p.holeCards.map((c) => ({ ...c })),
      handLabel: describeEvaluatedHand(evaluateBestHand([...p.holeCards, ...h.board])),
    }));

    let best = live[0];
    let bestEval = evaluateBestHand([...best.holeCards, ...h.board]);

    for (const p of live.slice(1)) {
      const ev = evaluateBestHand([...p.holeCards, ...h.board]);
      if (compareHands(ev, bestEval) > 0) {
        best = p;
        bestEval = ev;
      }
    }

    this.finishHand(h, "showdown", shown);
  }

  private awardToWinner(h: TableHandState): void {
    this.finishHand(h, "fold", []);
  }

  private returnUncalled(h: TableHandState): void {
    const live = h.players.filter((player) => !player.folded);
    if (live.length < 2) return;
    const ranked = [...live].sort((a, b) => (a.totalBetHandMojos > b.totalBetHandMojos ? -1 : 1));
    const unmatched = ranked[0].totalBetHandMojos - ranked[1].totalBetHandMojos;
    if (unmatched <= 0n) return;
    ranked[0].totalBetHandMojos -= unmatched;
    ranked[0].stackMojos += unmatched;
    h.potMojos -= unmatched;
    this.stacks.set(ranked[0].playerId, ranked[0].stackMojos);
  }

  private finishHand(h: TableHandState, reason: "fold" | "showdown", shownHands: ShownHand[]): void {
    this.returnUncalled(h);
    const scores = new Map(
      shownHands.map((shown) => {
        const player = h.players.find((candidate) => candidate.playerId === shown.playerId);
        const score = player
          ? evaluateBestHand([...player.holeCards, ...h.board]).score
          : 0;
        return [shown.playerId, score] as const;
      }),
    );
    const payouts = settlePots(
      h.players.map((player) => ({
        playerId: player.playerId,
        seatIndex: player.seatIndex,
        folded: player.folded,
        contributed: player.totalBetHandMojos,
        handScore: scores.get(player.playerId) ?? 0,
      })),
      h.dealerSeat,
    );
    for (const payout of payouts) {
      const player = h.players.find((candidate) => candidate.playerId === payout.playerId);
      if (!player) continue;
      player.stackMojos += payout.amountMojos;
      this.stacks.set(player.playerId, player.stackMojos);
    }
    const winner =
      [...payouts].sort((a, b) => (a.amountMojos > b.amountMojos ? -1 : 1))[0] ??
      null;
    const winnerShown = winner ? shownHands.find((shown) => shown.playerId === winner.playerId) : undefined;
    const potMojos = h.potMojos;
    this.lastHandResult = {
      handId: h.handId,
      winnerId: winner?.playerId ?? h.players[0].playerId,
      potMojos,
      reason,
      board: h.board.map((card) => ({ ...card })),
      commitHash: h.commitHash,
      handLabel: winnerShown?.handLabel ?? null,
      shownHands,
      stacks: h.players.map((player) => ({
        playerId: player.playerId,
        seatIndex: player.seatIndex,
        stackMojos: player.stackMojos,
      })),
      payouts,
    };
    h.potMojos = 0n;
    this.hand = null;
    this.advanceButton();
  }
}
