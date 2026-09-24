import type { PlayerId, TableConfig } from "@dat-poker/shared";
import {
  DAT_SNG_DEFAULTS,
  assignSngItmPrizes,
  defaultSngPayouts,
  houseSeatPlayerId,
  isHousePlayerId,
  sngHandsUntilNextLevel,
  sngNextLevelAtMs,
  sngPrizes,
  sngTargetBlindLevel,
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
  levelDurationMs?: number;
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
  payouts: Array<SngPayoutShare & { prizeMojos: bigint }>;
  handNumber: number;
  levelIndex: number;
  levelCount: number;
  smallBlindMojos: bigint;
  bigBlindMojos: bigint;
  nextSmallBlindMojos: bigint | null;
  nextBigBlindMojos: bigint | null;
  handsPerLevel: number;
  levelDurationMs: number;
  startedAtMs: number | null;
  nextLevelAtMs: number | null;
  blindsUpNextHand: boolean;
  handsUntilNextLevel: number | null;
  playersRemaining: number;
  humanCount: number;
  houseSeatsAvailable: number;
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
  private readonly blindLevels: SngBlindLevel[];
  private readonly payoutShares: SngPayoutShare[];
  private readonly humanEntrants = new Set<PlayerId>();
  private readonly handsPerLevel: number;
  private readonly levelDurationMs: number;
  private status: SngStatus = "registering";
  private handNumber = 0;
  private levelIndex = 0;
  private startedAtMs: number | null = null;
  private placements: SngPlacement[] = [];
  private paidPrizes = new Set<PlayerId>();

  constructor(engine: NlheTableEngine, options: SngOptions = {}) {
    this.engine = engine;
    this.maxSeats = options.maxSeats ?? DAT_SNG_DEFAULTS.maxSeats;
    this.buyInMojos = options.buyInMojos ?? DAT_SNG_DEFAULTS.buyInMojos;
    this.startingStackMojos = options.startingStackMojos ?? DAT_SNG_DEFAULTS.startingStackMojos;
    this.fillHouse = options.fillHouse ?? DAT_SNG_DEFAULTS.fillHouse;
    this.minHumansToStart = options.minHumansToStart ?? DAT_SNG_DEFAULTS.minHumansToStart;
    this.housePolicy = options.housePolicy ?? DAT_SNG_DEFAULTS.housePolicy;
    this.handsPerLevel = options.handsPerLevel ?? DAT_SNG_DEFAULTS.handsPerLevel;
    this.levelDurationMs = options.levelDurationMs ?? DAT_SNG_DEFAULTS.levelDurationMs;
    this.blindLevels = options.blindLevels ?? [...DAT_SNG_DEFAULTS.blindLevels];
    this.payoutShares = options.payouts ?? defaultSngPayouts(this.maxSeats);
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

  claimHouseSeat(
    playerId: PlayerId,
    seatIndex?: number,
  ): { seatIndex: number; stackMojos: bigint; replacedPlayerId: PlayerId } {
    if (this.status === "finished") {
      throw new Error("SNG is finished");
    }
    const claimed = this.engine.claimHouseSeat(playerId, seatIndex);
    this.noteHumanEntrant(playerId);
    return claimed;
  }

  get prizePoolMojos(): bigint {
    this.syncHumanEntrants();
    return this.buyInMojos * BigInt(this.humanEntrants.size);
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

  start(nowMs = Date.now()): void {
    if (!this.canStart()) {
      throw new Error(
        `SNG not ready (need ${this.maxSeats} seats and ${this.minHumansToStart} human${this.minHumansToStart === 1 ? "" : "s"})`,
      );
    }
    this.status = "running";
    this.startedAtMs = nowMs;
    this.syncHumanEntrants();
    this.applyBlindLevel();
  }

  onHandStarted(nowMs = Date.now()): void {
    if (this.status !== "running") {
      throw new Error("SNG is not running");
    }
    this.handNumber += 1;
    this.syncBlindClock(nowMs);
  }

  /**
   * Move blinds to the clock/hand target. Does not change stakes mid-hand;
   * the next deal picks up the pending level.
   */
  syncBlindClock(nowMs = Date.now()): SngSnapshot {
    if (this.status === "running" && !this.engine.isHandInProgress()) {
      const target = this.targetLevel(nowMs);
      if (target > this.levelIndex) {
        this.levelIndex = target;
        this.applyBlindLevel();
      }
    }
    return this.snapshot(nowMs);
  }

  afterHand(): SngSnapshot {
    if (this.engine.isHandInProgress()) {
      throw new Error("Hand still in progress");
    }
    const busted = this.engine.unseatBustedPlayers();
    this.recordEliminations(busted);

    const remaining = this.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n);
    const humansLeft = remaining.filter((p) => !isHousePlayerId(p.playerId)).length;
    if (remaining.length <= 1 || humansLeft === 0) {
      this.finishByStacks(remaining);
    }
    if (this.status === "finished") {
      this.assignHumanPrizes();
    }

    return this.syncBlindClock();
  }

  /** Human prize rows that have not been credited to an account yet. */
  unpaidHumanPrizes(): SngPlacement[] {
    return this.placements.filter(
      (row) =>
        !isHousePlayerId(row.playerId) && row.prizeMojos > 0n && !this.paidPrizes.has(row.playerId),
    );
  }

  markPrizePaid(playerId: PlayerId): void {
    this.paidPrizes.add(playerId);
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

  snapshot(nowMs = Date.now()): SngSnapshot {
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[this.blindLevels.length - 1];
    const target = this.targetLevel(nowMs);
    const pending = this.status === "running" && target > this.levelIndex;
    const nextIndex = pending ? target : this.levelIndex + 1;
    const next = nextIndex < this.blindLevels.length ? this.blindLevels[nextIndex] : null;
    return {
      status: this.status,
      fillHouse: this.fillHouse,
      minHumansToStart: this.minHumansToStart,
      housePolicy: this.housePolicy,
      maxSeats: this.maxSeats,
      buyInMojos: this.buyInMojos,
      startingStackMojos: this.startingStackMojos,
      prizePoolMojos: this.prizePoolMojos,
      payouts: this.payoutPreview(),
      handNumber: this.handNumber,
      levelIndex: this.levelIndex,
      levelCount: this.blindLevels.length,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      nextSmallBlindMojos: next?.smallBlindMojos ?? null,
      nextBigBlindMojos: next?.bigBlindMojos ?? null,
      handsPerLevel: this.handsPerLevel,
      levelDurationMs: this.levelDurationMs,
      startedAtMs: this.startedAtMs,
      nextLevelAtMs: sngNextLevelAtMs({
        startedAtMs: this.startedAtMs,
        levelIndex: this.levelIndex,
        levelDurationMs: this.levelDurationMs,
        levelCount: this.blindLevels.length,
      }),
      blindsUpNextHand: pending && this.engine.isHandInProgress(),
      handsUntilNextLevel: sngHandsUntilNextLevel({
        handNumber: this.handNumber,
        levelIndex: this.levelIndex,
        handsPerLevel: this.handsPerLevel,
        levelCount: this.blindLevels.length,
      }),
      playersRemaining: this.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
      humanCount: this.humanCount(),
      houseSeatsAvailable: this.engine.houseSeats().length,
      placements: [...this.placements],
    };
  }

  private targetLevel(nowMs: number): number {
    return sngTargetBlindLevel({
      nowMs,
      startedAtMs: this.startedAtMs,
      handNumber: this.handNumber,
      levelDurationMs: this.levelDurationMs,
      handsPerLevel: this.handsPerLevel,
      levelCount: this.blindLevels.length,
    });
  }

  private syncHumanEntrants(): void {
    for (const seated of this.engine.getSeatedPlayers()) {
      this.noteHumanEntrant(seated.playerId);
    }
  }

  private noteHumanEntrant(playerId: PlayerId): void {
    if (!isHousePlayerId(playerId)) {
      this.humanEntrants.add(playerId);
    }
  }

  private payoutPreview(): Array<SngPayoutShare & { prizeMojos: bigint }> {
    const prizes = sngPrizes(this.prizePoolMojos, this.payoutShares);
    return this.payoutShares.map((row) => ({
      ...row,
      prizeMojos: prizes.get(row.place) ?? 0n,
    }));
  }

  private assignHumanPrizes(): void {
    this.placements = assignSngItmPrizes(this.placements, this.prizePoolMojos, this.payoutShares);
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
    this.clearRemainingSeats();
  }

  private clearRemainingSeats(): void {
    for (const seated of [...this.engine.getSeatedPlayers()]) {
      try {
        this.engine.cashOutPlayer(seated.playerId);
      } catch {
        /* already standing */
      }
    }
  }

  private pushPlacement(playerId: PlayerId, place: number): void {
    if (this.placements.some((row) => row.playerId === playerId)) return;
    this.placements.push({
      playerId,
      place,
      prizeMojos: 0n,
    });
    this.placements.sort((a, b) => a.place - b.place);
  }
}
