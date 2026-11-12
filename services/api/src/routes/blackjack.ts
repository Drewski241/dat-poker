import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { BlackjackTable } from "@dat-poker/game-engine";
import { DAT_TABLE_DEFAULTS, DEFAULT_CASINO_LOSS_LIMIT_MOJOS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { loadBlackjackTables, saveBlackjackTables } from "../blackjack-store.js";
import { readDatTokenConfig } from "../wallet-config.js";

const tables = new Map<string, BlackjackTable>();
const storeFile =
  process.env.DAT_BLACKJACK_STORE ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../data/blackjack.json");

function persist(): void {
  saveBlackjackTables(storeFile, [...tables.values()]);
}

function load(): void {
  try {
    tables.clear();
    for (const table of loadBlackjackTables(storeFile)) {
      tables.set(table.view().tableId, table);
    }
  } catch (error) {
    console.error("Could not load saved blackjack tables", error);
  }
}

load();

export function registerBlackjackRoutes(app: FastifyInstance): void {
  app.post<{
    Body: { playerId?: string; displayName?: string; buyInMojos?: string };
  }>("/v1/blackjack", async (req, reply) => {
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
    const table = new BlackjackTable({
      id: randomUUID(),
      playerId,
      displayName: name && name.length > 0 ? name.slice(0, 18) : "Player",
      stackMojos: buyIn,
      minBetMojos: DAT_TABLE_DEFAULTS.bigBlindMojos,
      maxBetMojos: 500_000n,
      lossLimitMojos: DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
    });
    tables.set(table.view().tableId, table);
    persist();
    return table.view();
  });

  app.get<{ Params: { tableId: string } }>("/v1/blackjack/:tableId", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) return reply.status(404).send({ error: "Table not found" });
    return table.view();
  });

  app.post<{ Params: { tableId: string }; Body: { lossLimitMojos?: string | null } }>(
    "/v1/blackjack/:tableId/limit",
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

  app.post<{ Params: { tableId: string }; Body: { amountMojos?: string } }>(
    "/v1/blackjack/:tableId/bet",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      try {
        table.placeBet(BigInt(req.body.amountMojos ?? "0"));
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
      persist();
      return table.view();
    },
  );

  app.post<{ Params: { tableId: string; action: string } }>(
    "/v1/blackjack/:tableId/:action",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) return reply.status(404).send({ error: "Table not found" });
      try {
        if (req.params.action === "hit") table.hit();
        else if (req.params.action === "stand") table.stand();
        else if (req.params.action === "double") table.double();
        else if (req.params.action === "split") table.split();
        else return reply.status(400).send({ error: "Unknown action" });
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
      persist();
      return table.view();
    },
  );
}
