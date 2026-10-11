import {
  holeCardCountForVariant,
  isHousePlayerId,
  type HandId,
  type PlayerId,
  type PokerVariant,
  type StudStreet,
  type TableConfig,
} from "@dat-poker/shared";
import { standardDeck, type Card } from "./card.js";
import {
  compareHands,
  evaluateBestHand,
  type HandCategory,
} from "./hand-evaluator.js";
import { evaluateAceToFiveLow } from "./lowball-evaluator.js";
import {
  buildShuffleEntropy,
  createCommit,
  generateServerSeed,
  shuffleDeck,
  verifyCommit,
} from "./shuffle.js";
import { buildSidePots, splitPotEvenly } from "./side-pots.js";
import type { HandResult, PlayerAction } from "./nlhe-table.js";

export interface StudPlayerState {
  playerId: PlayerId;
  seatIndex: number;
  /** Down cards first, then up cards — length grows through the hand. */
  holeCards: Card[];
  /** Indices into holeCards that are face-up. */
  upCardIndexes: number[];
  stackMojos: bigint;
  betThisStreetMojos: bigint;
  totalBetHandMojos: bigint;
  folded: boolean;
  allIn: boolean;
  actedThisStreet: boolean;
}

export interface StudHandState {
  handId: HandId;
  tableId: string;
  street: StudStreet;
  board: Card[];
  potMojos: bigint;
  currentBetMojos: bigint;
  lastRaiseIncrementMojos: bigint;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actionSeat: number | null;
  players: StudPlayerState[];
  commitHash: string;
  serverSeed: string | null;
  playerSeeds: Record<PlayerId, string>;
  deck: Card[];
  deckIndex: number;
  seq: number;
}

const STUD_VARIANTS = new Set<PokerVariant>(["stud", "seven_card_stud", "razz"]);

export function isStudTableVariant(variant: PokerVariant): boolean {
  return STUD_VARIANTS.has(variant);
}

/**
 * Seven-card stud and Razz. Fixed-limit catalog; betting uses no-limit sizing
 * for cash playability (bring-in approximated by small blind).
 */
export class StudTableEngine {
  private config: TableConfig;
  private seats: Map<number, PlayerId> = new Map();
  private stacks: Map<PlayerId, bigint> = new Map();
  private handsPlayed: Map<PlayerId, number> = new Map();
  private hand: StudHandState | null = null;
  private lastHandResult: HandResult | null = null;
  private buttonSeat: number | null = null;
  private sittingOut = new Set<PlayerId>();

  constructor(config: TableConfig) {
    if (!isStudTableVariant(config.variant)) {
      throw new Error(`StudTableEngine does not support variant ${config.variant}`);
    }
    this.config = config;
  }

  seatPlayer(playerId: PlayerId, seatIndex: number, buyInMojos: bigint): void {
    if (seatIndex < 0 || seatIndex >= this.config.maxSeats) throw new Error("Invalid seat");
    if (this.seats.has(seatIndex)) throw new Error("Seat taken");
    if (buyInMojos < this.config.minBuyInMojos || buyInMojos > this.config.maxBuyInMojos) {
      throw new Error("Buy-in out of range");
    }
    this.seats.set(seatIndex, playerId);
    this.stacks.set(playerId, buyInMojos);
    this.sittingOut.delete(playerId);
    if (!this.handsPlayed.has(playerId)) this.handsPlayed.set(playerId, 0);
  }


  setSittingOut(playerId: PlayerId, sittingOut: boolean): void {
    if (!this.stacks.has(playerId)) throw new Error("Player not seated");
    if (sittingOut && this.hand) throw new Error("Cannot sit out voluntarily during an active hand");
    if (sittingOut) this.sittingOut.add(playerId);
    else this.sittingOut.delete(playerId);
  }

  isSittingOut(playerId: PlayerId): boolean {
    return this.sittingOut.has(playerId);
  }

  markTimedOutSittingOut(playerId: PlayerId): void {
    if (!this.stacks.has(playerId)) throw new Error("Player not seated");
    this.sittingOut.add(playerId);
  }

  rebuyStack(playerId: PlayerId, buyInMojos: bigint): void {
    if (this.hand) throw new Error("Cannot rebuy during an active hand");
    if (!this.stacks.has(playerId)) throw new Error("Player not seated");
    const stack = this.stacks.get(playerId) ?? 0n;
    if (stack > 0n) throw new Error("Rebuy is only available when your table stack is zero");
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
    if (this.hand) throw new Error("Wait for the current hand to finish before taking a house seat");
    if (this.hasPlayer(playerId)) throw new Error("Already seated");
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
    if (this.hand) throw new Error("Cannot restore a seat during an active hand");
    if (this.seats.has(seatIndex) && this.seats.get(seatIndex) !== playerId) {
      throw new Error("Seat taken");
    }
    this.seats.set(seatIndex, playerId);
    this.stacks.set(playerId, stackMojos);
    this.sittingOut.delete(playerId);
    if (!this.handsPlayed.has(playerId)) this.handsPlayed.set(playerId, 0);
  }

  setPlayerStack(playerId: PlayerId, stackMojos: bigint): void {
    if (!this.stacks.has(playerId)) throw new Error("Player not seated");
    this.stacks.set(playerId, stackMojos);
  }

  unseatBustedPlayers(): PlayerId[] {
    if (this.hand) throw new Error("Cannot unseat during an active hand");
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
    if (!this.stacks.has(playerId)) return null;
    if (this.hand) {
      const inHand = this.hand.players.find((p) => p.playerId === playerId);
      if (inHand) return inHand.stackMojos;
    }
    return this.stacks.get(playerId) ?? null;
  }

  getSeatedPlayers(): {
    playerId: PlayerId;
    seatIndex: number;
    stackMojos: bigint;
    sittingOut: boolean;
  }[] {
    return [...this.seats.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seatIndex, playerId]) => ({
        playerId,
        seatIndex,
        stackMojos: this.getPlayerStack(playerId) ?? 0n,
        sittingOut: this.sittingOut.has(playerId),
      }));
  }

  activeSeatedPlayers(): { playerId: PlayerId; seatIndex: number; stackMojos: bigint }[] {
    return this.getSeatedPlayers()
      .filter((s) => !s.sittingOut && s.stackMojos > 0n)
      .map(({ playerId, seatIndex, stackMojos }) => ({ playerId, seatIndex, stackMojos }));
  }

  cashOutPlayer(playerId: PlayerId): { stackMojos: bigint; seatIndex: number } {
    if (this.hand) throw new Error("Cannot cash out during an active hand");
    const stackMojos = this.stacks.get(playerId);
    if (stackMojos === undefined) throw new Error("Player not seated");
    let seatIndex: number | null = null;
    for (const [idx, seatedId] of this.seats) {
      if (seatedId === playerId) {
        seatIndex = idx;
        break;
      }
    }
    if (seatIndex === null) throw new Error("Player not seated");
    this.seats.delete(seatIndex);
    this.stacks.delete(playerId);
    this.sittingOut.delete(playerId);
    return { stackMojos, seatIndex };
  }

  debitStack(playerId: PlayerId, mojos: bigint): { remaining: bigint; seatIndex: number } {
    if (this.hand) throw new Error("Cannot cash out during an active hand");
    if (mojos <= 0n) throw new Error("Debit must be positive");
    const stackMojos = this.stacks.get(playerId);
    if (stackMojos === undefined) throw new Error("Player not seated");
    if (mojos > stackMojos) throw new Error("Insufficient stack");
    let seatIndex: number | null = null;
    for (const [idx, seatedId] of this.seats) {
      if (seatedId === playerId) {
        seatIndex = idx;
        break;
      }
    }
    if (seatIndex === null) throw new Error("Player not seated");
    const remaining = stackMojos - mojos;
    this.stacks.set(playerId, remaining);
    if (remaining === 0n) {
      this.cashOutPlayer(playerId);
      return { remaining: 0n, seatIndex };
    }
    return { remaining, seatIndex };
  }

  getHandsPlayed(playerId: PlayerId): number {
    return this.handsPlayed.get(playerId) ?? 0;
  }

  setHandsPlayed(playerId: PlayerId, n: number): void {
    this.handsPlayed.set(playerId, n);
  }

  getDealerButtonSeat(): number | null {
    return this.hand?.dealerSeat ?? this.buttonSeat;
  }

  startHand(handId: HandId): { commitHash: string } {
    const seated = this.activeSeatedPlayers().map((s) => [s.seatIndex, s.playerId] as const);
    if (seated.length < 2) throw new Error("Need at least 2 active players");
    if (this.hand) throw new Error("Hand already in progress");
    this.lastHandResult = null;
    const serverSeed = generateServerSeed();
    const { commitHash } = createCommit(serverSeed);
    const occupiedSeats = seated.map(([s]) => s);
    if (this.buttonSeat == null || !occupiedSeats.includes(this.buttonSeat)) {
      this.buttonSeat = occupiedSeats[0]!;
    }
    const dealerSeat = this.buttonSeat;
    const players: StudPlayerState[] = seated.map(([seatIndex, playerId]) => ({
      playerId,
      seatIndex,
      holeCards: [],
      upCardIndexes: [],
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
      street: "third",
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
    if (!h.players.some((p) => p.playerId === playerId)) throw new Error("Player not in hand");
    h.playerSeeds[playerId] = seed;
  }

  revealAndDeal(): void {
    const h = this.requireHand();
    if (!h.serverSeed) throw new Error("No server seed");
    if (!verifyCommit(h.serverSeed, h.commitHash)) throw new Error("Commit mismatch");
    const missing = h.players.map((p) => p.playerId).filter((id) => !h.playerSeeds[id]);
    if (missing.length > 0) throw new Error(`Missing player seeds: ${missing.join(",")}`);
    h.deck = shuffleDeck(h.deck, buildShuffleEntropy(h.serverSeed, h.playerSeeds));

    // Third street: 2 down + 1 up.
    for (const p of h.players) {
      p.holeCards = [this.draw(h), this.draw(h), this.draw(h)];
      p.upCardIndexes = [2];
    }

    // Bring-in: post small blind from the "worst" door card seat (simplified: UTG after dealer).
    this.postBringIn(h);
    h.seq++;
  }

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
        break;
      }
    }
  }

  applyAction(playerId: PlayerId, action: PlayerAction, amountMojos: bigint = 0n): void {
    const h = this.requireHand();
    const player = this.getPlayer(h, playerId);
    if (player.seatIndex !== h.actionSeat) throw new Error("Not this player's turn");
    if (player.folded || player.allIn) throw new Error("Player cannot act");
    if (action === "discard") throw new Error("No discarding in stud");

    const currentBetBefore = h.currentBetMojos;
    switch (action) {
      case "fold":
        player.folded = true;
        break;
      case "check":
        if (player.betThisStreetMojos < h.currentBetMojos) throw new Error("Cannot check facing a bet");
        break;
      case "call":
        this.charge(player, h, h.currentBetMojos - player.betThisStreetMojos);
        break;
      case "bet":
      case "raise": {
        if (amountMojos <= h.currentBetMojos) throw new Error("Raise must exceed current bet");
        const stackMax = player.betThisStreetMojos + player.stackMojos;
        let raiseTo = amountMojos > stackMax ? stackMax : amountMojos;
        const minRaiseTo = h.currentBetMojos + h.lastRaiseIncrementMojos;
        if (raiseTo < minRaiseTo && raiseTo < stackMax) {
          throw new Error("Raise must be at least the size of the last bet or raise");
        }
        this.charge(player, h, raiseTo - player.betThisStreetMojos);
        h.currentBetMojos = player.betThisStreetMojos;
        if (h.currentBetMojos > currentBetBefore) {
          const inc = h.currentBetMojos - currentBetBefore;
          if (inc >= h.lastRaiseIncrementMojos) h.lastRaiseIncrementMojos = inc;
        }
        break;
      }
      case "all-in": {
        this.charge(player, h, player.stackMojos);
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
    if (h.currentBetMojos > currentBetBefore) {
      for (const p of h.players) {
        if (p.playerId === player.playerId || p.folded || p.allIn) continue;
        p.actedThisStreet = false;
      }
    }
    h.seq++;
    if (this.activePlayers(h).length <= 1) {
      this.awardFoldWin(h);
      return;
    }
    if (this.bettingRoundComplete(h)) this.advanceStreet(h);
    else {
      try {
        h.actionSeat = this.firstActiveSeatClockwise(h, player.seatIndex);
      } catch {
        h.actionSeat = null;
      }
    }
  }

  applyDiscard(_playerId: PlayerId, _discardIndices: number[]): void {
    throw new Error("No discarding in stud");
  }

  getHandState(): StudHandState | null {
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

  private requireHand(): StudHandState {
    if (!this.hand) throw new Error("No active hand");
    return this.hand;
  }

  private draw(h: StudHandState): Card {
    const card = h.deck[h.deckIndex];
    if (!card) throw new Error("Deck exhausted");
    h.deckIndex++;
    return card;
  }

  private postBringIn(h: StudHandState): void {
    const seats = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
    const bringInSeat = this.nextSeat(seats, h.dealerSeat);
    const completer = this.nextSeat(seats, bringInSeat);
    const bi = this.playerAtSeat(h, bringInSeat)!;
    const cp = this.playerAtSeat(h, completer)!;
    h.smallBlindSeat = bringInSeat;
    h.bigBlindSeat = completer;
    this.charge(bi, h, this.config.smallBlindMojos);
    this.charge(cp, h, this.config.bigBlindMojos);
    h.currentBetMojos = cp.betThisStreetMojos;
    h.actionSeat = h.players.length === 2 ? bringInSeat : this.nextSeat(seats, completer);
  }

  private charge(player: StudPlayerState, h: StudHandState, amount: bigint): void {
    const pay = amount > player.stackMojos ? player.stackMojos : amount;
    player.stackMojos -= pay;
    player.betThisStreetMojos += pay;
    player.totalBetHandMojos += pay;
    h.potMojos += pay;
    if (player.stackMojos === 0n) player.allIn = true;
    this.stacks.set(player.playerId, player.stackMojos);
  }

  private getPlayer(h: StudHandState, playerId: PlayerId): StudPlayerState {
    const p = h.players.find((x) => x.playerId === playerId);
    if (!p) throw new Error("Player not in hand");
    return p;
  }

  private activePlayers(h: StudHandState): StudPlayerState[] {
    return h.players.filter((p) => !p.folded);
  }

  private canPlayerAct(p: StudPlayerState): boolean {
    return !p.folded && !p.allIn && p.stackMojos > 0n;
  }

  private bettingRoundComplete(h: StudHandState): boolean {
    const contenders = h.players.filter((p) => this.canPlayerAct(p));
    if (contenders.length === 0) return true;
    return contenders.every(
      (p) => p.betThisStreetMojos >= h.currentBetMojos && p.actedThisStreet,
    );
  }

  private advanceStreet(h: StudHandState): void {
    for (const p of h.players) {
      p.betThisStreetMojos = 0n;
      p.actedThisStreet = false;
    }
    h.currentBetMojos = 0n;
    h.lastRaiseIncrementMojos = this.config.bigBlindMojos;

    const order: StudStreet[] = ["third", "fourth", "fifth", "sixth", "seventh", "showdown"];
    const idx = order.indexOf(h.street);
    const next = order[idx + 1] ?? "showdown";
    if (next === "showdown") {
      this.runShowdown(h);
      return;
    }

    h.street = next;
    for (const p of this.activePlayers(h)) {
      if (next === "seventh") {
        // Final down card.
        p.holeCards.push(this.draw(h));
      } else {
        const upIdx = p.holeCards.length;
        p.holeCards.push(this.draw(h));
        p.upCardIndexes.push(upIdx);
      }
    }

    // Ensure we never exceed seven cards (catalog holeCards).
    const maxCards = holeCardCountForVariant(this.config.variant);
    for (const p of h.players) {
      if (p.holeCards.length > maxCards) {
        p.holeCards = p.holeCards.slice(0, maxCards);
      }
    }

    const canBet = h.players.filter((p) => this.canPlayerAct(p));
    if (canBet.length < 2) {
      if (next === "seventh") this.runShowdown(h);
      else this.advanceStreet(h);
      return;
    }
    h.actionSeat = this.firstActiveSeatClockwise(h, h.dealerSeat);
    h.seq++;
  }

  private runShowdown(h: StudHandState): void {
    h.street = "showdown";
    this.reconcile(h);
    const live = this.activePlayers(h);
    const awardedByPlayer = new Map<PlayerId, bigint>();
    const pots = buildSidePots(
      h.players.map((p) => ({ playerId: p.playerId, totalBetHandMojos: p.totalBetHandMojos })),
    );
    let isChop = false;
    for (const pot of pots) {
      const contenders = live.filter((p) => pot.eligiblePlayerIds.includes(p.playerId));
      if (contenders.length === 0) continue;
      const winners = this.winners(contenders);
      if (winners.length > 1) isChop = true;
      winners.sort((a, b) => a.seatIndex - b.seatIndex);
      const shares = splitPotEvenly(pot.amountMojos, winners.length);
      for (let i = 0; i < winners.length; i++) {
        const w = winners[i]!;
        awardedByPlayer.set(w.playerId, (awardedByPlayer.get(w.playerId) ?? 0n) + (shares[i] ?? 0n));
      }
    }
    for (const p of h.players) {
      const add = awardedByPlayer.get(p.playerId) ?? 0n;
      if (add > 0n) {
        p.stackMojos += add;
        this.stacks.set(p.playerId, p.stackMojos);
      }
    }
    const primary = this.winners(live)[0]!.playerId;
    this.lastHandResult = {
      handId: h.handId,
      winnerId: primary,
      potMojos: awardedByPlayer.get(primary) ?? 0n,
      totalPotMojos: [...awardedByPlayer.values()].reduce((a, b) => a + b, 0n),
      isChop,
      reason: "showdown",
      board: [],
      shown: live.map((p) => ({
        playerId: p.playerId,
        holeCards: [...p.holeCards],
        category: this.categoryFor(p),
        allIn: p.allIn,
      })),
      allInPlayerIds: live.filter((p) => p.allIn).map((p) => p.playerId),
      runoutFromBoardLen: null,
      participants: h.players.map((p) => ({
        playerId: p.playerId,
        totalBetHandMojos: p.totalBetHandMojos,
        stackBeforePayoutMojos: p.stackMojos - (awardedByPlayer.get(p.playerId) ?? 0n),
        awardedMojos: awardedByPlayer.get(p.playerId) ?? 0n,
      })),
      fairness:
        h.serverSeed && h.commitHash
          ? { commitHash: h.commitHash, serverSeed: h.serverSeed, playerSeeds: { ...h.playerSeeds } }
          : undefined,
    };
    for (const p of h.players) {
      this.handsPlayed.set(p.playerId, (this.handsPlayed.get(p.playerId) ?? 0) + 1);
    }
    h.potMojos = 0n;
    this.rotateButton();
    this.hand = null;
  }

  private awardFoldWin(h: StudHandState): void {
    this.reconcile(h);
    const winner = this.activePlayers(h)[0]!;
    const awarded = h.potMojos;
    winner.stackMojos += awarded;
    this.stacks.set(winner.playerId, winner.stackMojos);
    this.lastHandResult = {
      handId: h.handId,
      winnerId: winner.playerId,
      potMojos: awarded,
      totalPotMojos: awarded,
      isChop: false,
      reason: "fold",
      board: [],
      shown: [],
      allInPlayerIds: [],
      runoutFromBoardLen: null,
      participants: h.players.map((p) => ({
        playerId: p.playerId,
        totalBetHandMojos: p.totalBetHandMojos,
        stackBeforePayoutMojos: p.playerId === winner.playerId ? p.stackMojos - awarded : p.stackMojos,
        awardedMojos: p.playerId === winner.playerId ? awarded : 0n,
      })),
      fairness:
        h.serverSeed && h.commitHash
          ? { commitHash: h.commitHash, serverSeed: h.serverSeed, playerSeeds: { ...h.playerSeeds } }
          : undefined,
    };
    for (const p of h.players) {
      this.handsPlayed.set(p.playerId, (this.handsPlayed.get(p.playerId) ?? 0) + 1);
    }
    h.potMojos = 0n;
    this.rotateButton();
    this.hand = null;
  }

  private reconcile(h: StudHandState): void {
    const snapshot = h.players.map((p) => ({ player: p, bet: p.totalBetHandMojos }));
    for (const { player, bet } of snapshot) {
      if (bet <= 0n) continue;
      let maxOther = 0n;
      for (const other of snapshot) {
        if (other.player.playerId === player.playerId) continue;
        if (other.bet > maxOther) maxOther = other.bet;
      }
      const excess = bet - maxOther;
      if (excess <= 0n) continue;
      player.totalBetHandMojos = bet - excess;
      player.stackMojos += excess;
      h.potMojos -= excess;
      this.stacks.set(player.playerId, player.stackMojos);
    }
  }

  private winners(contenders: StudPlayerState[]): StudPlayerState[] {
    if (this.config.variant === "razz") {
      let bestScore: number | null = null;
      let winners: StudPlayerState[] = [];
      for (const p of contenders) {
        const ev = evaluateAceToFiveLow(p.holeCards);
        if (bestScore == null || ev.score < bestScore) {
          bestScore = ev.score;
          winners = [p];
        } else if (ev.score === bestScore) {
          winners.push(p);
        }
      }
      return winners;
    }
    let best = evaluateBestHand(contenders[0]!.holeCards);
    let winners: StudPlayerState[] = [contenders[0]!];
    for (const p of contenders.slice(1)) {
      const ev = evaluateBestHand(p.holeCards);
      const cmp = compareHands(ev, best);
      if (cmp > 0) {
        best = ev;
        winners = [p];
      } else if (cmp === 0) {
        winners.push(p);
      }
    }
    return winners;
  }

  private categoryFor(p: StudPlayerState): HandCategory {
    if (this.config.variant === "razz") return "high_card";
    return evaluateBestHand(p.holeCards).category;
  }

  private rotateButton(): void {
    const seats = [...this.seats.keys()].sort((a, b) => a - b);
    if (seats.length === 0) {
      this.buttonSeat = null;
      return;
    }
    const current = this.buttonSeat ?? seats[0]!;
    this.buttonSeat = this.nextSeat(seats, current);
  }

  private nextSeat(seats: number[], from: number): number {
    const max = this.config.maxSeats;
    let seat = from;
    for (let step = 0; step < max; step++) {
      seat = (seat + 1) % max;
      if (seats.includes(seat)) return seat;
    }
    throw new Error("No occupied seat");
  }

  private playerAtSeat(h: StudHandState, seatIndex: number): StudPlayerState | undefined {
    return h.players.find((p) => p.seatIndex === seatIndex);
  }

  private firstActiveSeatClockwise(h: StudHandState, fromSeat: number): number {
    const seats = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
    const max = this.config.maxSeats;
    let seat = fromSeat;
    for (let step = 0; step < max; step++) {
      seat = (seat + 1) % max;
      if (!seats.includes(seat)) continue;
      const p = this.playerAtSeat(h, seat);
      if (p && this.canPlayerAct(p)) return seat;
    }
    throw new Error("No active player");
  }
}
