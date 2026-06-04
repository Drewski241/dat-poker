import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import { recordBuyIn } from "../buy-in-store.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

const tables = new Map<string, NlheTableEngine>();
const HOUSE_PLAYER_ID = "dat-poker:house";

export function registerTableRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      variant?: string;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      maxSeats?: number;
    };
  }>("/v1/tables", async (req) => {
    const id = randomUUID();
    const dat = readDatTokenConfig();
    const useDatStakes = Boolean(dat.assetId);
    const minBuyIn = useDatStakes
      ? BigInt(dat.minBuyInMojos)
      : 2_000_000_000_000n;
    const config: TableConfig = {
      id,
      variant: "nlhe",
      format: "cash",
      maxSeats: req.body.maxSeats ?? 6,
      smallBlindMojos: BigInt(
        req.body.smallBlindMojos ??
          (useDatStakes ? DAT_TABLE_DEFAULTS.smallBlindMojos : 50_000_000_000n),
      ),
      bigBlindMojos: BigInt(
        req.body.bigBlindMojos ??
          (useDatStakes ? DAT_TABLE_DEFAULTS.bigBlindMojos : 100_000_000_000n),
      ),
      minBuyInMojos: minBuyIn,
      maxBuyInMojos: useDatStakes ? DAT_TABLE_DEFAULTS.maxBuyInMojos : 20_000_000_000_000n,
      rakeBps: 500,
    };
    tables.set(id, new NlheTableEngine(config));
    return { tableId: id, config };
  });

  app.get<{ Params: { tableId: string } }>("/v1/tables/:tableId", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    return {
      tableId: req.params.tableId,
      players: table.getActivePlayerCount(),
      handInProgress: table.isHandInProgress(),
      seats: table.getSeatedPlayers(),
      hand: table.getHandState(),
      lastHandResult: table.getLastHandResult(),
    };
  });

  app.post<{
    Params: { tableId: string };
    Body: {
      playerId: string;
      seatIndex: number;
      buyInMojos: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/:tableId/seat", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos);
    const minBuyIn = BigInt(dat.minBuyInMojos);

    if (buyInMojos < minBuyIn) {
      return reply.status(400).send({ error: `Buy-in below minimum (${dat.minBuyInMojos} mojos)` });
    }

    if (!dat.devBuyInEnabled) {
      if (!dat.assetId) {
        return reply.status(503).send({ error: "DAT token not configured" });
      }
      if (!req.body.buyInProof) {
        return reply.status(400).send({ error: "Wallet buy-in proof required" });
      }
      const proofError = validateBuyInProof(req.body.buyInProof, {
        tableId: req.params.tableId,
        seatIndex: req.body.seatIndex,
        buyInMojos: req.body.buyInMojos,
        playerId: req.body.playerId,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
      if (req.body.buyInProof.datBalanceMojos) {
        const balance = BigInt(req.body.buyInProof.datBalanceMojos);
        if (balance < buyInMojos) {
          return reply.status(400).send({ error: "Insufficient DAT balance for buy-in" });
        }
      }
    } else if (!req.body.devAck && dat.assetId && req.body.buyInProof) {
      const proofError = validateBuyInProof(req.body.buyInProof, {
        tableId: req.params.tableId,
        seatIndex: req.body.seatIndex,
        buyInMojos: req.body.buyInMojos,
        playerId: req.body.playerId,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
    }

    const buyInProof = req.body.buyInProof ?? {
      address: req.body.playerId,
      message: "",
      signature: "",
      pubkey: "",
    };
    recordBuyIn(req.params.tableId, req.body.playerId, buyInProof, req.body.buyInMojos);

    try {
      table.seatPlayer(req.body.playerId, req.body.seatIndex, buyInMojos);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const buyInMojos = BigInt(req.body.buyInMojos ?? "5000000000000");
    try {
      table.seatPlayer(HOUSE_PLAYER_ID, 1, buyInMojos);
      return { ok: true, playerId: HOUSE_PLAYER_ID };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId);
}
