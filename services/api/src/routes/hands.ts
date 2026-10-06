import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  generateServerSeed,
  playHouseUntilHuman,
  submitHouseSeeds,
  type PlayerAction,
} from "@dat-poker/game-engine";
import { getTableEngine } from "./tables.js";
import {
  afterTournamentHandComplete,
  tournamentCanDeal,
} from "./tournaments.js";

async function maybeFinishTournamentHand(tableId: string) {
  const table = getTableEngine(tableId);
  if (!table || table.isHandInProgress()) return undefined;
  return afterTournamentHandComplete(tableId);
}

export function registerHandRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tableId: string }; Body: { handId?: string } }>(
    "/v1/tables/:tableId/hands/start",
    async (req, reply) => {
      const table = getTableEngine(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      const canDeal = tournamentCanDeal(req.params.tableId);
      if (canDeal === false) {
        return reply.status(409).send({
          error: "Hand-for-hand: waiting for other tables to finish",
        });
      }
      try {
        const handId = req.body.handId ?? randomUUID();
        const { commitHash } = table.startHand(handId);
        // Auto-seed house bots so humans only submit their own seed.
        submitHouseSeeds(table, generateServerSeed);
        return { handId, commitHash, phase: "awaiting_seeds" };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: { playerId: string; seed?: string; autoDeal?: boolean };
  }>("/v1/tables/:tableId/hands/seed", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    try {
      table.submitPlayerSeed(req.body.playerId, req.body.seed ?? generateServerSeed());
      submitHouseSeeds(table, generateServerSeed);

      const hand = table.getHandState();
      const allSeeded =
        hand !== null &&
        hand.players.every((p) => Boolean(hand.playerSeeds[p.playerId]));

      let dealt = false;
      if (allSeeded && req.body.autoDeal !== false) {
        // Tournament tables auto-deal once seeds are in; cash can opt out.
        const isTournament = tournamentCanDeal(req.params.tableId) !== null;
        if (isTournament || req.body.autoDeal === true) {
          table.revealAndDeal();
          playHouseUntilHuman(table, "mixed");
          dealt = true;
        }
      }

      const tournamentUpdate = dealt
        ? await maybeFinishTournamentHand(req.params.tableId)
        : undefined;

      return {
        ok: true,
        dealt,
        hand: table.getHandState(),
        lastHandResult: table.getLastHandResult(),
        tournament: tournamentUpdate ?? undefined,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tableId: string } }>(
    "/v1/tables/:tableId/hands/deal",
    async (req, reply) => {
      const table = getTableEngine(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      try {
        submitHouseSeeds(table, generateServerSeed);
        table.revealAndDeal();
        playHouseUntilHuman(table, "mixed");
        const tournamentUpdate = await maybeFinishTournamentHand(req.params.tableId);
        return {
          ok: true,
          hand: table.getHandState(),
          lastHandResult: table.getLastHandResult(),
          tournament: tournamentUpdate ?? undefined,
        };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: { playerId: string; action: PlayerAction; amountMojos?: string };
  }>("/v1/tables/:tableId/hands/action", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    try {
      const amount = req.body.amountMojos ? BigInt(req.body.amountMojos) : 0n;
      table.applyAction(req.body.playerId, req.body.action, amount);
      playHouseUntilHuman(table, "mixed");
      const tournamentUpdate = await maybeFinishTournamentHand(req.params.tableId);
      return {
        ok: true,
        hand: table.getHandState(),
        lastHandResult: table.getLastHandResult(),
        tournament: tournamentUpdate ?? undefined,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
