import type { PlayerId, TableConfig } from "@dat-poker/shared";
import {
  DAT_SNG_DEFAULTS,
  defaultSngPayouts,
  houseSeatPlayerId,
  isHousePlayerId,
  sngPrizes,
  type HousePolicy,
  type SngBlindLevel,
  type SngPlacement,
  type SngPayoutShare,
  type SngStatus,
} from "@dat-poker/shared";
import { NlheTableEngine } from "./nlhe-table.js";

export interface SngOptions {
  buyInMojos?: bigint;
  startingStackMojos?: bigint;
  maxSeats?: number;
  fillHouse?: boolean;
  minHumansToStart?: number;
  housePolicy?: HousePolicy;
  handsPerLevel?: number;
  blindLevels?: SngBlindLevel[];
  payouts?: SngPayoutShare[];
}

export interface SngSnapshot {
  status: SngStatus;
  fillHouse: boolean;
  minHumansToStart: number;
  housePolicy: HousePolicy;
  maxSeats: number;
  buyInMojos: bigint;
  startingStackMojos: bigint;
  prizePoolMojos: bigint;
  handNumber: number;
  levelIndex: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  handsPerLevel: number;
  playersRemaining: number;
  placements: SngPlacement[];
}

export class SngTournament {
  readonly engine: NlheTableEngine;
  readonly fillHouse: boolean;
  readonly minHumansToStart: number;
  readonly housePolicy: HousePolicy;
  readonly maxSeats: number;
  readonly buyInMojos: bigint;
  readonly startingStackMojos: bigint;
  readonly prizePoolMojos: bigint;
  private readonly blindLevels: SngBlindLevel[];
  private readonly payoutShares: SngPayoutShare[];
  private readonly prizesByPlace: Map<number, bigint>;
  private readonly handsPerLevel: number;
  private status: SngStatus = "registering";
  private handNumber = 0;
  private levelIndex = 0;
  private placements: SngPlacement[] = [];

  constructor(engine: NlheTableEngine, options: SngOptions = {}) {
    this.engine = engine;
    this.maxSeats = options.maxSeats ?? DAT_SNG_DEFAULTS.maxSeats;
    this.buyInMojos = options.buyInMojos ?? DAT_SNG_DEFAULTS.buyInMojos;
    this.startingStackMojos = options.startingStackMojos ?? DAT_SNG_DEFAULTS.startingStackMojos;
    this.fillHouse = options.fillHouse ?? DAT_SNG_DEFAULTS.fillHouse;
    this.minHumansToStart = options.minHumansToStart ?? DAT_SNG_DEFAULTS.minHumansToStart;
    this.housePolicy = options.housePolicy ?? DAT_SNG_DEFAULTS.housePolicy;
    this.handsPerLevel = options.handsPerLevel ?? DAT_SNG_DEFAULTS.handsPerLevel;
    this.blindLevels = options.blindLevels ?? [...DAT_SNG_DEFAULTS.blindLevels];
    this.payoutShares = options.payouts ?? defaultSngPayouts(this.maxSeats);
    this.prizePoolMojos = this.buyInMojos * BigInt(this.maxSeats);
    this.prizesByPlace = sngPrizes(this.prizePoolMojos, this.payoutShares);
    const level = this.blindLevels[0];
    this.engine.setBlinds(level.smallBlindMojos, level.bigBlindMojos);
  }

  static create(tableId: string, options: SngOptions = {}): SngTournament {
    const maxSeats = options.maxSeats ?? DAT_SNG_DEFAULTS.maxSeats;
    const starting = options.startingStackMojos ?? DAT_SNG_DEFAULTS.startingStackMojos;
    const level = (options.blindLevels ?? DAT_SNG_DEFAULTS.blindLevels)[0];
    const config: TableConfig = {
      id: tableId,
      variant: "nlhe",
      format: "sng",
      maxSeats,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      minBuyInMojos: starting,
      maxBuyInMojos: starting,
      rakeBps: 0,
    };
    return new SngTournament(new NlheTableEngine(config), options);
  }

  fillHouseSeats(): string[] {
    const seated: string[] = [];
    for (const seatIndex of this.engine.emptySeats()) {
      const playerId = houseSeatPlayerId(seatIndex);
      this.engine.seatPlayer(playerId, seatIndex, this.startingStackMojos);
      seated.push(playerId);
    }
    return seated;
  }

  humanCount(): number {
    return this.engine.getSeatedPlayers().filter((p) => !isHousePlayerId(p.playerId)).length;
  }

  canStart(): boolean {
    if (this.status !== "registering") return false;
    if (this.engine.getActivePlayerCount() < this.maxSeats) return false;
    return this.humanCount() >= this.minHumansToStart;
  }

  start(): void {
    if (!this.canStart()) {
      throw new Error(
        `SNG not ready (need ${this.maxSeats} seats and ${this.minHumansToStart} human${this.minHumansToStart === 1 ? "" : "s"})`,
      );
    }
    this.status = "running";
    this.applyBlindLevel();
  }

  onHandStarted(): void {
    if (this.status !== "running") {
      throw new Error("SNG is not running");
    }
    this.handNumber += 1;
    const nextLevel = Math.min(
      this.blindLevels.length - 1,
      Math.floor((this.handNumber - 1) / this.handsPerLevel),
    );
    if (nextLevel !== this.levelIndex) {
      this.levelIndex = nextLevel;
      this.applyBlindLevel();
    }
  }

  afterHand(): SngSnapshot {
    if (this.engine.isHandInProgress()) {
      throw new Error("Hand still in progress");
    }
    const busted = this.engine.unseatBustedPlayers();
    this.recordEliminations(busted);

    const remaining = this.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n);
    if (remaining.length <= 1) {
      this.finishByStacks(remaining);
    } else if (this.humanCount() === 0) {
      this.finishByStacks(remaining);
    }

    return this.snapshot();
  }

  prizeFor(playerId: PlayerId): bigint | null {
    const row = this.placements.find((p) => p.playerId === playerId);
    if (row) return row.prizeMojos;
    if (this.status === "finished") return 0n;
    return null;
  }

  isAlive(playerId: PlayerId): boolean {
    return this.engine.getPlayerStack(playerId) !== null && this.prizeFor(playerId) === null;
  }

  getStatus(): SngStatus {
    return this.status;
  }

  snapshot(): SngSnapshot {
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[this.blindLevels.length - 1];
    return {
      status: this.status,
      fillHouse: this.fillHouse,
      minHumansToStart: this.minHumansToStart,
      housePolicy: this.housePolicy,
      maxSeats: this.maxSeats,
      buyInMojos: this.buyInMojos,
      startingStackMojos: this.startingStackMojos,
      prizePoolMojos: this.prizePoolMojos,
      handNumber: this.handNumber,
      levelIndex: this.levelIndex,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      handsPerLevel: this.handsPerLevel,
      playersRemaining: this.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
      placements: [...this.placements],
    };
  }

  private applyBlindLevel(): void {
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[this.blindLevels.length - 1];
    this.engine.setBlinds(level.smallBlindMojos, level.bigBlindMojos);
  }

  private recordEliminations(playerIds: PlayerId[]): void {
    const remaining = this.engine.getActivePlayerCount();
    const sorted = [...playerIds].sort((a, b) => a.localeCompare(b));
    let place = remaining + sorted.length;
    for (const playerId of sorted) {
      this.pushPlacement(playerId, place);
      place -= 1;
    }
  }

  private finishByStacks(
    remaining: { playerId: PlayerId; seatIndex: number; stackMojos: bigint }[],
  ): void {
    const ranked = [...remaining].sort((a, b) => {
      if (a.stackMojos === b.stackMojos) return a.seatIndex - b.seatIndex;
      return a.stackMojos > b.stackMojos ? -1 : 1;
    });
    ranked.forEach((row, index) => {
      this.pushPlacement(row.playerId, index + 1);
    });
    this.status = "finished";
  }

  private pushPlacement(playerId: PlayerId, place: number): void {
    if (this.placements.some((row) => row.playerId === playerId)) return;
    this.placements.push({
      playerId,
      place,
      prizeMojos: this.prizesByPlace.get(place) ?? 0n,
    });
    this.placements.sort((a, b) => a.place - b.place);
  }
}
