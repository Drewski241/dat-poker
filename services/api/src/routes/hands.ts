import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { generateServerSeed, type NlheTableEngine, type PlayerAction } from "@dat-poker/game-engine";
import { getTableEngine } from "./tables.js";
import { playHouseIfDue } from "../house-play.js";
import { redactHandForViewer } from "../redact-hand.js";
import { requirePlayer, sessionMatchesClaim, type PlayerSession } from "../player-session.js";

function seatedPlayer(
  req: FastifyRequest,
  reply: FastifyReply,
  table: NlheTableEngine,
  claimed?: string,
): PlayerSession | null {
  const session = requirePlayer(req, reply);
  if (!session) return null;
  if (!sessionMatchesClaim(session, claimed)) {
    void reply.status(403).send({ error: "playerId does not match the signed Sage session" });
    return null;
  }
  if (!table.hasPlayer(session.playerId)) {
    void reply.status(403).send({ error: "You are not seated at this table" });
    return null;
  }
  return session;
}

export function registerHandRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tableId: string }; Body: { handId?: string; playerId?: string } }>(
    "/v1/tables/:tableId/hands/start",
    async (req, reply) => {
      const table = getTableEngine(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      const session = seatedPlayer(req, reply, table, req.body.playerId);
      if (!session) return;
      try {
        const handId = req.body.handId ?? randomUUID();
        const { commitHash } = table.startHand(handId);
        return { handId, commitHash, phase: "awaiting_seeds" };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string };
  }>("/v1/tables/:tableId/hands/go", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const session = seatedPlayer(req, reply, table, req.body.playerId);
    if (!session) return;
    try {
      const handId = randomUUID();
      const { commitHash } = table.startHand(handId);
      for (const seated of table.getSeatedPlayers()) {
        table.submitPlayerSeed(seated.playerId, generateServerSeed());
      }
      table.revealAndDeal();
      playHouseIfDue(table);
      return {
        ok: true,
        handId,
        commitHash,
        hand: redactHandForViewer(table.getHandState(), session.playerId),
        lastHandResult: table.getLastHandResult(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string; seed?: string };
  }>("/v1/tables/:tableId/hands/seed", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const session = seatedPlayer(req, reply, table, req.body.playerId);
    if (!session) return;
    try {
      table.submitPlayerSeed(session.playerId, req.body.seed ?? generateServerSeed());
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tableId: string }; Body: { playerId?: string } }>(
    "/v1/tables/:tableId/hands/deal",
    async (req, reply) => {
      const table = getTableEngine(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      const session = seatedPlayer(req, reply, table, req.body.playerId);
      if (!session) return;
      try {
        table.revealAndDeal();
        playHouseIfDue(table);
        return {
          ok: true,
          hand: redactHandForViewer(table.getHandState(), session.playerId),
        };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string; action: PlayerAction; amountMojos?: string };
  }>("/v1/tables/:tableId/hands/action", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    const session = seatedPlayer(req, reply, table, req.body.playerId);
    if (!session) return;
    try {
      const amount = req.body.amountMojos ? BigInt(req.body.amountMojos) : 0n;
      table.applyAction(session.playerId, req.body.action, amount);
      playHouseIfDue(table);
      return {
        ok: true,
        hand: redactHandForViewer(table.getHandState(), session.playerId),
        lastHandResult: table.getLastHandResult(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
