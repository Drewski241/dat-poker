import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { generateServerSeed, type PlayerAction } from "@dat-poker/game-engine";
import { getTableSession } from "./tables.js";
import { finalizeIfHandOver, playHouseActors, seedHousePlayers } from "../table-session.js";

export function registerHandRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tableId: string }; Body: { handId?: string } }>(
    "/v1/tables/:tableId/hands/start",
    async (req, reply) => {
      const session = getTableSession(req.params.tableId);
      if (!session) return reply.status(404).send({ error: "Table not found" });
      try {
        if (session.sng) {
          if (session.sng.getStatus() === "registering") {
            return reply.status(400).send({ error: "SNG has not started" });
          }
          if (session.sng.getStatus() === "finished") {
            return reply.status(400).send({ error: "SNG is finished" });
          }
          session.sng.onHandStarted();
        }
        const handId = req.body.handId ?? randomUUID();
        const { commitHash } = session.engine.startHand(handId);
        seedHousePlayers(session.engine);
        return { handId, commitHash, phase: "awaiting_seeds" };
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: { playerId: string; seed?: string };
  }>("/v1/tables/:tableId/hands/seed", async (req, reply) => {
    const session = getTableSession(req.params.tableId);
    if (!session) return reply.status(404).send({ error: "Table not found" });
    try {
      session.engine.submitPlayerSeed(req.body.playerId, req.body.seed ?? generateServerSeed());
      seedHousePlayers(session.engine);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tableId: string } }>(
    "/v1/tables/:tableId/hands/deal",
    async (req, reply) => {
      const session = getTableSession(req.params.tableId);
      if (!session) return reply.status(404).send({ error: "Table not found" });
      try {
        seedHousePlayers(session.engine);
        session.engine.revealAndDeal();
        playHouseActors(session);
        finalizeIfHandOver(session);
        return {
          ok: true,
          hand: session.engine.getHandState(),
          lastHandResult: session.engine.getLastHandResult(),
          sng: session.sng?.snapshot() ?? null,
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
    const session = getTableSession(req.params.tableId);
    if (!session) return reply.status(404).send({ error: "Table not found" });
    try {
      const amount = req.body.amountMojos ? BigInt(req.body.amountMojos) : 0n;
      session.engine.applyAction(req.body.playerId, req.body.action, amount);
      playHouseActors(session);
      finalizeIfHandOver(session);
      return {
        ok: true,
        hand: session.engine.getHandState(),
        lastHandResult: session.engine.getLastHandResult(),
        sng: session.sng?.snapshot() ?? null,
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
