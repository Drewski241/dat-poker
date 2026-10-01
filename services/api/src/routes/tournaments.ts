import type { FastifyInstance } from "fastify";
import { TournamentEngine } from "@dat-poker/tournament-engine";

const tournaments = new Map<string, TournamentEngine>();

export function getTournament(id: string): TournamentEngine | undefined {
  return tournaments.get(id);
}

export function registerTournamentRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      name?: string;
      format?: "sng" | "mtt";
      maxSeats?: number;
      maxEntries?: number;
      minEntries?: number;
      buyInMojos?: string;
      startingStackMojos?: string;
    };
  }>("/v1/tournaments", async (req) => {
    const tournament = new TournamentEngine({
      name: req.body.name ?? "DAT Tournament",
      format: req.body.format ?? "mtt",
      maxSeats: req.body.maxSeats ?? 8,
      maxEntries: req.body.maxEntries,
      minEntries: req.body.minEntries,
      buyInMojos: req.body.buyInMojos ? BigInt(req.body.buyInMojos) : undefined,
      startingStackMojos: req.body.startingStackMojos
        ? BigInt(req.body.startingStackMojos)
        : undefined,
    });
    tournaments.set(tournament.getId(), tournament);
    return {
      tournamentId: tournament.getId(),
      config: tournament.getConfig(),
      status: tournament.getStatus(),
    };
  });

  app.get("/v1/tournaments", async () => {
    const list = [...tournaments.values()].map((t) => {
      const snap = t.getSnapshot();
      return {
        tournamentId: snap.id,
        name: snap.name,
        format: snap.format,
        status: snap.status,
        registeredCount: snap.registeredCount,
        activeCount: snap.activeCount,
        tableCount: snap.tableCount,
        maxSeats: snap.maxSeats,
      };
    });
    return { tournaments: list };
  });

  app.get<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId",
    async (req, reply) => {
      const tournament = tournaments.get(req.params.tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: "Tournament not found" });
      }
      return tournament.getSnapshot();
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
      tournament.registerPlayer(req.body.playerId);
      return {
        ok: true,
        registeredCount: tournament.getRegisteredCount(),
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
      return {
        ok: true,
        registeredCount: tournament.getRegisteredCount(),
      };
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
        return {
          ok: true,
          ...result,
          snapshot: tournament.getSnapshot(),
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
      return {
        ok: true,
        ...result,
        snapshot: {
          status: tournament.getStatus(),
          activeCount: tournament.getActiveCount(),
          tableCount: tournament.getSnapshot().tableCount,
          winnerId: tournament.getSnapshot().winnerId,
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
      return { ok: true, level };
    },
  );

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
