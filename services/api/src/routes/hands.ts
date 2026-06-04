import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { generateServerSeed, type PlayerAction } from "@dat-poker/game-engine";
import { getTableEngine } from "./tables.js";

export function registerHandRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tableId: string }; Body: { handId?: string } }>(
    "/v1/tables/:tableId/hands/start",
    async (req, reply) => {
      const table = getTableEngine(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
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
    Body: { playerId: string; seed?: string };
  }>("/v1/tables/:tableId/hands/seed", async (req, reply) => {
    const table = getTableEngine(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    try {
      table.submitPlayerSeed(req.body.playerId, req.body.seed ?? generateServerSeed());
      return { ok: true };
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
        table.revealAndDeal();
        return { ok: true, hand: table.getHandState() };
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
      return {
        ok: true,
        hand: table.getHandState(),
        lastHandResult: table.getLastHandResult(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
