import type { HandId, PlayerId, Street, TableConfig } from "@dat-poker/shared";
import { standardDeck, type Card } from "./card.js";
import { compareHands, evaluateBestHand } from "./hand-evaluator.js";
import {
  buildShuffleEntropy,
  createCommit,
  generateServerSeed,
  shuffleDeck,
  verifyCommit,
} from "./shuffle.js";

export type PlayerAction = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface HandPayout {
  playerId: PlayerId;
  amountMojos: bigint;
}

export interface HandResult {
  handId: HandId;
  winnerId: PlayerId;
  potMojos: bigint;
  reason: "fold" | "showdown";
  payouts?: HandPayout[];
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
  private lastDealerSeat: number | null = null;

  constructor(config: TableConfig) {
    this.config = { ...config };
  }

  getConfig(): TableConfig {
    return { ...this.config };
  }

  setBlinds(smallBlindMojos: bigint, bigBlindMojos: bigint): void {
    this.config = { ...this.config, smallBlindMojos, bigBlindMojos };
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

  emptySeats(): number[] {
    const taken = new Set(this.seats.keys());
    const open: number[] = [];
    for (let i = 0; i < this.config.maxSeats; i++) {
      if (!taken.has(i)) open.push(i);
    }
    return open;
  }

  cashOutPlayer(playerId: PlayerId): { stackMojos: bigint; seatIndex: number } {
    if (this.hand) {
      throw new Error("Cannot cash out during an active hand");
    }
    const stackMojos = this.stacks.get(playerId);
    if (stackMojos === undefined) {
      throw new Error("Player not seated");
    }
    const seatIndex = this.seatOf(playerId);
    this.seats.delete(seatIndex);
    this.stacks.delete(playerId);
    return { stackMojos, seatIndex };
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
  }

  setPlayerStack(playerId: PlayerId, stackMojos: bigint): void {
    if (this.hand) {
      throw new Error("Cannot set stack during an active hand");
    }
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
    for (const [seatIndex, playerId] of [...this.seats.entries()]) {
      if ((this.stacks.get(playerId) ?? 0n) <= 0n) {
        this.seats.delete(seatIndex);
        this.stacks.delete(playerId);
        busted.push(playerId);
      }
    }
    return busted;
  }

  startHand(handId: HandId): { commitHash: string } {
    if (this.hand) {
      throw new Error("Hand already in progress");
    }

    const seated = this.chipPlayers();
    if (seated.length < 2) {
      throw new Error("Need at least 2 players");
    }

    this.lastHandResult = null;
    const serverSeed = generateServerSeed();
    const { commitHash } = createCommit(serverSeed);
    const dealerSeat = this.nextDealerSeat(seated.map((p) => p.seatIndex));
    this.lastDealerSeat = dealerSeat;

    const players: PlayerHandState[] = seated.map((row) => ({
      playerId: row.playerId,
      seatIndex: row.seatIndex,
      holeCards: [],
      stackMojos: row.stackMojos,
      betThisStreetMojos: 0n,
      totalBetHandMojos: 0n,
      folded: false,
      allIn: row.stackMojos <= 0n,
      actedThisStreet: false,
    }));

    this.hand = {
      handId,
      tableId: this.config.id,
      street: "preflop",
      board: [],
      potMojos: 0n,
      currentBetMojos: 0n,
      dealerSeat,
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

    switch (action) {
      case "fold":
        player.folded = true;
        player.actedThisStreet = true;
        break;
      case "check":
        if (player.betThisStreetMojos < h.currentBetMojos) {
          throw new Error("Cannot check facing a bet");
        }
        player.actedThisStreet = true;
        break;
      case "call": {
        const toCall = h.currentBetMojos - player.betThisStreetMojos;
        this.charge(player, h, toCall);
        player.actedThisStreet = true;
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
        this.resetActsAfterAggression(h, player.playerId);
        player.actedThisStreet = true;
        break;
      }
      case "all-in": {
        const add = player.stackMojos;
        const previousBet = h.currentBetMojos;
        this.charge(player, h, add);
        player.allIn = true;
        player.actedThisStreet = true;
        if (player.betThisStreetMojos > previousBet) {
          h.currentBetMojos = player.betThisStreetMojos;
          this.resetActsAfterAggression(h, player.playerId);
          player.actedThisStreet = true;
        }
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    h.seq++;

    if (this.activePlayers(h).length <= 1) {
      this.awardToWinner(h);
      return;
    }

    if (this.bettingRoundComplete(h)) {
      this.advanceStreet(h);
    } else {
      this.advanceActionSeat(h, player.seatIndex);
    }
  }

  getHandState(): TableHandState | null {
    return this.hand ? structuredClone(this.hand) : null;
  }

  getLastHandResult(): HandResult | null {
    return this.lastHandResult ? structuredClone(this.lastHandResult) : null;
  }

  actorPlayerId(): PlayerId | null {
    const h = this.hand;
    if (!h || h.actionSeat === null) return null;
    return h.players.find((p) => p.seatIndex === h.actionSeat)?.playerId ?? null;
  }

  private requireHand(): TableHandState {
    if (!this.hand) throw new Error("No active hand");
    return this.hand;
  }

  private chipPlayers(): { playerId: PlayerId; seatIndex: number; stackMojos: bigint }[] {
    return this.getSeatedPlayers().filter((p) => p.stackMojos > 0n);
  }

  private seatOf(playerId: PlayerId): number {
    for (const [idx, seatedId] of this.seats) {
      if (seatedId === playerId) return idx;
    }
    throw new Error("Player not seated");
  }

  private nextDealerSeat(occupied: number[]): number {
    if (occupied.length === 0) {
      throw new Error("No occupied seats");
    }
    if (this.lastDealerSeat === null) {
      return occupied[0];
    }
    return nextSeatAfter(this.lastDealerSeat, occupied);
  }

  private draw(h: TableHandState): Card {
    const card = h.deck[h.deckIndex];
    if (!card) throw new Error("Deck exhausted");
    h.deckIndex++;
    return card;
  }

  private postBlinds(h: TableHandState): void {
    const occupied = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
    const { sbSeat, bbSeat, firstToAct } = blindSeats(h.dealerSeat, occupied);

    const sb = h.players.find((p) => p.seatIndex === sbSeat);
    const bb = h.players.find((p) => p.seatIndex === bbSeat);
    if (!sb || !bb) {
      throw new Error("Blind seats missing");
    }

    this.charge(sb, h, this.config.smallBlindMojos);
    this.charge(bb, h, this.config.bigBlindMojos);
    h.currentBetMojos = bb.betThisStreetMojos > sb.betThisStreetMojos ? bb.betThisStreetMojos : sb.betThisStreetMojos;
    h.actionSeat = firstToAct;
    this.skipUnactionable(h);
  }

  private charge(player: PlayerHandState, h: TableHandState, amount: bigint): void {
    const pay = amount > player.stackMojos ? player.stackMojos : amount;
    player.stackMojos -= pay;
    player.betThisStreetMojos += pay;
    player.totalBetHandMojos += pay;
    h.potMojos += pay;
    this.stacks.set(player.playerId, player.stackMojos);
    if (player.stackMojos === 0n) {
      player.allIn = true;
    }
  }

  private getPlayer(h: TableHandState, playerId: PlayerId): PlayerHandState {
    const p = h.players.find((x) => x.playerId === playerId);
    if (!p) throw new Error("Player not in hand");
    return p;
  }

  private activePlayers(h: TableHandState): PlayerHandState[] {
    return h.players.filter((p) => !p.folded);
  }

  private resetActsAfterAggression(h: TableHandState, aggressorId: PlayerId): void {
    for (const p of h.players) {
      if (p.playerId !== aggressorId && !p.folded && !p.allIn) {
        p.actedThisStreet = false;
      }
    }
  }

  private bettingRoundComplete(h: TableHandState): boolean {
    const contenders = h.players.filter((p) => !p.folded && !p.allIn);
    if (contenders.length === 0) return true;
    return contenders.every((p) => p.actedThisStreet && p.betThisStreetMojos === h.currentBetMojos);
  }

  private skipUnactionable(h: TableHandState): void {
    if (h.actionSeat === null) return;
    const start = h.actionSeat;
    for (let i = 0; i < h.players.length; i++) {
      const actor = h.players.find((p) => p.seatIndex === h.actionSeat);
      if (actor && !actor.folded && !actor.allIn) {
        return;
      }
      this.advanceActionSeat(h, h.actionSeat);
      if (h.actionSeat === start || h.actionSeat === null) {
        h.actionSeat = null;
        return;
      }
    }
  }

  private advanceActionSeat(h: TableHandState, fromSeat: number): void {
    const occupied = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
    let seat = fromSeat;
    for (let i = 0; i < occupied.length; i++) {
      seat = nextSeatAfter(seat, occupied);
      const next = h.players.find((p) => p.seatIndex === seat);
      if (next && !next.folded && !next.allIn) {
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

    if (this.activePlayers(h).length <= 1) {
      this.awardToWinner(h);
      return;
    }

    const actorsLeft = h.players.filter((p) => !p.folded && !p.allIn).length;
    if (actorsLeft <= 1) {
      this.advanceStreet(h);
      return;
    }

    const occupied = h.players.map((p) => p.seatIndex).sort((a, b) => a - b);
    h.actionSeat = nextSeatAfter(h.dealerSeat, occupied);
    this.skipUnactionable(h);
    if (h.actionSeat === null || this.bettingRoundComplete(h)) {
      this.advanceStreet(h);
      return;
    }
    h.seq++;
  }

  private runShowdown(h: TableHandState): void {
    h.street = "showdown";
    const pots = buildSidePots(h.players);
    const payouts: HandPayout[] = [];

    for (const pot of pots) {
      if (pot.eligible.length === 0 || pot.amountMojos <= 0n) continue;
      const winner = this.bestHand(pot.eligible, h.board);
      winner.stackMojos += pot.amountMojos;
      this.stacks.set(winner.playerId, winner.stackMojos);
      const existing = payouts.find((row) => row.playerId === winner.playerId);
      if (existing) {
        existing.amountMojos += pot.amountMojos;
      } else {
        payouts.push({ playerId: winner.playerId, amountMojos: pot.amountMojos });
      }
    }

    payouts.sort((a, b) => (a.amountMojos === b.amountMojos ? 0 : a.amountMojos > b.amountMojos ? -1 : 1));
    const top = payouts[0];
    this.lastHandResult = {
      handId: h.handId,
      winnerId: top?.playerId ?? this.activePlayers(h)[0].playerId,
      potMojos: h.potMojos,
      reason: "showdown",
      payouts,
    };
    h.potMojos = 0n;
    this.hand = null;
  }

  private bestHand(players: PlayerHandState[], board: Card[]): PlayerHandState {
    let best = players[0];
    let bestEval = evaluateBestHand([...best.holeCards, ...board]);
    for (const p of players.slice(1)) {
      const ev = evaluateBestHand([...p.holeCards, ...board]);
      if (compareHands(ev, bestEval) > 0) {
        best = p;
        bestEval = ev;
      }
    }
    return best;
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
      payouts: [{ playerId: winner.playerId, amountMojos: h.potMojos }],
    };
    h.potMojos = 0n;
    this.hand = null;
  }
}

export function nextSeatAfter(fromSeat: number, occupied: number[]): number {
  const after = occupied.filter((seat) => seat > fromSeat);
  return after[0] ?? occupied[0];
}

export function blindSeats(
  dealerSeat: number,
  occupied: number[],
): { sbSeat: number; bbSeat: number; firstToAct: number } {
  if (occupied.length < 2) {
    throw new Error("Need at least 2 occupied seats");
  }
  if (occupied.length === 2) {
    const sbSeat = dealerSeat;
    const bbSeat = nextSeatAfter(dealerSeat, occupied);
    return { sbSeat, bbSeat, firstToAct: sbSeat };
  }
  const sbSeat = nextSeatAfter(dealerSeat, occupied);
  const bbSeat = nextSeatAfter(sbSeat, occupied);
  return { sbSeat, bbSeat, firstToAct: nextSeatAfter(bbSeat, occupied) };
}

interface SidePot {
  amountMojos: bigint;
  eligible: PlayerHandState[];
}

export function buildSidePots(players: PlayerHandState[]): SidePot[] {
  const contrib = players
    .map((p) => p.totalBetHandMojos)
    .filter((n) => n > 0n)
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const levels = [...new Set(contrib)];
  const pots: SidePot[] = [];
  let prev = 0n;
  for (const level of levels) {
    const contributors = players.filter((p) => p.totalBetHandMojos >= level);
    const amountMojos = (level - prev) * BigInt(contributors.length);
    const eligible = contributors.filter((p) => !p.folded);
    pots.push({ amountMojos, eligible });
    prev = level;
  }
  return pots;
}
