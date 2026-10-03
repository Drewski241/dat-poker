import { randomUUID } from "node:crypto";
import type {
  BlindLevel,
  PlayerId,
  SeatMove,
  TableId,
  TournamentConfig,
  TournamentPlayerSnapshot,
  TournamentPlayerStatus,
  TournamentSnapshot,
  TournamentStatus,
  TournamentSummary,
  TournamentTableSnapshot,
} from "@dat-poker/shared";
import type { TableConfig } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import {
  rebalanceTables,
  type BalancerPlayer,
  type BalancerTable,
} from "./balancer.js";
import { assignPlayersToTables, nextOpenSeat, tablesNeeded } from "./seating.js";
import { defaultMttBlindLevels, defaultSngBlindLevels } from "./blinds.js";
import {
  buildPrizePool,
  prizeForPlace,
  type PayoutPlace,
  type PrizePoolBreakdown,
} from "./payouts.js";
import { computeIcm, type IcmResult } from "./icm.js";
import {
  HandForHandController,
  shouldHandForHand,
  type HandForHandReason,
} from "./hand-for-hand.js";

interface InternalPlayer {
  playerId: PlayerId;
  status: TournamentPlayerStatus;
  stackMojos: bigint;
  tableId: TableId | null;
  seatIndex: number | null;
  finishPosition: number | null;
  prizeMojos: bigint;
  entriesUsed: number;
  reentriesUsed: number;
  eliminatedAt: number | null;
}

interface InternalTable {
  tableId: TableId;
  closed: boolean;
  isFinalTable: boolean;
  seats: Map<number, PlayerId>;
  engine: NlheTableEngine | null;
}

export interface CreateTournamentInput {
  name: string;
  format?: "sng" | "mtt";
  maxSeats?: number;
  maxEntries?: number | null;
  minEntries?: number;
  buyInMojos?: bigint;
  startingStackMojos?: bigint;
  blindLevels?: BlindLevel[];
  feeBps?: number;
  lateRegThroughLevel?: number;
  reentryAllowed?: boolean;
  maxReentries?: number;
  id?: string;
}

export interface EliminateResult {
  playerId: PlayerId;
  finishPosition: number | null;
  prizeMojos: bigint;
  canReenter: boolean;
  moves: SeatMove[];
  status: TournamentStatus;
  winnerId: PlayerId | null;
  handForHand: HandForHandReason;
}

export interface StartResult {
  moves: SeatMove[];
  tableCount: number;
  status: TournamentStatus;
  movesTruncated: boolean;
  prizePool: PrizePoolBreakdown;
}

export interface RegisterResult {
  playerId: PlayerId;
  entriesUsed: number;
  seated: boolean;
  seat: { tableId: TableId; seatIndex: number } | null;
  lateReg: boolean;
}

export interface SnapshotOptions {
  detail?: boolean;
}

const DEFAULT_BUY_IN = 10_000n;
const DEFAULT_STARTING_STACK = 1_500_000n;
const INITIAL_MOVE_DETAIL_CAP = 2_000;
const FULL_DETAIL_PLAYER_CAP = 5_000;

export class TournamentEngine {
  private readonly config: TournamentConfig;
  private status: TournamentStatus = "registering";
  private players = new Map<PlayerId, InternalPlayer>();
  private tables: InternalTable[] = [];
  private tablesById = new Map<TableId, InternalTable>();
  private currentLevel = 0;
  private winnerId: PlayerId | null = null;
  private activeCount = 0;
  private eliminatedCount = 0;
  /** Buy-ins collected (includes re-entries). */
  private totalEntriesPaid = 0;
  private payoutLadder: PayoutPlace[] = [];
  private prizePoolMojos = 0n;
  private paidPlaces = 0;
  private eliminationSeq = 0;
  private readonly h4h = new HandForHandController();

  constructor(input: CreateTournamentInput) {
    const format = input.format ?? "mtt";
    const maxSeats = input.maxSeats ?? 8;
    if (maxSeats < 2 || maxSeats > 10) {
      throw new Error("maxSeats must be between 2 and 10");
    }

    let maxEntries: number | null;
    if (format === "sng") {
      maxEntries = input.maxEntries ?? maxSeats;
      if (maxEntries === null) {
        throw new Error("SNG maxEntries cannot be unlimited");
      }
      if (maxEntries > maxSeats) {
        throw new Error("SNG maxEntries cannot exceed maxSeats");
      }
    } else {
      maxEntries = input.maxEntries === undefined ? null : input.maxEntries;
      if (maxEntries !== null && maxEntries < 2) {
        throw new Error("MTT maxEntries must be at least 2, or null for unlimited");
      }
    }

    const minEntries = input.minEntries ?? (format === "sng" ? maxSeats : 2);
    if (maxEntries !== null && minEntries > maxEntries) {
      throw new Error("minEntries cannot exceed maxEntries");
    }

    const feeBps = input.feeBps ?? 500;
    const lateRegThroughLevel =
      input.lateRegThroughLevel ?? (format === "sng" ? -1 : 3);
    const reentryAllowed = input.reentryAllowed ?? format === "mtt";
    const maxReentries = input.maxReentries ?? (reentryAllowed ? 1 : 0);

    const buyInMojos = input.buyInMojos ?? DEFAULT_BUY_IN;
    const startingStackMojos = input.startingStackMojos ?? DEFAULT_STARTING_STACK;
    const blindLevels =
      input.blindLevels ??
      (format === "sng" ? defaultSngBlindLevels() : defaultMttBlindLevels());

    if (blindLevels.length === 0) {
      throw new Error("At least one blind level is required");
    }

    this.config = {
      id: input.id ?? randomUUID(),
      name: input.name,
      format,
      variant: "nlhe",
      maxSeats,
      maxEntries,
      minEntries,
      buyInMojos,
      startingStackMojos,
      blindLevels,
      feeBps,
      lateRegThroughLevel,
      reentryAllowed,
      maxReentries,
    };
  }

  getId(): string {
    return this.config.id;
  }

  getConfig(): TournamentConfig {
    return { ...this.config, blindLevels: [...this.config.blindLevels] };
  }

  getStatus(): TournamentStatus {
    return this.status;
  }

  isRegistrationUnlimited(): boolean {
    return this.config.maxEntries === null;
  }

  isLateRegOpen(): boolean {
    if (this.status === "registering") return true;
    if (this.status !== "running" && this.status !== "final_table") return false;
    if (this.config.lateRegThroughLevel < 0) return false;
    return this.currentLevel <= this.config.lateRegThroughLevel;
  }

  getPrizePoolMojos(): bigint {
    return this.prizePoolMojos;
  }

  getPayoutLadder(): PayoutPlace[] {
    return [...this.payoutLadder];
  }

  registerPlayer(playerId: PlayerId): RegisterResult {
    if (this.status === "registering") {
      return this.registerPreStart(playerId);
    }
    if (this.isLateRegOpen()) {
      return this.registerLate(playerId);
    }
    throw new Error("Registration is closed");
  }

  registerPlayers(playerIds: readonly PlayerId[]): void {
    for (const id of playerIds) {
      this.registerPlayer(id);
    }
  }

  /** Buy back in after a bust while late reg is open. */
  reenter(playerId: PlayerId): RegisterResult {
    if (!this.isLateRegOpen()) {
      throw new Error("Late registration is closed");
    }
    if (!this.config.reentryAllowed) {
      throw new Error("Re-entries are not allowed");
    }
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error("Player never registered");
    }
    if (player.status === "active" || player.status === "waiting_seat") {
      throw new Error("Player is already in the tournament");
    }
    if (player.reentriesUsed >= this.config.maxReentries) {
      throw new Error("No re-entries remaining");
    }
    if (
      this.config.maxEntries !== null &&
      this.totalEntriesPaid >= this.config.maxEntries
    ) {
      throw new Error("Tournament is full");
    }

    player.reentriesUsed += 1;
    player.entriesUsed += 1;
    player.status = "waiting_seat";
    player.stackMojos = this.config.startingStackMojos;
    player.finishPosition = null;
    player.prizeMojos = 0n;
    player.eliminatedAt = null;
    this.totalEntriesPaid += 1;
    this.rebuildPrizePool();

    const seat = this.seatNewEntrant(playerId, "reentry");
    return {
      playerId,
      entriesUsed: player.entriesUsed,
      seated: seat !== null,
      seat,
      lateReg: true,
    };
  }

  getRegisteredCount(): number {
    return this.players.size;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getTotalEntriesPaid(): number {
    return this.totalEntriesPaid;
  }

  start(): StartResult {
    if (this.status !== "registering") {
      throw new Error("Tournament already started");
    }
    if (this.players.size < this.config.minEntries) {
      throw new Error(
        `Need at least ${this.config.minEntries} players to start (have ${this.players.size})`,
      );
    }

    this.status = "seating";
    const playerIds = [...this.players.keys()];
    const tableCount = tablesNeeded(playerIds.length, this.config.maxSeats);
    const groups = assignPlayersToTables(playerIds, tableCount, this.config.maxSeats);
    const recordMoves = playerIds.length <= INITIAL_MOVE_DETAIL_CAP;
    const moves: SeatMove[] = [];

    this.tables = [];
    this.tablesById.clear();

    for (const group of groups) {
      const tableId = randomUUID();
      const seats = new Map<number, PlayerId>();

      group.forEach((playerId, seatIndex) => {
        seats.set(seatIndex, playerId);
        const player = this.players.get(playerId)!;
        player.status = "active";
        player.tableId = tableId;
        player.seatIndex = seatIndex;
        player.stackMojos = this.config.startingStackMojos;
        if (recordMoves) {
          moves.push({
            playerId,
            from: null,
            to: { tableId, seatIndex },
            reason: "initial_seat",
          });
        }
      });

      const table: InternalTable = {
        tableId,
        closed: false,
        isFinalTable: tableCount === 1,
        seats,
        engine: null,
      };
      this.tables.push(table);
      this.tablesById.set(tableId, table);
    }

    this.activeCount = playerIds.length;
    this.eliminatedCount = 0;
    this.rebuildPrizePool();
    this.status = tableCount === 1 ? "final_table" : "running";
    this.refreshHandForHand();

    return {
      moves,
      tableCount,
      status: this.status,
      movesTruncated: !recordMoves,
      prizePool: buildPrizePool({
        entries: this.totalEntriesPaid,
        buyInMojos: this.config.buyInMojos,
        feeBps: this.config.feeBps,
      }),
    };
  }

  eliminatePlayer(playerId: PlayerId): EliminateResult {
    if (this.status !== "running" && this.status !== "final_table") {
      throw new Error("Tournament is not running");
    }
    const player = this.players.get(playerId);
    if (!player || player.status !== "active") {
      throw new Error("Player is not active in this tournament");
    }

    const from =
      player.tableId !== null && player.seatIndex !== null
        ? { tableId: player.tableId, seatIndex: player.seatIndex }
        : null;

    const table = player.tableId ? this.tablesById.get(player.tableId) : undefined;
    if (table) {
      if (player.seatIndex !== null) {
        table.seats.delete(player.seatIndex);
      }
      if (table.engine && !table.engine.isHandInProgress()) {
        try {
          table.engine.cashOutPlayer(playerId);
        } catch {
          // already unseated
        }
      }
    }

    this.activeCount -= 1;
    this.eliminatedCount += 1;
    this.eliminationSeq += 1;
    player.eliminatedAt = this.eliminationSeq;
    player.tableId = null;
    player.seatIndex = null;
    player.stackMojos = 0n;
    player.status = "eliminated";

    const canReenter =
      this.isLateRegOpen() &&
      this.config.reentryAllowed &&
      player.reentriesUsed < this.config.maxReentries &&
      (this.config.maxEntries === null ||
        this.totalEntriesPaid < this.config.maxEntries);

    let finishPosition: number | null = null;
    let prizeMojos = 0n;

    if (!canReenter) {
      finishPosition = this.assignFinishPosition(player);
      prizeMojos = player.prizeMojos;
    }

    const elimMove: SeatMove = {
      playerId,
      from,
      to: null,
      reason: "elimination",
    };

    if (this.activeCount <= 1 && !this.isLateRegOpen()) {
      return this.finishTournament(playerId, finishPosition, prizeMojos, elimMove);
    }

    // If only one active but late reg still open, keep running
    if (this.activeCount <= 1 && this.isLateRegOpen()) {
      this.refreshHandForHand();
      return {
        playerId,
        finishPosition,
        prizeMojos,
        canReenter,
        moves: [elimMove],
        status: this.status,
        winnerId: null,
        handForHand: this.h4h.getReason(),
      };
    }

    const balance = this.applyRebalance(this.activePlayersInternal());
    this.refreshHandForHand();

    return {
      playerId,
      finishPosition,
      prizeMojos,
      canReenter,
      moves: [elimMove, ...balance.moves],
      status: this.status,
      winnerId: null,
      handForHand: this.h4h.getReason(),
    };
  }

  syncEliminationsFromStacks(): EliminateResult[] {
    const results: EliminateResult[] = [];
    for (const table of this.tables) {
      if (table.closed || !table.engine) continue;
      if (table.engine.isHandInProgress()) continue;
      for (const seated of table.engine.getSeatedPlayers()) {
        const player = this.players.get(seated.playerId);
        if (!player || player.status !== "active") continue;
        player.stackMojos = seated.stackMojos;
        if (seated.stackMojos === 0n) {
          results.push(this.eliminatePlayer(seated.playerId));
        }
      }
    }
    return results;
  }

  advanceBlindLevel(): BlindLevel {
    if (this.currentLevel >= this.config.blindLevels.length - 1) {
      return this.currentBlindLevel();
    }
    const wasLateOpen = this.isLateRegOpen();
    this.currentLevel += 1;
    const level = this.currentBlindLevel();
    for (const table of this.tables) {
      if (table.closed || !table.engine) continue;
      table.engine.updateBlinds(level.smallBlindMojos, level.bigBlindMojos);
    }
    if (wasLateOpen && !this.isLateRegOpen()) {
      this.closeLateRegistration();
    }
    this.refreshHandForHand();
    return level;
  }

  /** Whether a table may deal the next hand under hand-for-hand rules. */
  canDealNextHand(tableId: TableId): boolean {
    return this.h4h.canDeal(tableId);
  }

  reportHandComplete(tableId: TableId): ReturnType<HandForHandController["reportHandComplete"]> {
    if (!this.tablesById.has(tableId)) {
      throw new Error("Unknown table");
    }
    return this.h4h.reportHandComplete(tableId);
  }

  getHandForHandState(): ReturnType<HandForHandController["getState"]> {
    return this.h4h.getState();
  }

  /**
   * If exactly one active player remains and late reg is closed, mark them the
   * winner and complete the tournament. Used by the bot simulator and recovery.
   */
  finalizeIfSingleWinner(): boolean {
    if (this.status === "completed") return true;
    if (this.isLateRegOpen()) return false;
    const active = this.activePlayersInternal();
    if (active.length !== 1) return false;
    this.completeWithWinner(active[0]!);
    for (const t of this.tables) {
      t.closed = true;
      t.isFinalTable = false;
    }
    return true;
  }

  /** Live ICM equities for still-active players. */
  computeLiveIcm(): IcmResult[] {
    const active = this.activePlayersInternal();
    if (active.length === 0) return [];
    const remainingPrizes = this.remainingPrizes();
    return computeIcm(
      active.map((p) => ({ playerId: p.playerId, stackMojos: p.stackMojos })),
      remainingPrizes,
    );
  }

  getTableEngine(tableId: TableId): NlheTableEngine | undefined {
    const table = this.tablesById.get(tableId);
    if (!table || table.closed) return undefined;
    return this.ensureTableEngine(table);
  }

  listOpenTableIds(): TableId[] {
    return this.tables.filter((t) => !t.closed).map((t) => t.tableId);
  }

  getSummary(): TournamentSummary {
    const level = this.currentBlindLevel();
    return {
      id: this.config.id,
      name: this.config.name,
      format: this.config.format,
      status: this.status,
      maxSeats: this.config.maxSeats,
      maxEntries: this.config.maxEntries,
      registeredCount: this.players.size,
      activeCount: this.activeCount,
      eliminatedCount: this.eliminatedCount,
      tableCount: this.tables.filter((t) => !t.closed).length,
      currentLevel: this.currentLevel,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      anteMojos: level.anteMojos,
      lateRegOpen: this.isLateRegOpen(),
      prizePoolMojos: this.prizePoolMojos,
      paidPlaces: this.paidPlaces,
      handForHandActive: this.h4h.isActive(),
      winnerId: this.winnerId,
    };
  }

  getSnapshot(options: SnapshotOptions = {}): TournamentSnapshot {
    const wantDetail =
      options.detail ?? this.players.size <= FULL_DETAIL_PLAYER_CAP;
    const summary = this.getSummary();
    const h4h = this.h4h.getState();

    const base: TournamentSnapshot = {
      ...summary,
      payoutLadder: this.payoutLadder.map((p) => ({
        place: p.place,
        pct: p.pct,
        amountMojos: p.amountMojos,
      })),
      handForHand: {
        active: h4h.active,
        reason: h4h.reason,
        waitingOn: h4h.waitingOn,
        completed: h4h.completed,
        wave: h4h.wave,
      },
    };

    if (!wantDetail) {
      return base;
    }

    const players: TournamentPlayerSnapshot[] = [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      status: p.status,
      stackMojos: p.stackMojos,
      tableId: p.tableId,
      seatIndex: p.seatIndex,
      finishPosition: p.finishPosition,
      prizeMojos: p.prizeMojos,
      entriesUsed: p.entriesUsed,
      reentriesUsed: p.reentriesUsed,
    }));

    const tables: TournamentTableSnapshot[] = this.tables.map((t) => ({
      tableId: t.tableId,
      closed: t.closed,
      isFinalTable: t.isFinalTable,
      seats: [...t.seats.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([seatIndex, playerId]) => ({
          seatIndex,
          playerId,
          stackMojos: this.players.get(playerId)?.stackMojos ?? 0n,
        })),
    }));

    return { ...base, players, tables };
  }

  /** Serializable state for persistence layers. */
  exportState(): {
    config: {
      id: string;
      name: string;
      format: "sng" | "mtt";
      variant: string;
      maxSeats: number;
      maxEntries: number | null;
      minEntries: number;
      buyInMojos: string;
      startingStackMojos: string;
      feeBps: number;
      lateRegThroughLevel: number;
      reentryAllowed: boolean;
      maxReentries: number;
      blindLevels: Array<{
        level: number;
        smallBlindMojos: string;
        bigBlindMojos: string;
        anteMojos: string;
        durationSeconds: number;
      }>;
    };
    status: TournamentStatus;
    currentLevel: number;
    winnerId: PlayerId | null;
    activeCount: number;
    eliminatedCount: number;
    totalEntriesPaid: number;
    prizePoolMojos: string;
    paidPlaces: number;
    payoutLadder: Array<{ place: number; pct: number; amountMojos: string }>;
    eliminationSeq: number;
    players: Array<{
      playerId: PlayerId;
      status: TournamentPlayerStatus;
      stackMojos: string;
      tableId: TableId | null;
      seatIndex: number | null;
      finishPosition: number | null;
      prizeMojos: string;
      entriesUsed: number;
      reentriesUsed: number;
      eliminatedAt: number | null;
    }>;
    tables: Array<{
      tableId: TableId;
      closed: boolean;
      isFinalTable: boolean;
      seats: Array<[number, PlayerId]>;
    }>;
    handForHand: ReturnType<HandForHandController["getState"]>;
  } {
    const cfg = this.config;
    return {
      config: {
        id: cfg.id,
        name: cfg.name,
        format: cfg.format,
        variant: cfg.variant,
        maxSeats: cfg.maxSeats,
        maxEntries: cfg.maxEntries,
        minEntries: cfg.minEntries,
        buyInMojos: cfg.buyInMojos.toString(),
        startingStackMojos: cfg.startingStackMojos.toString(),
        feeBps: cfg.feeBps,
        lateRegThroughLevel: cfg.lateRegThroughLevel,
        reentryAllowed: cfg.reentryAllowed,
        maxReentries: cfg.maxReentries,
        blindLevels: cfg.blindLevels.map((l) => ({
          level: l.level,
          smallBlindMojos: l.smallBlindMojos.toString(),
          bigBlindMojos: l.bigBlindMojos.toString(),
          anteMojos: l.anteMojos.toString(),
          durationSeconds: l.durationSeconds,
        })),
      },
      status: this.status,
      currentLevel: this.currentLevel,
      winnerId: this.winnerId,
      activeCount: this.activeCount,
      eliminatedCount: this.eliminatedCount,
      totalEntriesPaid: this.totalEntriesPaid,
      prizePoolMojos: this.prizePoolMojos.toString(),
      paidPlaces: this.paidPlaces,
      payoutLadder: this.payoutLadder.map((p) => ({
        place: p.place,
        pct: p.pct,
        amountMojos: p.amountMojos.toString(),
      })),
      eliminationSeq: this.eliminationSeq,
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId,
        status: p.status,
        stackMojos: p.stackMojos.toString(),
        tableId: p.tableId,
        seatIndex: p.seatIndex,
        finishPosition: p.finishPosition,
        prizeMojos: p.prizeMojos.toString(),
        entriesUsed: p.entriesUsed,
        reentriesUsed: p.reentriesUsed,
        eliminatedAt: p.eliminatedAt,
      })),
      tables: this.tables.map((t) => ({
        tableId: t.tableId,
        closed: t.closed,
        isFinalTable: t.isFinalTable,
        seats: [...t.seats.entries()],
      })),
      handForHand: this.h4h.getState(),
    };
  }

  static fromExportedState(
    raw: ReturnType<TournamentEngine["exportState"]>,
  ): TournamentEngine {
    const eng = new TournamentEngine({
      id: raw.config.id,
      name: raw.config.name,
      format: raw.config.format,
      maxSeats: raw.config.maxSeats,
      maxEntries: raw.config.maxEntries,
      minEntries: raw.config.minEntries,
      buyInMojos: BigInt(raw.config.buyInMojos),
      startingStackMojos: BigInt(raw.config.startingStackMojos),
      blindLevels: raw.config.blindLevels.map((l) => ({
        level: l.level,
        smallBlindMojos: BigInt(l.smallBlindMojos),
        bigBlindMojos: BigInt(l.bigBlindMojos),
        anteMojos: BigInt(l.anteMojos),
        durationSeconds: l.durationSeconds,
      })),
      feeBps: raw.config.feeBps,
      lateRegThroughLevel: raw.config.lateRegThroughLevel,
      reentryAllowed: raw.config.reentryAllowed,
      maxReentries: raw.config.maxReentries,
    });
    eng.status = raw.status;
    eng.currentLevel = raw.currentLevel;
    eng.winnerId = raw.winnerId;
    eng.activeCount = raw.activeCount;
    eng.eliminatedCount = raw.eliminatedCount;
    eng.totalEntriesPaid = raw.totalEntriesPaid;
    eng.prizePoolMojos = BigInt(raw.prizePoolMojos);
    eng.paidPlaces = raw.paidPlaces;
    eng.payoutLadder = raw.payoutLadder.map((p) => ({
      place: p.place,
      pct: p.pct,
      amountMojos: BigInt(p.amountMojos),
    }));
    eng.eliminationSeq = raw.eliminationSeq;
    eng.players.clear();
    for (const p of raw.players) {
      eng.players.set(p.playerId, {
        playerId: p.playerId,
        status: p.status,
        stackMojos: BigInt(p.stackMojos),
        tableId: p.tableId,
        seatIndex: p.seatIndex,
        finishPosition: p.finishPosition,
        prizeMojos: BigInt(p.prizeMojos),
        entriesUsed: p.entriesUsed,
        reentriesUsed: p.reentriesUsed,
        eliminatedAt: p.eliminatedAt,
      });
    }
    eng.tables = [];
    eng.tablesById.clear();
    for (const t of raw.tables) {
      const table: InternalTable = {
        tableId: t.tableId,
        closed: t.closed,
        isFinalTable: t.isFinalTable,
        seats: new Map(t.seats),
        engine: null,
      };
      eng.tables.push(table);
      eng.tablesById.set(table.tableId, table);
    }
    if (raw.handForHand.active && raw.handForHand.reason) {
      eng.h4h.enable(
        raw.handForHand.waitingOn.length > 0
          ? raw.handForHand.waitingOn
          : eng.listOpenTableIds(),
        raw.handForHand.reason as Exclude<HandForHandReason, null>,
      );
    }
    return eng;
  }

  private registerPreStart(playerId: PlayerId): RegisterResult {
    if (this.players.has(playerId)) {
      throw new Error("Player already registered");
    }
    if (
      this.config.maxEntries !== null &&
      this.totalEntriesPaid >= this.config.maxEntries
    ) {
      throw new Error("Tournament is full");
    }
    this.players.set(playerId, {
      playerId,
      status: "registered",
      stackMojos: this.config.startingStackMojos,
      tableId: null,
      seatIndex: null,
      finishPosition: null,
      prizeMojos: 0n,
      entriesUsed: 1,
      reentriesUsed: 0,
      eliminatedAt: null,
    });
    this.totalEntriesPaid += 1;
    return {
      playerId,
      entriesUsed: 1,
      seated: false,
      seat: null,
      lateReg: false,
    };
  }

  private registerLate(playerId: PlayerId): RegisterResult {
    if (this.players.has(playerId)) {
      const existing = this.players.get(playerId)!;
      if (existing.status === "eliminated") {
        return this.reenter(playerId);
      }
      throw new Error("Player already registered");
    }
    if (
      this.config.maxEntries !== null &&
      this.totalEntriesPaid >= this.config.maxEntries
    ) {
      throw new Error("Tournament is full");
    }
    this.players.set(playerId, {
      playerId,
      status: "waiting_seat",
      stackMojos: this.config.startingStackMojos,
      tableId: null,
      seatIndex: null,
      finishPosition: null,
      prizeMojos: 0n,
      entriesUsed: 1,
      reentriesUsed: 0,
      eliminatedAt: null,
    });
    this.totalEntriesPaid += 1;
    this.rebuildPrizePool();
    const seat = this.seatNewEntrant(playerId, "late_reg");
    return {
      playerId,
      entriesUsed: 1,
      seated: seat !== null,
      seat,
      lateReg: true,
    };
  }

  private seatNewEntrant(
    playerId: PlayerId,
    reason: "late_reg" | "reentry",
  ): { tableId: TableId; seatIndex: number } | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    let dest = this.tables
      .filter((t) => !t.closed && t.seats.size < this.config.maxSeats)
      .sort((a, b) => a.seats.size - b.seats.size || a.tableId.localeCompare(b.tableId))[0];

    if (!dest) {
      const tableId = randomUUID();
      dest = {
        tableId,
        closed: false,
        isFinalTable: false,
        seats: new Map(),
        engine: null,
      };
      this.tables.push(dest);
      this.tablesById.set(tableId, dest);
    }

    const seatIndex = nextOpenSeat(new Set(dest.seats.keys()), this.config.maxSeats);
    if (seatIndex === null) return null;

    dest.seats.set(seatIndex, playerId);
    player.status = "active";
    player.tableId = dest.tableId;
    player.seatIndex = seatIndex;
    player.stackMojos = this.config.startingStackMojos;
    this.activeCount += 1;
    if (reason === "reentry") {
      this.eliminatedCount = Math.max(0, this.eliminatedCount - 1);
    }

    if (dest.engine) {
      dest.engine.seatTournamentPlayer(
        playerId,
        seatIndex,
        this.config.startingStackMojos,
      );
    }

    this.refreshHandForHand();
    return { tableId: dest.tableId, seatIndex };
  }

  private rebuildPrizePool(): void {
    const breakdown = buildPrizePool({
      entries: Math.max(1, this.totalEntriesPaid),
      buyInMojos: this.config.buyInMojos,
      feeBps: this.config.feeBps,
    });
    this.prizePoolMojos = breakdown.prizePoolMojos;
    this.payoutLadder = breakdown.ladder;
    this.paidPlaces = breakdown.paidPlaces;
  }

  private remainingPrizes(): bigint[] {
    const claimed = new Set(
      [...this.players.values()]
        .filter((p) => p.finishPosition !== null)
        .map((p) => p.finishPosition!),
    );
    return this.payoutLadder
      .filter((row) => !claimed.has(row.place))
      .map((row) => row.amountMojos);
  }

  private assignFinishPosition(player: InternalPlayer): number {
    const placed = [...this.players.values()].filter((p) => p.finishPosition !== null)
      .length;
    const pos = this.players.size - placed;
    player.finishPosition = pos;
    player.prizeMojos = prizeForPlace(this.payoutLadder, pos);
    return pos;
  }

  private closeLateRegistration(): void {
    // Permanently place anyone sitting eliminated without a finish position
    const pending = [...this.players.values()]
      .filter((p) => p.status === "eliminated" && p.finishPosition === null)
      .sort((a, b) => (a.eliminatedAt ?? 0) - (b.eliminatedAt ?? 0));
    for (const p of pending) {
      this.assignFinishPosition(p);
    }
    this.rebuildPrizePool();
    if (this.activeCount <= 1) {
      const winner = this.activePlayersInternal()[0];
      if (winner) {
        this.completeWithWinner(winner);
      }
    }
  }

  private finishTournament(
    lastBustId: PlayerId,
    finishPosition: number | null,
    prizeMojos: bigint,
    elimMove: SeatMove,
  ): EliminateResult {
    const winner = this.activePlayersInternal()[0] ?? null;
    if (winner) {
      this.completeWithWinner(winner);
    } else {
      this.status = "completed";
    }
    for (const t of this.tables) {
      t.closed = true;
      t.isFinalTable = false;
    }
    this.h4h.disable();
    return {
      playerId: lastBustId,
      finishPosition,
      prizeMojos,
      canReenter: false,
      moves: [elimMove],
      status: this.status,
      winnerId: this.winnerId,
      handForHand: null,
    };
  }

  private completeWithWinner(winner: InternalPlayer): void {
    winner.finishPosition = 1;
    winner.prizeMojos = prizeForPlace(this.payoutLadder, 1);
    this.winnerId = winner.playerId;
    this.status = "completed";
    this.h4h.disable();
  }

  private refreshHandForHand(): void {
    const openIds = this.listOpenTableIds();
    const reason = shouldHandForHand({
      activeCount: this.activeCount,
      paidPlaces: this.paidPlaces,
      tableCount: openIds.length,
      finalTableSeats: this.config.maxSeats,
    });
    if (reason) {
      this.h4h.enable(openIds, reason);
      if (reason === "final_table") {
        this.status = openIds.length <= 1 ? "final_table" : this.status;
      }
    } else if (this.status !== "final_table") {
      this.h4h.disable();
    } else {
      this.h4h.enable(openIds, "final_table");
    }
  }

  private currentBlindLevel(): BlindLevel {
    return this.config.blindLevels[this.currentLevel]!;
  }

  private activePlayersInternal(): InternalPlayer[] {
    return [...this.players.values()].filter((p) => p.status === "active");
  }

  private createTableEngine(tableId: TableId, level: BlindLevel): NlheTableEngine {
    const config: TableConfig = {
      id: tableId,
      variant: this.config.variant,
      format: this.config.format,
      maxSeats: this.config.maxSeats,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      minBuyInMojos: this.config.startingStackMojos,
      maxBuyInMojos: this.config.startingStackMojos,
      rakeBps: 0,
    };
    return new NlheTableEngine(config);
  }

  private ensureTableEngine(table: InternalTable): NlheTableEngine {
    if (table.engine) return table.engine;
    const level = this.currentBlindLevel();
    const engine = this.createTableEngine(table.tableId, level);
    for (const [seatIndex, playerId] of table.seats) {
      const stack =
        this.players.get(playerId)?.stackMojos ?? this.config.startingStackMojos;
      if (stack <= 0n) continue;
      engine.seatTournamentPlayer(playerId, seatIndex, stack);
    }
    table.engine = engine;
    return engine;
  }

  private applyRebalance(active: InternalPlayer[]): { moves: SeatMove[] } {
    const balancerTables: BalancerTable[] = this.tables.map((t) => ({
      tableId: t.tableId,
      closed: t.closed,
      isFinalTable: t.isFinalTable,
      seats: new Map(t.seats),
    }));

    const balancerPlayers: BalancerPlayer[] = active.map((p) => ({
      playerId: p.playerId,
      stackMojos: p.stackMojos,
      tableId: p.tableId,
      seatIndex: p.seatIndex,
    }));

    const result = rebalanceTables(
      balancerTables,
      balancerPlayers,
      this.config.maxSeats,
      () => randomUUID(),
    );

    for (const next of result.tables) {
      let table = this.tablesById.get(next.tableId);
      if (!table) {
        table = {
          tableId: next.tableId,
          closed: next.closed,
          isFinalTable: next.isFinalTable,
          seats: new Map(),
          engine: null,
        };
        this.tables.push(table);
        this.tablesById.set(table.tableId, table);
      }
      table.closed = next.closed;
      table.isFinalTable = next.isFinalTable;
      table.seats = new Map(next.seats);
    }

    for (const move of result.moves) {
      const player = this.players.get(move.playerId);
      if (!player) continue;

      if (move.from) {
        const fromTable = this.tablesById.get(move.from.tableId);
        if (fromTable?.engine && !fromTable.engine.isHandInProgress()) {
          try {
            fromTable.engine.cashOutPlayer(move.playerId);
          } catch {
            // already gone
          }
        }
      }

      if (move.to) {
        const toTable = this.tablesById.get(move.to.tableId);
        if (toTable?.engine) {
          const already = toTable.engine
            .getSeatedPlayers()
            .some((s) => s.playerId === move.playerId);
          if (!already && player.stackMojos > 0n) {
            toTable.engine.seatTournamentPlayer(
              move.playerId,
              move.to.seatIndex,
              player.stackMojos,
            );
          }
        }
      }
    }

    for (const p of active) {
      p.tableId = null;
      p.seatIndex = null;
    }
    for (const table of this.tables) {
      if (table.closed) continue;
      for (const [seatIndex, pid] of table.seats) {
        const p = this.players.get(pid);
        if (!p || p.status !== "active") continue;
        p.tableId = table.tableId;
        p.seatIndex = seatIndex;
      }
    }

    if (result.isFinalTable) {
      this.status = "final_table";
    } else if (this.status === "final_table" && this.listOpenTableIds().length > 1) {
      this.status = "running";
    }

    return { moves: result.moves };
  }
}
