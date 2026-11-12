import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { VideoPokerTable } from "@dat-poker/game-engine";
import { DAT_TABLE_DEFAULTS, DEFAULT_CASINO_LOSS_LIMIT_MOJOS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { loadVideoPokerTables, saveVideoPokerTables } from "../video-poker-store.js";
import { readDatTokenConfig } from "../wallet-config.js";

const tables = new Map<string, VideoPokerTable>();
const storeFile =
  process.env.DAT_VIDEO_POKER_STORE ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../data/video-poker.json");

function persist(): void {
  saveVideoPokerTables(storeFile, [...tables.values()]);
}

function load(): void {
  try {
    tables.clear();
    for (const table of loadVideoPokerTables(storeFile)) {
      tables.set(table.view().tableId, table);
    }
  } catch (error) {
    console.error("Could not load saved video poker tables", error);
  }
}

load();

export function registerVideoPokerRoutes(app: FastifyInstance): void {
  app.post<{
    Body: { playerId?: string; displayName?: string; buyInMojos?: string };
  }>("/v1/video-poker", async (req, reply) => {
    const dat = readDatTokenConfig();
    if (!dat.devBuyInEnabled) {
      return reply.status(400).send({ error: "Wallet buy-in proof required" });
    }
    const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);
    const buyIn = BigInt(req.body.buyInMojos ?? minBuyIn.toString());
    if (buyIn < minBuyIn) {
      return reply.status(400).send({ error: "Buy-in below minimum" });
    }
    const playerId = req.body.playerId?.trim() || `practice-${randomUUID().slice(0, 8)}`;
    const name = req.body.displayName?.trim();
    const table = new VideoPokerTable({
      id: randomUUID(),
      playerId,
      displayName: name && name.length > 0 ? name.slice(0, 18) : "Player",
      stackMojos: buyIn,
      coinMojos: DAT_TABLE_DEFAULTS.bigBlindMojos,
      lossLimitMojos: DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
    });
    tables.set(table.view().tableId, table);
    persist();
    return table.view();
  });

  app.get<{ Params: { tableId: string } }>("/v1/video-poker/:tableId", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    return table.view();
  });

  app.post<{ Params: { tableId: string }; Body: { lossLimitMojos?: string | null } }>(
    "/v1/video-poker/:tableId/limit",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      if (!req.body || !("lossLimitMojos" in req.body)) {
        return reply.status(400).send({ error: "Choose a session limit" });
      }
      try {
        const raw = req.body.lossLimitMojos;
        table.setLossLimit(raw == null || raw === "" ? null : BigInt(raw));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
      persist();
      return table.view();
    },
  );

  app.post<{ Params: { tableId: string }; Body: { coins?: number } }>(
    "/v1/video-poker/:tableId/deal",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      try {
        table.deal(Number(req.body.coins ?? 1));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
      persist();
      return table.view();
    },
  );

  app.post<{ Params: { tableId: string }; Body: { index?: number } }>(
    "/v1/video-poker/:tableId/hold",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      try {
        table.toggleHold(Number(req.body.index));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
      persist();
      return table.view();
    },
  );

  app.post<{ Params: { tableId: string } }>("/v1/video-poker/:tableId/draw", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    try {
      table.draw();
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
    persist();
    return table.view();
  });
}
