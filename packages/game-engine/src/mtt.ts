import { randomUUID } from "node:crypto";
import type { PlayerId, TableConfig } from "@dat-poker/shared";
import {
  DAT_MTT_DEFAULTS,
  assignSngItmPrizes,
  defaultSngPayouts,
  isHousePlayerId,
  mttHousePlayerId,
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
import type { SngSnapshot } from "./sng.js";

export interface MttOptions {
  buyInMojos?: bigint;
  startingStackMojos?: bigint;
  fillHouse?: boolean;
  minHumansToStart?: number;
  housePolicy?: HousePolicy;
  handsPerLevel?: number;
  levelDurationMs?: number;
  blindLevels?: SngBlindLevel[];
  payouts?: SngPayoutShare[];
}

interface MttTable {
  tableId: string;
  label: string;
  engine: NlheTableEngine;
  closed: boolean;
  isFinal: boolean;
}

export class MttEvent {
  readonly eventId: string;
  readonly buyInMojos: bigint;
  readonly startingStackMojos: bigint;
  readonly fillHouse: boolean;
  readonly minHumansToStart: number;
  readonly housePolicy: HousePolicy;
  readonly fieldSize = DAT_MTT_DEFAULTS.fieldSize;
  readonly startingTableSeats = DAT_MTT_DEFAULTS.startingTableSeats;
  readonly startingTableCount = DAT_MTT_DEFAULTS.startingTableCount;
  readonly finalTableSeats = DAT_MTT_DEFAULTS.finalTableSeats;
  private readonly blindLevels: SngBlindLevel[];
  private readonly payoutShares: SngPayoutShare[];
  private readonly humanEntrants = new Set<PlayerId>();
  private readonly handsPerLevel: number;
  private readonly levelDurationMs: number;
  private readonly tables: MttTable[] = [];
  private readonly relocations = new Map<string, string>();
  private readonly playerMoves = new Map<PlayerId, string>();
  private readonly pendingRegister: NlheTableEngine[] = [];
  private status: SngStatus = "registering";
  private handNumber = 0;
  private levelIndex = 0;
  private startedAtMs: number | null = null;
  private placements: SngPlacement[] = [];
  private paidPrizes = new Set<PlayerId>();
  private finalTableId: string | null = null;

  constructor(eventId: string, options: MttOptions = {}) {
    this.eventId = eventId;
    this.buyInMojos = options.buyInMojos ?? DAT_MTT_DEFAULTS.buyInMojos;
    this.startingStackMojos = options.startingStackMojos ?? DAT_MTT_DEFAULTS.startingStackMojos;
    this.fillHouse = options.fillHouse ?? DAT_MTT_DEFAULTS.fillHouse;
    this.minHumansToStart = options.minHumansToStart ?? DAT_MTT_DEFAULTS.minHumansToStart;
    this.housePolicy = options.housePolicy ?? DAT_MTT_DEFAULTS.housePolicy;
    this.handsPerLevel = options.handsPerLevel ?? DAT_MTT_DEFAULTS.handsPerLevel;
    this.levelDurationMs = options.levelDurationMs ?? DAT_MTT_DEFAULTS.levelDurationMs;
    this.blindLevels = options.blindLevels ?? [...DAT_MTT_DEFAULTS.blindLevels];
    this.payoutShares = options.payouts ?? defaultSngPayouts(this.fieldSize);
    for (let i = 0; i < this.startingTableCount; i += 1) {
      this.tables.push(this.makeTable(`Table ${i + 1}`, this.startingTableSeats, false));
    }
  }

  static create(options: MttOptions = {}): MttEvent {
    return new MttEvent(randomUUID(), options);
  }

  engines(): NlheTableEngine[] {
    return this.tables.map((row) => row.engine);
  }

  tableIds(): string[] {
    return this.tables.map((row) => row.tableId);
  }

  hasTable(tableId: string): boolean {
    return this.tables.some((row) => row.tableId === tableId);
  }

  engineFor(tableId: string): NlheTableEngine | undefined {
    return this.tables.find((row) => row.tableId === tableId)?.engine;
  }

  consumePendingTables(): NlheTableEngine[] {
    return this.pendingRegister.splice(0, this.pendingRegister.length);
  }

  relocatedTo(tableId: string, playerId?: PlayerId): string | null {
    const tableMove = this.relocations.get(tableId) ?? null;
    if (tableMove) return tableMove;
    if (!playerId) return null;
    const dest = this.playerMoves.get(playerId) ?? null;
    return dest && dest !== tableId ? dest : null;
  }

  shouldPauseDeals(tableId: string): boolean {
    if (this.status !== "running" || this.finalTableId) return false;
    this.requireTable(tableId);
    return this.needsFinalTable() || this.needsBalance();
  }

  get prizePoolMojos(): bigint {
    this.syncHumanEntrants();
    return this.buyInMojos * BigInt(this.humanEntrants.size);
  }

  fillHouseSeats(): string[] {
    const seated: string[] = [];
    for (const table of this.openTables()) {
      for (const seatIndex of table.engine.emptySeats()) {
        const playerId = mttHousePlayerId(table.tableId, seatIndex);
        table.engine.seatPlayer(playerId, seatIndex, this.startingStackMojos);
        seated.push(playerId);
      }
    }
    return seated;
  }

  claimHouseSeat(
    tableId: string,
    playerId: PlayerId,
    seatIndex?: number,
  ): { seatIndex: number; stackMojos: bigint; replacedPlayerId: PlayerId; tableId: string } {
    if (this.status === "finished") {
      throw new Error("SNG is finished");
    }
    const table = this.requireTable(tableId);
    if (table.closed) {
      throw new Error("That table has already moved to the final table");
    }
    const claimed = table.engine.claimHouseSeat(playerId, seatIndex);
    this.noteHumanEntrant(playerId);
    return { ...claimed, tableId };
  }

  firstOpenSeat(): { tableId: string; seatIndex: number } | null {
    for (const table of this.openTables()) {
      const seatIndex = table.engine.emptySeatIndex();
      if (seatIndex !== null) return { tableId: table.tableId, seatIndex };
    }
    return null;
  }

  firstHouseSeat(): { tableId: string; seatIndex: number } | null {
    for (const table of this.openTables()) {
      if (table.engine.isHandInProgress()) continue;
      const house = table.engine.houseSeats()[0];
      if (house) return { tableId: table.tableId, seatIndex: house.seatIndex };
    }
    return null;
  }

  seatPlayer(tableId: string, playerId: PlayerId, seatIndex: number): void {
    const table = this.requireTable(tableId);
    table.engine.seatPlayer(playerId, seatIndex, this.startingStackMojos);
    this.noteHumanEntrant(playerId);
  }

  humanCount(): number {
    return this.alivePlayers().filter((p) => !isHousePlayerId(p.playerId)).length;
  }

  canStart(): boolean {
    if (this.status !== "registering") return false;
    if (this.openTables().some((row) => row.engine.getActivePlayerCount() < this.startingTableSeats)) {
      return false;
    }
    return this.humanCount() >= this.minHumansToStart;
  }

  start(nowMs = Date.now()): void {
    if (!this.canStart()) {
      throw new Error(
        `16-player SNG not ready (need ${this.startingTableCount} tables of ${this.startingTableSeats} and ${this.minHumansToStart} human)`,
      );
    }
    this.status = "running";
    this.startedAtMs = nowMs;
    this.syncHumanEntrants();
    this.applyBlindLevel();
  }

  onHandStarted(tableId: string, nowMs = Date.now()): void {
    if (this.status !== "running") {
      throw new Error("SNG is not running");
    }
    this.requireTable(tableId);
    this.handNumber += 1;
    this.syncBlindClock(nowMs);
  }

  syncBlindClock(nowMs = Date.now()): void {
    if (this.status !== "running") return;
    const target = this.targetLevel(nowMs);
    if (target > this.levelIndex) {
      this.levelIndex = target;
    }
    this.applyBlindLevel();
    this.maintain();
  }

  afterHand(tableId: string, nowMs = Date.now()): SngSnapshot {
    const table = this.requireTable(tableId);
    if (table.engine.isHandInProgress()) {
      throw new Error("Hand still in progress");
    }
    if (!table.closed && this.status === "running") {
      const busted = table.engine.unseatBustedPlayers();
      this.recordEliminations(busted);
      this.maintain();
    }
    if (this.status === "finished") {
      this.assignHumanPrizes();
    }
    this.syncBlindClock(nowMs);
    return this.snapshot(tableId, nowMs);
  }

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

  getStatus(): SngStatus {
    return this.status;
  }

  private maintain(): void {
    this.tryFormFinalTable();
    this.tryBalanceTables();
    this.tryFinish();
  }

  private needsFinalTable(): boolean {
    if (this.finalTableId || this.status !== "running") return false;
    if (this.openTables().length < 2) return false;
    return this.alivePlayers().length <= this.finalTableSeats;
  }

  private needsBalance(): boolean {
    if (this.finalTableId || this.status !== "running") return false;
    const open = this.openTables();
    if (open.length < 2) return false;
    if (this.alivePlayers().length <= this.finalTableSeats) return false;
    const counts = open.map(
      (row) => row.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
    );
    return Math.max(...counts) - Math.min(...counts) >= 2;
  }

  private tryBalanceTables(): void {
    if (!this.needsBalance()) return;
    const open = this.openTables();
    if (open.some((row) => row.engine.isHandInProgress())) return;
    const ranked = open
      .map((table) => ({
        table,
        n: table.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
      }))
      .sort((a, b) => a.n - b.n);
    const short = ranked[0];
    const tall = ranked[ranked.length - 1];
    if (!short || !tall || tall.n - short.n < 2) return;
    const moveCount = Math.floor((tall.n - short.n) / 2);
    const movers = tall.table.engine
      .getSeatedPlayers()
      .filter((p) => p.stackMojos > 0n)
      .sort((a, b) => {
        if (a.stackMojos === b.stackMojos) return a.playerId.localeCompare(b.playerId);
        return a.stackMojos < b.stackMojos ? -1 : 1;
      })
      .slice(0, moveCount);
    for (const mover of movers) {
      const seatIndex = short.table.engine.emptySeatIndex();
      if (seatIndex == null) break;
      const handsPlayed = tall.table.engine.getHandsPlayed(mover.playerId);
      try {
        tall.table.engine.cashOutPlayer(mover.playerId);
      } catch {
        continue;
      }
      short.table.engine.restoreSeat(mover.playerId, seatIndex, mover.stackMojos);
      short.table.engine.setHandsPlayed(mover.playerId, handsPlayed);
      this.playerMoves.set(mover.playerId, short.table.tableId);
    }
  }

  snapshot(tableId: string, nowMs = Date.now(), viewerId?: PlayerId): SngSnapshot {
    const table = this.requireTable(tableId);
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[this.blindLevels.length - 1];
    const target = this.targetLevel(nowMs);
    const pending = this.status === "running" && target > this.levelIndex;
    const nextIndex = pending ? target : this.levelIndex + 1;
    const next = nextIndex < this.blindLevels.length ? this.blindLevels[nextIndex] : null;
    const open = this.openTables();
    return {
      status: this.status,
      fillHouse: this.fillHouse,
      minHumansToStart: this.minHumansToStart,
      housePolicy: this.housePolicy,
      maxSeats: table.engine.getMaxSeats(),
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
      blindsUpNextHand: pending && table.engine.isHandInProgress(),
      handsUntilNextLevel: sngHandsUntilNextLevel({
        handNumber: this.handNumber,
        levelIndex: this.levelIndex,
        handsPerLevel: this.handsPerLevel,
        levelCount: this.blindLevels.length,
      }),
      playersRemaining: table.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
      humanCount: this.humanCount(),
      houseSeatsAvailable: table.engine.houseSeats().length,
      placements: [...this.placements],
      kind: "mtt",
      eventId: this.eventId,
      tableLabel: table.isFinal ? "Final Table" : table.label,
      isFinalTable: table.isFinal,
      fieldSize: this.fieldSize,
      startingTableCount: this.startingTableCount,
      tableIndex: this.tables.findIndex((row) => row.tableId === tableId) + 1,
      tableCount: open.length,
      relocatedToTableId: this.relocatedTo(tableId, viewerId),
      eventPlayersRemaining: this.alivePlayers().length,
      otherTablePlayers: open
        .filter((row) => row.tableId !== tableId)
        .reduce(
          (sum, row) => sum + row.engine.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
          0,
        ),
      pauseDeals: this.shouldPauseDeals(tableId),
      pendingFinalTable: this.needsFinalTable(),
    };
  }

  private makeTable(label: string, maxSeats: number, isFinal: boolean): MttTable {
    const tableId = randomUUID();
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[0];
    const config: TableConfig = {
      id: tableId,
      variant: "nlhe",
      format: "mtt",
      maxSeats,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      minBuyInMojos: this.startingStackMojos,
      maxBuyInMojos: this.startingStackMojos,
      rakeBps: 0,
    };
    const engine = new NlheTableEngine(config);
    const row: MttTable = { tableId, label, engine, closed: false, isFinal };
    if (isFinal) {
      this.pendingRegister.push(engine);
    }
    return row;
  }

  private requireTable(tableId: string): MttTable {
    const table = this.tables.find((row) => row.tableId === tableId);
    if (!table) throw new Error("Table is not part of this event");
    return table;
  }

  private openTables(): MttTable[] {
    return this.tables.filter((row) => !row.closed);
  }

  private alivePlayers(): { playerId: PlayerId; stackMojos: bigint; tableId: string; handsPlayed: number }[] {
    const alive: { playerId: PlayerId; stackMojos: bigint; tableId: string; handsPlayed: number }[] = [];
    for (const table of this.openTables()) {
      for (const seated of table.engine.getSeatedPlayers()) {
        if (seated.stackMojos <= 0n) continue;
        alive.push({
          playerId: seated.playerId,
          stackMojos: seated.stackMojos,
          tableId: table.tableId,
          handsPlayed: table.engine.getHandsPlayed(seated.playerId),
        });
      }
    }
    return alive;
  }

  private tryFormFinalTable(): void {
    if (this.finalTableId || this.status !== "running") return;
    const alive = this.alivePlayers();
    if (alive.length > this.finalTableSeats) return;
    if (this.openTables().some((row) => row.engine.isHandInProgress())) return;

    const final = this.makeTable("Final Table", this.finalTableSeats, true);
    this.tables.push(final);
    this.finalTableId = final.tableId;

    alive
      .sort((a, b) => (a.stackMojos === b.stackMojos ? a.playerId.localeCompare(b.playerId) : a.stackMojos > b.stackMojos ? -1 : 1))
      .forEach((row, index) => {
        const from = this.requireTable(row.tableId);
        try {
          from.engine.cashOutPlayer(row.playerId);
        } catch {
          /* already standing */
        }
        final.engine.restoreSeat(row.playerId, index, row.stackMojos);
        final.engine.setHandsPlayed(row.playerId, row.handsPlayed);
        this.playerMoves.set(row.playerId, final.tableId);
      });

    for (const table of this.tables) {
      if (table.tableId === final.tableId) continue;
      table.closed = true;
      this.relocations.set(table.tableId, final.tableId);
      for (const seated of [...table.engine.getSeatedPlayers()]) {
        try {
          table.engine.cashOutPlayer(seated.playerId);
        } catch {
          /* already standing */
        }
      }
    }
    this.applyBlindLevel();
  }

  private tryFinish(): void {
    if (this.status !== "running") return;
    if (this.openTables().some((row) => row.engine.isHandInProgress())) return;
    const remaining = this.alivePlayers();
    const humansLeft = remaining.filter((p) => !isHousePlayerId(p.playerId)).length;
    if (remaining.length <= 1 || humansLeft === 0) {
      this.finishByStacks(remaining);
    }
  }

  private finishByStacks(
    remaining: { playerId: PlayerId; stackMojos: bigint }[],
  ): void {
    const ranked = [...remaining].sort((a, b) => {
      if (a.stackMojos === b.stackMojos) return a.playerId.localeCompare(b.playerId);
      return a.stackMojos > b.stackMojos ? -1 : 1;
    });
    ranked.forEach((row, index) => {
      this.pushPlacement(row.playerId, index + 1);
    });
    this.status = "finished";
    for (const table of this.openTables()) {
      for (const seated of [...table.engine.getSeatedPlayers()]) {
        try {
          table.engine.cashOutPlayer(seated.playerId);
        } catch {
          /* already standing */
        }
      }
    }
  }

  private recordEliminations(playerIds: PlayerId[]): void {
    const remaining = this.alivePlayers().length;
    const sorted = [...playerIds].sort((a, b) => a.localeCompare(b));
    let place = remaining + sorted.length;
    for (const playerId of sorted) {
      this.pushPlacement(playerId, place);
      place -= 1;
    }
  }

  private pushPlacement(playerId: PlayerId, place: number): void {
    if (this.placements.some((row) => row.playerId === playerId)) return;
    this.placements.push({ playerId, place, prizeMojos: 0n });
    this.placements.sort((a, b) => a.place - b.place);
  }

  private assignHumanPrizes(): void {
    this.placements = assignSngItmPrizes(this.placements, this.prizePoolMojos, this.payoutShares);
  }

  private applyBlindLevel(): void {
    const level = this.blindLevels[this.levelIndex] ?? this.blindLevels[this.blindLevels.length - 1];
    for (const table of this.openTables()) {
      if (table.engine.isHandInProgress()) continue;
      table.engine.setBlinds(level.smallBlindMojos, level.bigBlindMojos);
    }
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
    for (const table of this.tables) {
      for (const seated of table.engine.getSeatedPlayers()) {
        this.noteHumanEntrant(seated.playerId);
      }
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
}
