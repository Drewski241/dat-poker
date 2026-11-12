import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { generateServerSeed, type PlayerAction } from "@dat-poker/game-engine";
import { runHouseTurn } from "../house-turn.js";
import { accountSitAndGoHand, prepareSitAndGoHand } from "../sit-and-go.js";
import { commitTable, getTableEngine, getTableRecord } from "./tables.js";

export function registerHandRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tableId: string }; Body: { handId?: string } }>(
    "/v1/tables/:tableId/hands/start",
    async (req, reply) => {
      const record = getTableRecord(req.params.tableId);
      const table = record?.engine;
      if (!record || !table) return reply.status(404).send({ error: "Table not found" });
      try {
        prepareSitAndGoHand(record);
        const handId = req.body.handId ?? randomUUID();
        const { commitHash } = table.startHand(handId);
        commitTable(req.params.tableId);
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
      commitTable(req.params.tableId);
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
      try {
        const pending = table.getHandState();
        if (pending) {
          for (const player of pending.players) {
            if (!pending.playerSeeds[player.playerId]) {
              table.submitPlayerSeed(player.playerId, generateServerSeed());
            }
          }
        }
        table.revealAndDeal();
        const houseActions = runHouseTurn(table);
        const record = getTableRecord(req.params.tableId);
        if (record) accountSitAndGoHand(record);
        commitTable(req.params.tableId);
        return {
          ok: true,
          hand: table.getPublicHandState(req.body?.playerId ?? null),
          lastHandResult: table.getLastHandResult(),
          houseActions,
          buttonSeat: table.getButtonSeat(),
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
      const houseActions = runHouseTurn(table);
      const record = getTableRecord(req.params.tableId);
      if (record) accountSitAndGoHand(record);
      commitTable(req.params.tableId);
      return {
        ok: true,
        hand: table.getPublicHandState(req.body.playerId),
        lastHandResult: table.getLastHandResult(),
        houseActions,
        buttonSeat: table.getButtonSeat(),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
