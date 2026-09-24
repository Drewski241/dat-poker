import { isHousePlayerId, type HandId, type PlayerId, type Street, type TableConfig } from "@dat-poker/shared";
import { standardDeck, type Card } from "./card.js";
import { compareHands, evaluateBestHand, type HandCategory } from "./hand-evaluator.js";
import {
  buildShuffleEntropy,
  createCommit,
  generateServerSeed,
  shuffleDeck,
  verifyCommit,
} from "./shuffle.js";
import { buildSidePots, splitPotEvenly } from "./side-pots.js";

export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface ShownHand {
  playerId: PlayerId;
  holeCards: Card[];
  category: HandCategory;
  allIn: boolean;
}

export interface HandResultParticipant {
  playerId: PlayerId;
  /** Chips this player put in the pot this hand (including blinds). */
  totalBetHandMojos: bigint;
  /** Table stack immediately before the pot is paid to the winner. */
  stackBeforePayoutMojos: bigint;
}

export interface HandResult {
  handId: HandId;
  winnerId: PlayerId;
  potMojos: bigint;
  reason: "fold" | "showdown";
  board: Card[];
  shown: ShownHand[];
  allInPlayerIds: PlayerId[];
  participants: HandResultParticipant[];
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

  rebuyStack(playerId: PlayerId, buyInMojos: bigint): void {
    if (this.hand) {
      throw new Error("Cannot rebuy during an active hand");
    }
    if (!this.stacks.has(playerId)) {
      throw new Error("Player not seated");
    }
    const stack = this.stacks.get(playerId) ?? 0n;
    if (stack > 0n) {
      throw new Error("Rebuy is only available when your table stack is zero");
    }
    if (buyInMojos < this.config.minBuyInMojos || buyInMojos > this.config.maxBuyInMojos) {
      throw new Error("Buy-in out of range");
    }
    this.stacks.set(playerId, buyInMojos);
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

  getConfig(): TableConfig {
    return this.config;
  }

  setBlinds(smallBlindMojos: bigint, bigBlindMojos: bigint): void {
    this.config = { ...this.config, smallBlindMojos, bigBlindMojos };
  }

  emptySeatIndex(): number | null {
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!this.seats.has(i)) return i;
    }
    return null;
  }

  emptySeats(): number[] {
    const open: number[] = [];
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!this.seats.has(i)) open.push(i);
    }
    return open;
  }

  houseSeats(): { playerId: PlayerId; seatIndex: number; stackMojos: bigint }[] {
    return this.getSeatedPlayers().filter((p) => isHousePlayerId(p.playerId) && p.stackMojos > 0n);
  }

  claimHouseSeat(
    playerId: PlayerId,
    seatIndex?: number,
  ): { seatIndex: number; stackMojos: bigint; replacedPlayerId: PlayerId } {
    if (this.hand) {
      throw new Error("Wait for the current hand to finish before taking a house seat");
    }
    if (this.hasPlayer(playerId)) {
      throw new Error("Already seated");
    }
    const houses = this.houseSeats();
    const target =
      seatIndex === undefined ? houses[0] : houses.find((row) => row.seatIndex === seatIndex);
    if (!target) {
      throw new Error(houses.length === 0 ? "No house seats left to take" : "That seat is not a house seat");
    }
    this.cashOutPlayer(target.playerId);
    this.restoreSeat(playerId, target.seatIndex, target.stackMojos);
    return {
      seatIndex: target.seatIndex,
      stackMojos: target.stackMojos,
      replacedPlayerId: target.playerId,
    };
  }

  restoreSeat(playerId: PlayerId, seatIndex: number, stackMojos: bigint): void {
    if (this.hand) {
      throw new Error("Cannot restore a seat during an active hand");
    }
    if (this.seats.has(seatIndex) && this.seats.get(seatIndex) !== playerId) {
      throw new Error("Seat taken");
    }
    this.seats.set(seatIndex, playerId);
    this.stacks.set(playerId, stackMojos);
    if (!this.handsPlayed.has(playerId)) {
      this.handsPlayed.set(playerId, 0);
    }
  }

  setPlayerStack(playerId: PlayerId, stackMojos: bigint): void {
    if (!this.stacks.has(playerId)) {
      throw new Error("Player not seated");
    }
    this.stacks.set(playerId, stackMojos);
  }

  unseatBustedPlayers(): PlayerId[] {
    if (this.hand) {
      throw new Error("Cannot unseat during an active hand");
    }
    const busted: PlayerId[] = [];
    for (const seated of [...this.getSeatedPlayers()]) {
      if (seated.stackMojos > 0n) continue;
      try {
        this.cashOutPlayer(seated.playerId);
        busted.push(seated.playerId);
      } catch {
        /* already gone */
      }
    }
    return busted;
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

  /** Run out the board or skip action when everyone is all-in / the round is already closed. */
  advanceHandIfIdle(): void {
    const h = this.hand;
    if (!h) return;
    for (let guard = 0; guard < 16; guard++) {
      if (this.bettingRoundComplete(h)) {
        this.advanceStreet(h);
        if (!this.hand) return;
        continue;
      }
      if (h.actionSeat == null) break;
      const actor = this.playerAtSeat(h, h.actionSeat);
      if (actor && this.canPlayerAct(actor)) break;
      try {
        h.actionSeat = this.firstActiveSeatClockwise(h, h.actionSeat);
      } catch {
        if (this.bettingRoundComplete(h)) {
          this.advanceStreet(h);
          if (!this.hand) return;
          continue;
        }
        break;
      }
    }
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

  actorPlayerId(): PlayerId | null {
    const h = this.hand;
    if (!h || h.actionSeat == null) return null;
    return h.players.find((p) => p.seatIndex === h.actionSeat && !p.folded)?.playerId ?? null;
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

  private canPlayerAct(p: PlayerHandState): boolean {
    return !p.folded && !p.allIn && p.stackMojos > 0n;
  }

  private playersWhoCanBet(h: TableHandState): PlayerHandState[] {
    return h.players.filter((p) => this.canPlayerAct(p));
  }

  private bettingRoundComplete(h: TableHandState): boolean {
    const contenders = this.playersWhoCanBet(h);
    if (contenders.length === 0) return true;
    return contenders.every(
      (p) => p.betThisStreetMojos >= h.currentBetMojos && p.actedThisStreet,
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

    if (this.playersWhoCanBet(h).length === 0) {
      h.actionSeat = null;
      h.seq++;
      if (street === "river") {
        this.runShowdown(h);
      } else {
        this.advanceStreet(h);
      }
      return;
    }

    h.actionSeat = this.firstActiveSeatClockwise(h, h.dealerSeat);
    h.seq++;
  }

  private runShowdown(h: TableHandState): void {
    h.street = "showdown";
    const live = this.activePlayers(h);
    const participants = h.players.map((p) => ({
      playerId: p.playerId,
      totalBetHandMojos: p.totalBetHandMojos,
      stackBeforePayoutMojos: p.stackMojos,
    }));

    const { primaryWinnerId, awardedByPlayer } = this.settleSidePots(h, live, false);
    for (const p of h.players) {
      const add = awardedByPlayer.get(p.playerId) ?? 0n;
      if (add > 0n) {
        p.stackMojos += add;
        this.stacks.set(p.playerId, p.stackMojos);
      }
    }

    const potMojos = awardedByPlayer.get(primaryWinnerId) ?? 0n;
    this.lastHandResult = {
      handId: h.handId,
      winnerId: primaryWinnerId,
      potMojos,
      reason: "showdown",
      board: [...h.board],
      shown: this.showdownHandsToReveal(h, live, awardedByPlayer),
      allInPlayerIds: h.players.filter((p) => p.allIn && !p.folded).map((p) => p.playerId),
      participants,
    };
    this.recordHandPlayed(h);
    h.potMojos = 0n;
    this.finishHand();
  }

  private awardToWinner(h: TableHandState): void {
    const live = this.activePlayers(h);
    const participants = h.players.map((p) => ({
      playerId: p.playerId,
      totalBetHandMojos: p.totalBetHandMojos,
      stackBeforePayoutMojos: p.stackMojos,
    }));

    const { primaryWinnerId, awardedByPlayer } = this.settleSidePots(h, live, true);
    for (const p of h.players) {
      const add = awardedByPlayer.get(p.playerId) ?? 0n;
      if (add > 0n) {
        p.stackMojos += add;
        this.stacks.set(p.playerId, p.stackMojos);
      }
    }

    const potMojos = awardedByPlayer.get(primaryWinnerId) ?? 0n;
    this.lastHandResult = {
      handId: h.handId,
      winnerId: primaryWinnerId,
      potMojos,
      reason: "fold",
      board: [...h.board],
      shown: [],
      allInPlayerIds: h.players.filter((p) => p.allIn && !p.folded).map((p) => p.playerId),
      participants,
    };
    this.recordHandPlayed(h);
    h.potMojos = 0n;
    this.finishHand();
  }

  /**
   * Distribute the pot into main/side pots. Returns chips awarded per player and the headline winner.
   */
  private settleSidePots(
    h: TableHandState,
    live: PlayerHandState[],
    foldWin: boolean,
  ): { primaryWinnerId: PlayerId; awardedByPlayer: Map<PlayerId, bigint> } {
    const contributions = h.players.map((p) => ({
      playerId: p.playerId,
      totalBetHandMojos: p.totalBetHandMojos,
    }));
    const pots = buildSidePots(contributions);
    const awardedByPlayer = new Map<PlayerId, bigint>();
    const eligibleSet = (ids: PlayerId[]) => new Set(ids);

    for (const pot of pots) {
      const contenders = foldWin
        ? live.filter((p) => eligibleSet(pot.eligiblePlayerIds).has(p.playerId))
        : live.filter((p) => eligibleSet(pot.eligiblePlayerIds).has(p.playerId));

      let winners: PlayerHandState[];
      if (contenders.length === 0) {
        if (live.length === 1) {
          winners = live;
        } else {
          continue;
        }
      } else if (contenders.length === 1) {
        winners = contenders;
      } else if (foldWin) {
        winners = contenders;
      } else {
        winners = this.showdownWinnersForPot(contenders, h.board);
      }

      winners.sort((a, b) => a.seatIndex - b.seatIndex);
      const shares = splitPotEvenly(pot.amountMojos, winners.length);
      for (let i = 0; i < winners.length; i++) {
        const w = winners[i]!;
        const share = shares[i] ?? 0n;
        awardedByPlayer.set(w.playerId, (awardedByPlayer.get(w.playerId) ?? 0n) + share);
      }
    }

    let primaryWinnerId = live[0]!.playerId;
    if (!foldWin) {
      let best = live[0]!;
      let bestEval = evaluateBestHand([...best.holeCards, ...h.board]);
      for (const p of live.slice(1)) {
        const ev = evaluateBestHand([...p.holeCards, ...h.board]);
        if (compareHands(ev, bestEval) > 0) {
          best = p;
          bestEval = ev;
        }
      }
      primaryWinnerId = best.playerId;
    }

    const totalAwarded = [...awardedByPlayer.values()].reduce((a, b) => a + b, 0n);
    if (totalAwarded !== h.potMojos) {
      throw new Error(
        `Pot settlement mismatch: awarded ${totalAwarded} but pot was ${h.potMojos}`,
      );
    }

    return { primaryWinnerId, awardedByPlayer };
  }

  /**
   * Hole cards that actually went to showdown: not folded, and either contested
   * a bet / all-in or (on a check-down) the winning and losing hands.
   */
  private showdownHandsToReveal(
    h: TableHandState,
    live: PlayerHandState[],
    awardedByPlayer: Map<PlayerId, bigint>,
  ): ShownHand[] {
    const contestants = live.filter((p) => !p.folded && p.holeCards.length === 2);
    const bigBlind = this.config.bigBlindMojos;
    const putMoneyIn = contestants.filter(
      (p) => p.allIn || p.totalBetHandMojos > bigBlind,
    );
    const winners = contestants.filter((p) => (awardedByPlayer.get(p.playerId) ?? 0n) > 0n);
    const reveal = new Map<PlayerId, PlayerHandState>();
    for (const p of putMoneyIn) reveal.set(p.playerId, p);
    for (const p of winners) reveal.set(p.playerId, p);

    if (reveal.size < 2 && contestants.length >= 2) {
      const remaining = contestants.filter((p) => !reveal.has(p.playerId));
      remaining.sort((a, b) => {
        const evA = evaluateBestHand([...a.holeCards, ...h.board]);
        const evB = evaluateBestHand([...b.holeCards, ...h.board]);
        return compareHands(evB, evA);
      });
      const bestLoser = remaining[0];
      if (bestLoser) reveal.set(bestLoser.playerId, bestLoser);
      if (reveal.size < 2) {
        const winner = contestants.find((p) => p.playerId === winners[0]?.playerId) ?? contestants[0];
        if (winner) reveal.set(winner.playerId, winner);
      }
    }

    return [...reveal.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        playerId: p.playerId,
        holeCards: [...p.holeCards],
        category: evaluateBestHand([...p.holeCards, ...h.board]).category,
        allIn: p.allIn,
      }));
  }

  private showdownWinnersForPot(contenders: PlayerHandState[], board: Card[]): PlayerHandState[] {
    let bestEval = evaluateBestHand([...contenders[0]!.holeCards, ...board]);
    let winners: PlayerHandState[] = [contenders[0]!];
    for (const p of contenders.slice(1)) {
      const ev = evaluateBestHand([...p.holeCards, ...board]);
      const cmp = compareHands(ev, bestEval);
      if (cmp > 0) {
        bestEval = ev;
        winners = [p];
      } else if (cmp === 0) {
        winners.push(p);
      }
    }
    return winners;
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
      if (p && this.canPlayerAct(p)) {
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
