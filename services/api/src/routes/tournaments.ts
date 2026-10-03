import type { FastifyInstance } from "fastify";
import {
  createTournamentStore,
  TournamentEngine,
  type TournamentStore,
} from "@dat-poker/tournament-engine";

const tournaments = new Map<string, TournamentEngine>();
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

export function getTournament(id: string): TournamentEngine | undefined {
  return tournaments.get(id);
}

export async function initTournamentStore(): Promise<void> {
  const created = await createTournamentStore(process.env.DATABASE_URL);
  store = created.store;
  storeKind = created.kind;
  // Hydrate in-memory map from store
  for (const id of await store.listIds()) {
    const raw = await store.load(id);
    if (raw) {
      tournaments.set(id, TournamentEngine.fromExportedState(raw));
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
    Body: { playerId: string };
  }>("/v1/tournaments/:tournamentId/reenter", async (req, reply) => {
    const tournament = tournaments.get(req.params.tournamentId);
    if (!tournament) {
      return reply.status(404).send({ error: "Tournament not found" });
    }
    try {
      const result = tournament.reenter(req.body.playerId);
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
        await persist(tournament);
        return {
          ok: true,
          ...result,
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
        seats: engine.getSeatedPlayers(),
        hand: engine.getHandState(),
        lastHandResult: engine.getLastHandResult(),
        config: engine.getConfig(),
      };
    },
  );
}
