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
import { assignPlayersToTables, tablesNeeded } from "./seating.js";
import { defaultMttBlindLevels, defaultSngBlindLevels } from "./blinds.js";

interface InternalPlayer {
  playerId: PlayerId;
  status: TournamentPlayerStatus;
  stackMojos: bigint;
  tableId: TableId | null;
  seatIndex: number | null;
  finishPosition: number | null;
}

interface InternalTable {
  tableId: TableId;
  closed: boolean;
  isFinalTable: boolean;
  seats: Map<number, PlayerId>;
  /** Lazily materialized — seating maps are authoritative until a hand needs an engine. */
  engine: NlheTableEngine | null;
}

export interface CreateTournamentInput {
  name: string;
  format?: "sng" | "mtt";
  maxSeats?: number;
  /**
   * Registration cap. Omit or pass `null` for MTT = unlimited (host everyone who registers).
   * SNG defaults to `maxSeats`.
   */
  maxEntries?: number | null;
  minEntries?: number;
  buyInMojos?: bigint;
  startingStackMojos?: bigint;
  blindLevels?: BlindLevel[];
  id?: string;
}

export interface EliminateResult {
  playerId: PlayerId;
  finishPosition: number;
  moves: SeatMove[];
  status: TournamentStatus;
  winnerId: PlayerId | null;
}

export interface StartResult {
  moves: SeatMove[];
  tableCount: number;
  status: TournamentStatus;
  /** True when per-player initial seat moves were omitted to keep large fields cheap. */
  movesTruncated: boolean;
}

export interface SnapshotOptions {
  /** Include full player + table seat lists (default true below FULL_DETAIL_PLAYER_CAP). */
  detail?: boolean;
}

const DEFAULT_BUY_IN = 10_000n; // 10 DAT
const DEFAULT_STARTING_STACK = 1_500_000n; // 1,500 DAT chips (tournament chips, not cash)

/** Above this, start() skips returning 1:1 initial seat moves. */
const INITIAL_MOVE_DETAIL_CAP = 2_000;
/** Above this, getSnapshot() defaults to summary-only unless detail:true. */
const FULL_DETAIL_PLAYER_CAP = 5_000;

export class TournamentEngine {
  private readonly config: TournamentConfig;
  private status: TournamentStatus = "registering";
  private players = new Map<PlayerId, InternalPlayer>();
  private tables: InternalTable[] = [];
  private tablesById = new Map<TableId, InternalTable>();
  private currentLevel = 0;
  private winnerId: PlayerId | null = null;
  private nextFinishPosition: number | null = null;
  private activeCount = 0;
  private eliminatedCount = 0;

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
      // MTT: omit / null => unlimited registrations
      maxEntries = input.maxEntries === undefined ? null : input.maxEntries;
      if (maxEntries !== null && maxEntries < 2) {
        throw new Error("MTT maxEntries must be at least 2, or null for unlimited");
      }
    }

    const minEntries =
      input.minEntries ?? (format === "sng" ? maxSeats : 2);
    if (maxEntries !== null && minEntries > maxEntries) {
      throw new Error("minEntries cannot exceed maxEntries");
    }

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

  /** `null` means uncapped — seat every registrant. */
  isRegistrationUnlimited(): boolean {
    return this.config.maxEntries === null;
  }

  registerPlayer(playerId: PlayerId): void {
    if (this.status !== "registering") {
      throw new Error("Registration is closed");
    }
    if (this.players.has(playerId)) {
      throw new Error("Player already registered");
    }
    if (
      this.config.maxEntries !== null &&
      this.players.size >= this.config.maxEntries
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
    });
  }

  registerPlayers(playerIds: readonly PlayerId[]): void {
    for (const id of playerIds) {
      this.registerPlayer(id);
    }
  }

  getRegisteredCount(): number {
    return this.players.size;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Seat all registered players across as many 8-max tables as needed.
   * Table engines are created lazily on first hand access so 100k+ fields
   * only pay for seating maps until play starts on each table.
   */
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
    this.nextFinishPosition = this.players.size;
    this.status = tableCount === 1 ? "final_table" : "running";

    return {
      moves,
      tableCount,
      status: this.status,
      movesTruncated: !recordMoves,
    };
  }

  /**
   * Eliminate a busted player, assign finish position, and rebalance/reseats
   * remaining players. When one player remains, the tournament completes.
   */
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

    const finishPosition = this.nextFinishPosition!;
    this.nextFinishPosition = finishPosition - 1;
    player.status = "eliminated";
    player.finishPosition = finishPosition;
    player.tableId = null;
    player.seatIndex = null;
    player.stackMojos = 0n;
    this.activeCount -= 1;
    this.eliminatedCount += 1;

    const elimMove: SeatMove = {
      playerId,
      from,
      to: null,
      reason: "elimination",
    };

    if (this.activeCount <= 1) {
      const winner = this.activePlayersInternal()[0] ?? null;
      if (winner) {
        winner.finishPosition = 1;
        this.winnerId = winner.playerId;
      }
      this.status = "completed";
      for (const t of this.tables) {
        t.closed = true;
        t.isFinalTable = false;
      }
      return {
        playerId,
        finishPosition,
        moves: [elimMove],
        status: this.status,
        winnerId: this.winnerId,
      };
    }

    const balance = this.applyRebalance(this.activePlayersInternal());
    return {
      playerId,
      finishPosition,
      moves: [elimMove, ...balance.moves],
      status: this.status,
      winnerId: null,
    };
  }

  /**
   * Sync chip stacks from materialized table engines and eliminate anyone at 0.
   */
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
    this.currentLevel += 1;
    const level = this.currentBlindLevel();
    for (const table of this.tables) {
      if (table.closed || !table.engine) continue;
      table.engine.updateBlinds(level.smallBlindMojos, level.bigBlindMojos);
    }
    return level;
  }

  /**
   * Materialize (if needed) and return the NLHE engine for a live table.
   * Safe to call for any open table in a 100k-player field — only that table
   * pays the engine cost.
   */
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
      winnerId: this.winnerId,
    };
  }

  getSnapshot(options: SnapshotOptions = {}): TournamentSnapshot {
    const wantDetail =
      options.detail ?? this.players.size <= FULL_DETAIL_PLAYER_CAP;
    const summary = this.getSummary();

    if (!wantDetail) {
      return { ...summary };
    }

    const players: TournamentPlayerSnapshot[] = [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      status: p.status,
      stackMojos: p.stackMojos,
      tableId: p.tableId,
      seatIndex: p.seatIndex,
      finishPosition: p.finishPosition,
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

    return { ...summary, players, tables };
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
      const stack = this.players.get(playerId)?.stackMojos ?? this.config.startingStackMojos;
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

    // Sync only engines that already exist (lazy) — seating maps stay authoritative.
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

    // Rebuild seat pointers from canonical maps (O(active seats)).
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

    this.status = result.isFinalTable ? "final_table" : "running";
    return { moves: result.moves };
  }
}
