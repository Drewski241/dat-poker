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
  engine: NlheTableEngine | null;
}

export interface CreateTournamentInput {
  name: string;
  format?: "sng" | "mtt";
  maxSeats?: number;
  maxEntries?: number;
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
}

const DEFAULT_BUY_IN = 10_000n; // 10 DAT
const DEFAULT_STARTING_STACK = 1_500_000n; // 1,500 DAT chips (tournament chips, not cash)

export class TournamentEngine {
  private readonly config: TournamentConfig;
  private status: TournamentStatus = "registering";
  private players = new Map<PlayerId, InternalPlayer>();
  private tables: InternalTable[] = [];
  private currentLevel = 0;
  private winnerId: PlayerId | null = null;
  private nextFinishPosition: number | null = null;

  constructor(input: CreateTournamentInput) {
    const format = input.format ?? "mtt";
    const maxSeats = input.maxSeats ?? 8;
    if (maxSeats < 2 || maxSeats > 10) {
      throw new Error("maxSeats must be between 2 and 10");
    }
    const maxEntries =
      input.maxEntries ?? (format === "sng" ? maxSeats : 10_000);
    const minEntries =
      input.minEntries ?? (format === "sng" ? maxSeats : Math.min(2, maxEntries));
    const buyInMojos = input.buyInMojos ?? DEFAULT_BUY_IN;
    const startingStackMojos = input.startingStackMojos ?? DEFAULT_STARTING_STACK;
    const blindLevels =
      input.blindLevels ??
      (format === "sng" ? defaultSngBlindLevels() : defaultMttBlindLevels());

    if (blindLevels.length === 0) {
      throw new Error("At least one blind level is required");
    }
    if (format === "sng" && maxEntries > maxSeats) {
      throw new Error("SNG maxEntries cannot exceed maxSeats");
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

  registerPlayer(playerId: PlayerId): void {
    if (this.status !== "registering") {
      throw new Error("Registration is closed");
    }
    if (this.players.has(playerId)) {
      throw new Error("Player already registered");
    }
    if (this.players.size >= this.config.maxEntries) {
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
    return [...this.players.values()].filter((p) => p.status === "active").length;
  }

  /**
   * Seat all registered players across tables and open play.
   * For SNGs this is a single table; for MTTs it creates as many 8-max
   * tables as needed (thousands of players → hundreds of tables).
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
    const moves: SeatMove[] = [];
    const level = this.currentBlindLevel();

    this.tables = groups.map((group) => {
      const tableId = randomUUID();
      const seats = new Map<number, PlayerId>();
      const engine = this.createTableEngine(tableId, level);

      group.forEach((playerId, seatIndex) => {
        seats.set(seatIndex, playerId);
        engine.seatPlayer(playerId, seatIndex, this.config.startingStackMojos);
        const player = this.players.get(playerId)!;
        player.status = "active";
        player.tableId = tableId;
        player.seatIndex = seatIndex;
        player.stackMojos = this.config.startingStackMojos;
        moves.push({
          playerId,
          from: null,
          to: { tableId, seatIndex },
          reason: "initial_seat",
        });
      });

      return {
        tableId,
        closed: false,
        isFinalTable: tableCount === 1,
        seats,
        engine,
      };
    });

    this.nextFinishPosition = this.players.size;
    this.status = tableCount === 1 ? "final_table" : "running";

    return {
      moves,
      tableCount,
      status: this.status,
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

    // Remove from table + engine
    const table = this.tables.find((t) => t.tableId === player.tableId);
    if (table) {
      if (player.seatIndex !== null) {
        table.seats.delete(player.seatIndex);
      }
      if (table.engine && !table.engine.isHandInProgress()) {
        try {
          table.engine.cashOutPlayer(playerId);
        } catch {
          // Player may already be unseated from engine after a prior sync.
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

    const elimMove: SeatMove = {
      playerId,
      from,
      to: null,
      reason: "elimination",
    };

    const active = this.activePlayersInternal();
    if (active.length <= 1) {
      const winner = active[0] ?? null;
      if (winner) {
        winner.finishPosition = 1;
        this.winnerId = winner.playerId;
      }
      this.status = "completed";
      // Close tables
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

    const balance = this.applyRebalance(active);
    const moves = [elimMove, ...balance.moves];
    return {
      playerId,
      finishPosition,
      moves,
      status: this.status,
      winnerId: null,
    };
  }

  /**
   * Sync chip stacks from table engines and eliminate anyone at 0.
   * Call after each hand completes on any tournament table.
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

  getTableEngine(tableId: TableId): NlheTableEngine | undefined {
    return this.tables.find((t) => t.tableId === tableId && !t.closed)?.engine ?? undefined;
  }

  listOpenTableIds(): TableId[] {
    return this.tables.filter((t) => !t.closed).map((t) => t.tableId);
  }

  getSnapshot(): TournamentSnapshot {
    const level = this.currentBlindLevel();
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

    return {
      id: this.config.id,
      name: this.config.name,
      format: this.config.format,
      status: this.status,
      maxSeats: this.config.maxSeats,
      registeredCount: this.players.size,
      activeCount: players.filter((p) => p.status === "active").length,
      eliminatedCount: players.filter((p) => p.status === "eliminated").length,
      tableCount: tables.filter((t) => !t.closed).length,
      currentLevel: this.currentLevel,
      smallBlindMojos: level.smallBlindMojos,
      bigBlindMojos: level.bigBlindMojos,
      anteMojos: level.anteMojos,
      players,
      tables,
      winnerId: this.winnerId,
    };
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
      // Tournament chips are fixed starting stacks — allow exact seating.
      minBuyInMojos: this.config.startingStackMojos,
      maxBuyInMojos: this.config.startingStackMojos,
      rakeBps: 0,
    };
    return new NlheTableEngine(config);
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

    // Apply structural table changes
    const byId = new Map(this.tables.map((t) => [t.tableId, t]));
    for (const next of result.tables) {
      let table = byId.get(next.tableId);
      if (!table) {
        const level = this.currentBlindLevel();
        table = {
          tableId: next.tableId,
          closed: next.closed,
          isFinalTable: next.isFinalTable,
          seats: new Map(),
          engine: this.createTableEngine(next.tableId, level),
        };
        this.tables.push(table);
        byId.set(table.tableId, table);
      }
      table.closed = next.closed;
      table.isFinalTable = next.isFinalTable;
      table.seats = new Map(next.seats);
    }

    // Apply moves onto engines + player records
    for (const move of result.moves) {
      const player = this.players.get(move.playerId);
      if (!player) continue;

      if (move.from) {
        const fromTable = byId.get(move.from.tableId);
        if (fromTable?.engine && !fromTable.engine.isHandInProgress()) {
          try {
            fromTable.engine.cashOutPlayer(move.playerId);
          } catch {
            // already gone
          }
        }
      }

      if (move.to) {
        const toTable = byId.get(move.to.tableId);
        if (!toTable) continue;
        if (!toTable.engine) {
          toTable.engine = this.createTableEngine(toTable.tableId, this.currentBlindLevel());
        }
        // Ensure engine seating matches (seat may already be set if we rebuilt seats map first)
        const already = toTable.engine
          .getSeatedPlayers()
          .some((s) => s.playerId === move.playerId);
        if (!already) {
          // Temporarily widen buy-in band for mid-tournament stack sizes
          toTable.engine.seatTournamentPlayer(
            move.playerId,
            move.to.seatIndex,
            player.stackMojos,
          );
        }
        player.tableId = move.to.tableId;
        player.seatIndex = move.to.seatIndex;
      } else {
        player.tableId = null;
        player.seatIndex = null;
      }
    }

    // Refresh player seat pointers from canonical table maps
    for (const p of this.players.values()) {
      if (p.status !== "active") continue;
      let found = false;
      for (const table of this.tables) {
        if (table.closed) continue;
        for (const [seatIndex, pid] of table.seats) {
          if (pid === p.playerId) {
            p.tableId = table.tableId;
            p.seatIndex = seatIndex;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    this.status = result.isFinalTable ? "final_table" : "running";
    return { moves: result.moves };
  }
}
