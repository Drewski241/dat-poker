import type { HandId, PlayerId, Street, TableConfig } from "@dat-poker/shared";
import { standardDeck, type Card } from "./card.js";
import { compareHands, evaluateBestHand, type HandCategory } from "./hand-evaluator.js";
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
  category: HandCategory;
}

export interface HandResult {
  handId: HandId;
  winnerId: PlayerId;
  potMojos: bigint;
  reason: "fold" | "showdown";
  board: Card[];
  shown: ShownHand[];
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
  /** Voluntary action (check/call/fold/bet/raise) completed this betting round. */
  actedThisStreet: boolean;
}

export interface TableHandState {
  handId: HandId;
  tableId: string;
  street: Street;
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  /** Min raise increment on this street (last bet/raise size, at least BB). */
  lastRaiseIncrementMojos: bigint;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
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
  private handsPlayed: Map<PlayerId, number> = new Map();
  private hand: TableHandState | null = null;
  private lastHandResult: HandResult | null = null;
  /** Dealer button seat between hands; moves one occupied seat clockwise after each hand. */
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
    if (!this.handsPlayed.has(playerId)) {
      this.handsPlayed.set(playerId, 0);
    }
  }

  getMaxSeats(): number {
    return this.config.maxSeats;
  }

  getSmallBlindMojos(): bigint {
    return this.config.smallBlindMojos;
  }

  getBigBlindMojos(): bigint {
    return this.config.bigBlindMojos;
  }

  emptySeatIndex(): number | null {
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!this.seats.has(i)) return i;
    }
    return null;
  }

  hasPlayer(playerId: PlayerId): boolean {
    return [...this.seats.values()].includes(playerId);
  }

  getActivePlayerCount(): number {
    return this.seats.size;
  }

  isHandInProgress(): boolean {
    return this.hand !== null;
  }

  /** Drop the current hand and put this-hand bets back on stacks (redeploy). */
  abortHandRefundBets(): void {
    const h = this.hand;
    if (!h) return;
    for (const p of h.players) {
      if (p.totalBetHandMojos <= 0n) continue;
      p.stackMojos += p.totalBetHandMojos;
      this.stacks.set(p.playerId, p.stackMojos);
    }
    this.hand = null;
    this.lastHandResult = null;
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
    this.handsPlayed.delete(playerId);
    return { stackMojos, seatIndex };
  }

  /** Restore persisted play-through after a rejoin / redeploy. */
  setHandsPlayed(playerId: PlayerId, count: number): void {
    if (!this.stacks.has(playerId)) {
      return;
    }
    this.handsPlayed.set(playerId, Math.max(0, Math.floor(count)));
  }

  getHandsPlayed(playerId: PlayerId): number {
    return this.handsPlayed.get(playerId) ?? 0;
  }

  /** Take unlocked DAT off a stack between hands; cash out if the stack hits 0. */
  debitStack(playerId: PlayerId, mojos: bigint): { remaining: bigint; seatIndex: number } {
    if (this.hand) {
      throw new Error("Cannot cash out during an active hand");
    }
    if (mojos <= 0n) {
      throw new Error("Debit must be positive");
    }
    const stackMojos = this.stacks.get(playerId);
    if (stackMojos === undefined) {
      throw new Error("Player not seated");
    }
    if (mojos > stackMojos) {
      throw new Error("Insufficient stack");
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
    const remaining = stackMojos - mojos;
    this.stacks.set(playerId, remaining);
    if (remaining === 0n) {
      this.cashOutPlayer(playerId);
      return { remaining: 0n, seatIndex };
    }
    return { remaining, seatIndex };
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
    const occupiedSeats = seated.map(([seatIndex]) => seatIndex);
    if (this.buttonSeat == null || !this.seats.has(this.buttonSeat)) {
      this.buttonSeat = occupiedSeats[0];
    }
    const dealerSeat = this.buttonSeat;

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
      lastRaiseIncrementMojos: this.config.bigBlindMojos,
      dealerSeat,
      smallBlindSeat: dealerSeat,
      bigBlindSeat: dealerSeat,
      actionSeat: dealerSeat,
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

    const currentBetBefore = h.currentBetMojos;

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
        const maxTo = player.betThisStreetMojos + player.stackMojos;
        const minRaiseTo = h.currentBetMojos + h.lastRaiseIncrementMojos;
        if (amountMojos < minRaiseTo && amountMojos < maxTo) {
          throw new Error("Raise must be at least the size of the last bet or raise");
        }
        const add = amountMojos - player.betThisStreetMojos;
        this.charge(player, h, add);
        h.currentBetMojos = player.betThisStreetMojos;
        this.updateLastRaiseIncrement(h, currentBetBefore);
        break;
      }
      case "all-in": {
        const add = player.stackMojos;
        this.charge(player, h, add);
        player.allIn = true;
        if (player.betThisStreetMojos > h.currentBetMojos) {
          h.currentBetMojos = player.betThisStreetMojos;
        }
        this.updateLastRaiseIncrement(h, currentBetBefore);
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    this.recordActionOnStreet(h, player, currentBetBefore);

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

  getHandState(): TableHandState | null {
    return this.hand ? structuredClone(this.hand) : null;
  }

  getLastHandResult(): HandResult | null {
    return this.lastHandResult ? structuredClone(this.lastHandResult) : null;
  }

  /** Seat index of the dealer button for the next hand (or current hand while dealt). */
  getDealerButtonSeat(): number | null {
    if (this.hand) {
      return this.hand.dealerSeat;
    }
    return this.buttonSeat;
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
    const seats = this.occupiedSeatIndices(h);
    const dealer = h.dealerSeat;
    let sbSeat: number;
    let bbSeat: number;
    if (h.players.length === 2) {
      sbSeat = dealer;
      bbSeat = this.nextOccupiedSeatClockwise(seats, dealer);
    } else {
      sbSeat = this.nextOccupiedSeatClockwise(seats, dealer);
      bbSeat = this.nextOccupiedSeatClockwise(seats, sbSeat);
    }
    const sb = this.playerAtSeat(h, sbSeat);
    const bb = this.playerAtSeat(h, bbSeat);
    if (!sb || !bb) {
      throw new Error("Could not assign blinds");
    }
    h.smallBlindSeat = sbSeat;
    h.bigBlindSeat = bbSeat;
    this.charge(sb, h, this.config.smallBlindMojos);
    this.charge(bb, h, this.config.bigBlindMojos);
    h.currentBetMojos = bb.betThisStreetMojos;
    h.actionSeat =
      h.players.length === 2
        ? sbSeat
        : this.nextOccupiedSeatClockwise(seats, bbSeat);
  }

  private charge(player: PlayerHandState, h: TableHandState, amount: bigint): void {
    const pay = amount > player.stackMojos ? player.stackMojos : amount;
    player.stackMojos -= pay;
    player.betThisStreetMojos += pay;
    player.totalBetHandMojos += pay;
    h.potMojos += pay;
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
      (p) => p.betThisStreetMojos === h.currentBetMojos && p.actedThisStreet,
    );
  }

  private updateLastRaiseIncrement(h: TableHandState, currentBetBefore: bigint): void {
    const newBet = h.currentBetMojos;
    if (newBet <= currentBetBefore) return;
    const increment = newBet - currentBetBefore;
    if (increment >= h.lastRaiseIncrementMojos) {
      h.lastRaiseIncrementMojos = increment;
    }
  }

  private recordActionOnStreet(
    h: TableHandState,
    actor: PlayerHandState,
    currentBetBefore: bigint,
  ): void {
    actor.actedThisStreet = true;
    if (h.currentBetMojos > currentBetBefore) {
      for (const p of h.players) {
        if (p.playerId === actor.playerId || p.folded || p.allIn) continue;
        p.actedThisStreet = false;
      }
    }
  }

  private advanceActionSeat(h: TableHandState, fromPlayerId: PlayerId): void {
    const from = this.getPlayer(h, fromPlayerId);
    try {
      h.actionSeat = this.firstActiveSeatClockwise(h, from.seatIndex);
    } catch {
      h.actionSeat = null;
    }
  }

  private advanceStreet(h: TableHandState): void {
    for (const p of h.players) {
      p.betThisStreetMojos = 0n;
      p.actedThisStreet = false;
    }
    h.currentBetMojos = 0n;
    h.lastRaiseIncrementMojos = this.config.bigBlindMojos;

    const next: Record<Street, Street | "showdown"> = {
      preflop: "flop",
      flop: "turn",
      turn: "river",
      river: "showdown",
      showdown: "showdown",
    };

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
    h.actionSeat = this.firstActiveSeatClockwise(h, h.dealerSeat);
    h.seq++;
  }

  private runShowdown(h: TableHandState): void {
    h.street = "showdown";
    const live = this.activePlayers(h);
    let best = live[0];
    let bestEval = evaluateBestHand([...best.holeCards, ...h.board]);

    for (const p of live.slice(1)) {
      const ev = evaluateBestHand([...p.holeCards, ...h.board]);
      if (compareHands(ev, bestEval) > 0) {
        best = p;
        bestEval = ev;
      }
    }

    best.stackMojos += h.potMojos;
    this.stacks.set(best.playerId, best.stackMojos);
    this.lastHandResult = {
      handId: h.handId,
      winnerId: best.playerId,
      potMojos: h.potMojos,
      reason: "showdown",
      board: [...h.board],
      shown: live.map((p) => ({
        playerId: p.playerId,
        holeCards: [...p.holeCards],
        category: evaluateBestHand([...p.holeCards, ...h.board]).category,
      })),
    };
    this.recordHandPlayed(h);
    h.potMojos = 0n;
    this.finishHand();
  }

  private awardToWinner(h: TableHandState): void {
    const winner = this.activePlayers(h)[0];
    winner.stackMojos += h.potMojos;
    this.stacks.set(winner.playerId, winner.stackMojos);
    this.lastHandResult = {
      handId: h.handId,
      winnerId: winner.playerId,
      potMojos: h.potMojos,
      reason: "fold",
      board: [...h.board],
      shown: [],
    };
    this.recordHandPlayed(h);
    h.potMojos = 0n;
    this.finishHand();
  }

  private finishHand(): void {
    this.rotateButton();
    this.hand = null;
  }

  private rotateButton(): void {
    const seats = this.occupiedTableSeats();
    if (seats.length === 0) {
      this.buttonSeat = null;
      return;
    }
    const current = this.buttonSeat ?? seats[0];
    this.buttonSeat = this.nextOccupiedSeatClockwise(seats, current);
  }

  private occupiedTableSeats(): number[] {
    return [...this.seats.keys()].sort((a, b) => a - b);
  }

  private occupiedSeatIndices(h: TableHandState): number[] {
    return h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
  }

  /** Next occupied seat clockwise (excluding fromSeat itself). */
  private nextOccupiedSeatClockwise(seats: number[], fromSeat: number): number {
    const max = this.config.maxSeats;
    let seat = fromSeat;
    for (let step = 0; step < max; step++) {
      seat = (seat + 1) % max;
      if (seats.includes(seat)) {
        return seat;
      }
    }
    throw new Error("No occupied seat");
  }

  private playerAtSeat(h: TableHandState, seatIndex: number): PlayerHandState | undefined {
    return h.players.find((p) => p.seatIndex === seatIndex);
  }

  /** First active player clockwise after fromSeat (skips fromSeat). */
  private firstActiveSeatClockwise(h: TableHandState, fromSeat: number): number {
    const seats = this.occupiedSeatIndices(h);
    const max = this.config.maxSeats;
    let seat = fromSeat;
    for (let step = 0; step < max; step++) {
      seat = (seat + 1) % max;
      if (!seats.includes(seat)) continue;
      const p = this.playerAtSeat(h, seat);
      if (p && !p.folded && !p.allIn) {
        return seat;
      }
    }
    throw new Error("No active player");
  }

  private recordHandPlayed(h: TableHandState): void {
    for (const p of h.players) {
      this.handsPlayed.set(p.playerId, (this.handsPlayed.get(p.playerId) ?? 0) + 1);
    }
  }
}
