import type { FastifyInstance } from "fastify";
import {
  createTournamentStore,
  TournamentEngine,
  type EliminateResult,
  type TournamentStore,
} from "@dat-poker/tournament-engine";
import type { NlheTableEngine } from "@dat-poker/game-engine";
import { isHousePlayerId } from "@dat-poker/shared";

const tournaments = new Map<string, TournamentEngine>();
/** tableId → tournamentId for hand-route lookup */
const tableOwner = new Map<string, string>();

let store: TournamentStore = {
  async save() {},
  async load() {
    return null;
  },
  async listIds() {
    return [];
  },
  async delete() {},
};
let storeKind: "memory" | "postgres" = "memory";

async function persist(tournament: TournamentEngine): Promise<void> {
  await store.save(tournament.exportState());
}

function indexTables(tournament: TournamentEngine): void {
  const id = tournament.getId();
  for (const [tableId, owner] of [...tableOwner.entries()]) {
    if (owner === id) tableOwner.delete(tableId);
  }
  for (const tableId of tournament.listOpenTableIds()) {
    tableOwner.set(tableId, id);
  }
}

export function getTournament(id: string): TournamentEngine | undefined {
  return tournaments.get(id);
}

export function findTournamentByTableId(
  tableId: string,
): { tournamentId: string; tournament: TournamentEngine } | undefined {
  const tournamentId = tableOwner.get(tableId);
  if (!tournamentId) {
    // Slow path: scan (covers rebalance race / hydration)
    for (const [id, t] of tournaments) {
      if (t.listOpenTableIds().includes(tableId)) {
        tableOwner.set(tableId, id);
        return { tournamentId: id, tournament: t };
      }
    }
    return undefined;
  }
  const tournament = tournaments.get(tournamentId);
  if (!tournament) return undefined;
  return { tournamentId, tournament };
}

export function getTournamentTableEngine(tableId: string): NlheTableEngine | undefined {
  const found = findTournamentByTableId(tableId);
  if (!found) return undefined;
  return found.tournament.getTableEngine(tableId);
}

/** After a tournament hand ends: sync busts, H4H barrier, finalize winner. */
export async function afterTournamentHandComplete(
  tableId: string,
): Promise<{
  eliminations: EliminateResult[];
  handForHand: ReturnType<TournamentEngine["getHandForHandState"]>;
  summary: ReturnType<TournamentEngine["getSummary"]>;
} | null> {
  const found = findTournamentByTableId(tableId);
  if (!found) return null;
  const { tournament } = found;
  const engine = tournament.getTableEngine(tableId);
  if (engine?.isHandInProgress()) {
    return null;
  }
  const eliminations = tournament.syncEliminationsFromStacks();
  try {
    tournament.reportHandComplete(tableId);
  } catch {
    /* barrier may already be clear */
  }
  tournament.finalizeIfSingleWinner();
  indexTables(tournament);
  await persist(tournament);
  return {
    eliminations,
    handForHand: tournament.getHandForHandState(),
    summary: tournament.getSummary(),
  };
}

export function tournamentCanDeal(tableId: string): boolean | null {
  const found = findTournamentByTableId(tableId);
  if (!found) return null;
  return found.tournament.canDealNextHand(tableId);
}

export async function initTournamentStore(): Promise<void> {
  const created = await createTournamentStore(process.env.DATABASE_URL);
  store = created.store;
  storeKind = created.kind;
  for (const id of await store.listIds()) {
    const raw = await store.load(id);
    if (raw) {
      const t = TournamentEngine.fromExportedState(raw);
      tournaments.set(id, t);
      indexTables(t);
    }
  }
}

function parseMaxEntries(
  raw: number | null | undefined,
): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return raw;
}

export function registerTournamentRoutes(app: FastifyInstance): void {
  app.get("/v1/tournaments/meta", async () => ({
    persistence: storeKind,
  }));

  /**
   * One-shot playable SNG: register the human, fill remaining seats with house
   * bots, start, and return the live table id for hand routes.
   */
  app.post<{
    Body: {
      playerId: string;
      name?: string;
      maxSeats?: number;
      buyInMojos?: string;
      startingStackMojos?: string;
      fillHouse?: boolean;
      feeBps?: number;
    };
  }>("/v1/tournaments/playable-sng", async (req, reply) => {
    const playerId = req.body.playerId?.trim();
    if (!playerId) {
      return reply.status(400).send({ error: "playerId is required" });
    }
    if (isHousePlayerId(playerId)) {
      return reply.status(400).send({ error: "playerId cannot be a house bot id" });
    }
    const maxSeats = req.body.maxSeats ?? 8;
    const fillHouse = req.body.fillHouse !== false;
    const tournament = new TournamentEngine({
      name: req.body.name ?? "Playable SNG",
      format: "sng",
      maxSeats,
      maxEntries: maxSeats,
      minEntries: fillHouse ? Math.min(2, maxSeats) : maxSeats,
      buyInMojos: req.body.buyInMojos ? BigInt(req.body.buyInMojos) : undefined,
      startingStackMojos: req.body.startingStackMojos
        ? BigInt(req.body.startingStackMojos)
        : undefined,
      feeBps: req.body.feeBps ?? 0,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
      maxReentries: 0,
    });
    try {
      tournament.registerPlayer(playerId);
      if (fillHouse) {
        tournament.fillHouseSeats(maxSeats);
      }
      const started = tournament.start();
      tournaments.set(tournament.getId(), tournament);
      indexTables(tournament);
      await persist(tournament);
      const tableId = tournament.listOpenTableIds()[0];
      if (!tableId) {
        return reply.status(500).send({ error: "No table after start" });
      }
      const engine = tournament.getTableEngine(tableId)!;
      return {
        ok: true,
        tournamentId: tournament.getId(),
        tableId,
        fillHouse,
        houseCount: tournament
          .getSnapshot({ detail: true })
          .players?.filter((p) => isHousePlayerId(p.playerId)).length ?? 0,
        started,
        summary: tournament.getSummary(),
        seats: engine.getSeatedPlayers(),
        canDeal: tournament.canDealNextHand(tableId),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Body: {
      name?: string;
      format?: "sng" | "mtt";
      maxSeats?: number;
      maxEntries?: number | null;
      minEntries?: number;
      buyInMojos?: string;
      startingStackMojos?: string;
      feeBps?: number;
      lateRegThroughLevel?: number;
      reentryAllowed?: boolean;
      maxReentries?: number;
    };
  }>("/v1/tournaments", async (req) => {
    const tournament = new TournamentEngine({
      name: req.body.name ?? "DAT Tournament",
      format: req.body.format ?? "mtt",
      maxSeats: req.body.maxSeats ?? 8,
      maxEntries: parseMaxEntries(req.body.maxEntries),
      minEntries: req.body.minEntries,
      buyInMojos: req.body.buyInMojos ? BigInt(req.body.buyInMojos) : undefined,
      startingStackMojos: req.body.startingStackMojos
        ? BigInt(req.body.startingStackMojos)
        : undefined,
      feeBps: req.body.feeBps,
      lateRegThroughLevel: req.body.lateRegThroughLevel,
      reentryAllowed: req.body.reentryAllowed,
      maxReentries: req.body.maxReentries,
    });
    tournaments.set(tournament.getId(), tournament);
    await persist(tournament);
    return {
      tournamentId: tournament.getId(),
      config: tournament.getConfig(),
      status: tournament.getStatus(),
      registrationUnlimited: tournament.isRegistrationUnlimited(),
      persistence: storeKind,
    };
  });

  app.get("/v1/tournaments", async () => {
    const list = [...tournaments.values()].map((t) => {
      const snap = t.getSummary();
      return {
        tournamentId: snap.id,
        name: snap.name,
        format: snap.format,
        status: snap.status,
        registeredCount: snap.registeredCount,
        activeCount: snap.activeCount,
        tableCount: snap.tableCount,
        maxSeats: snap.maxSeats,
        maxEntries: snap.maxEntries,
        registrationUnlimited: snap.maxEntries === null,
        lateRegOpen: snap.lateRegOpen,
        prizePoolMojos: snap.prizePoolMojos,
        paidPlaces: snap.paidPlaces,
        handForHandActive: snap.handForHandActive,
      };
    });
    return { tournaments: list, persistence: storeKind };
  });

  app.get<{
    Params: { tournamentId: string };
    Querystring: { detail?: string };
  }>("/v1/tournaments/:tournamentId", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    const detail =
      req.query.detail === "1" || req.query.detail === "true" ? true : undefined;
    return tournament.getSnapshot({ detail });
  });

  app.get<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId/icm",
    async (req, reply) => {
      const tournament = tournaments.get(req.params.tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: "Tournament not found" });
      }
      return { icm: tournament.computeLiveIcm() };
    },
  );

  app.post<{
    Params: { tournamentId: string };
    Body: { playerId: string };
  }>("/v1/tournaments/:tournamentId/register", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.registerPlayer(req.body.playerId);
      await persist(tournament);
      return {
        ok: true,
        ...result,
        registeredCount: tournament.getRegisteredCount(),
        prizePoolMojos: tournament.getPrizePoolMojos(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tournamentId: string };
    Body: { playerIds: string[] };
  }>("/v1/tournaments/:tournamentId/register-batch", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    const playerIds = req.body.playerIds ?? [];
    try {
      tournament.registerPlayers(playerIds);
      await persist(tournament);
      return {
        ok: true,
        registeredCount: tournament.getRegisteredCount(),
        prizePoolMojos: tournament.getPrizePoolMojos(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tournamentId: string };
    Body: { targetEntries?: number };
  }>("/v1/tournaments/:tournamentId/fill-house", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.fillHouseSeats(req.body.targetEntries);
      await persist(tournament);
      return {
        ok: true,
        ...result,
        registeredCount: tournament.getRegisteredCount(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tournamentId: string };
    Body: { playerId: string };
  }>("/v1/tournaments/:tournamentId/reenter", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.reenter(req.body.playerId);
      indexTables(tournament);
      await persist(tournament);
      return { ok: true, ...result, prizePoolMojos: tournament.getPrizePoolMojos() };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId/start",
    async (req, reply) => {
      const tournament = tournaments.get(req.params.tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: "Tournament not found" });
      }
      try {
        const result = tournament.start();
        indexTables(tournament);
        await persist(tournament);
        return {
          ok: true,
          ...result,
          tableIds: tournament.listOpenTableIds(),
          summary: tournament.getSummary(),
        };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tournamentId: string };
    Body: { playerId: string };
  }>("/v1/tournaments/:tournamentId/eliminate", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.eliminatePlayer(req.body.playerId);
      indexTables(tournament);
      await persist(tournament);
      const summary = tournament.getSummary();
      return {
        ok: true,
        ...result,
        snapshot: {
          status: summary.status,
          activeCount: summary.activeCount,
          tableCount: summary.tableCount,
          winnerId: summary.winnerId,
          prizePoolMojos: summary.prizePoolMojos,
          handForHandActive: summary.handForHandActive,
        },
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId/blind-up",
    async (req, reply) => {
      const tournament = tournaments.get(req.params.tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: "Tournament not found" });
      }
      if (tournament.getStatus() !== "running" && tournament.getStatus() !== "final_table") {
        return reply.status(400).send({ error: "Tournament is not running" });
      }
      const level = tournament.advanceBlindLevel();
      await persist(tournament);
      return {
        ok: true,
        level,
        lateRegOpen: tournament.isLateRegOpen(),
        handForHand: tournament.getHandForHandState(),
      };
    },
  );

  app.post<{
    Params: { tournamentId: string; tableId: string };
  }>("/v1/tournaments/:tournamentId/tables/:tableId/hand-complete", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.reportHandComplete(req.params.tableId);
      await persist(tournament);
      return { ok: true, ...result };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { tournamentId: string; tableId: string } }>(
    "/v1/tournaments/:tournamentId/tables/:tableId",
    async (req, reply) => {
      const tournament = tournaments.get(req.params.tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: "Tournament not found" });
      }
      const engine = tournament.getTableEngine(req.params.tableId);
      if (!engine) {
        return reply.status(404).send({ error: "Table not found or closed" });
      }
      return {
        tournamentId: req.params.tournamentId,
        tableId: req.params.tableId,
        canDeal: tournament.canDealNextHand(req.params.tableId),
        players: engine.getActivePlayerCount(),
        handInProgress: engine.isHandInProgress(),
        seats: engine.getSeatedPlayers().map((s) => ({
          ...s,
          isHouse: isHousePlayerId(s.playerId),
        })),
        hand: engine.getHandState(),
        lastHandResult: engine.getLastHandResult(),
        config: engine.getConfig(),
      };
    },
  );
}
