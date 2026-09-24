import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig, TableFormat } from "@dat-poker/shared";
import {
  DAT_SNG_DEFAULTS,
  DAT_TABLE_DEFAULTS,
  HOUSE_PLAYER_ID,
  resolveDatMinBuyInMojos,
} from "@dat-poker/shared";
import { NlheTableEngine, SngTournament } from "@dat-poker/game-engine";
import { recordBuyIn } from "../buy-in-store.js";
import { tableConfigPayload, type TableSession } from "../table-session.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

const sessions = new Map<string, TableSession>();

function readFillHouseDefault(): boolean {
  const raw = process.env.DAT_SNG_FILL_HOUSE?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

export function registerTableRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      variant?: string;
      format?: TableFormat;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      maxSeats?: number;
      fillHouse?: boolean;
      minHumansToStart?: number;
    };
  }>("/v1/tables", async (req) => {
    const id = randomUUID();
    const dat = readDatTokenConfig();
    const useDatStakes = Boolean(dat.assetId);
    const format: TableFormat = req.body.format === "sng" ? "sng" : "cash";

    if (format === "sng") {
      const fillHouse = req.body.fillHouse ?? readFillHouseDefault();
      const minHumansToStart = req.body.minHumansToStart ?? (fillHouse ? 1 : DAT_SNG_DEFAULTS.maxSeats);
      const sng = SngTournament.create(id, {
        fillHouse,
        minHumansToStart,
        maxSeats: req.body.maxSeats ?? DAT_SNG_DEFAULTS.maxSeats,
      });
      sessions.set(id, { engine: sng.engine, sng });
      return {
        tableId: id,
        config: tableConfigPayload(sng.engine.getConfig()),
        sng: sng.snapshot(),
      };
    }

    const minBuyIn = useDatStakes
      ? resolveDatMinBuyInMojos(dat.minBuyInMojos)
      : DAT_TABLE_DEFAULTS.minBuyInMojos;
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
    sessions.set(id, { engine: new NlheTableEngine(config), sng: null });
    return { tableId: id, config: tableConfigPayload(config), sng: null };
  });

  app.get<{ Params: { tableId: string } }>("/v1/tables/:tableId", async (req, reply) => {
    const session = sessions.get(req.params.tableId);
    if (!session) {
      return reply.status(404).send({ error: "Table not found" });
    }
    return serializeTable(req.params.tableId, session);
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
    const session = sessions.get(req.params.tableId);
    if (!session) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (session.sng && session.sng.getStatus() !== "registering") {
      return reply.status(400).send({ error: "SNG registration is closed" });
    }

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos);
    const minBuyIn = session.sng
      ? session.sng.startingStackMojos
      : resolveDatMinBuyInMojos(dat.minBuyInMojos);

    if (buyInMojos < minBuyIn) {
      return reply.status(400).send({
        error: `Buy-in below minimum (${minBuyIn.toString()} mojos)`,
      });
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
      session.engine.seatPlayer(req.body.playerId, req.body.seatIndex, buyInMojos);
      autoFillAndStart(session);
      return { ok: true, ...serializeTable(req.params.tableId, session) };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const session = sessions.get(req.params.tableId);
    if (!session) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const buyInMojos = BigInt(req.body.buyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString());
    try {
      if (session.sng) {
        const filled = session.sng.fillHouseSeats();
        autoFillAndStart(session);
        return { ok: true, playerId: filled[0] ?? HOUSE_PLAYER_ID, filled, ...serializeTable(req.params.tableId, session) };
      }
      session.engine.seatPlayer(HOUSE_PLAYER_ID, 1, buyInMojos);
      return { ok: true, playerId: HOUSE_PLAYER_ID };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { tableId: string } }>("/v1/tables/:tableId/fill-house", async (req, reply) => {
    const session = sessions.get(req.params.tableId);
    if (!session?.sng) {
      return reply.status(session ? 400 : 404).send({ error: session ? "Not an SNG" : "Table not found" });
    }
    try {
      const filled = session.sng.fillHouseSeats();
      autoFillAndStart(session);
      return { ok: true, filled, ...serializeTable(req.params.tableId, session) };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}

function autoFillAndStart(session: TableSession): void {
  const sng = session.sng;
  if (!sng || sng.getStatus() !== "registering") return;
  if (sng.fillHouse) {
    sng.fillHouseSeats();
  }
  if (sng.canStart()) {
    sng.start();
  }
}

function serializeTable(tableId: string, session: TableSession) {
  return {
    tableId,
    format: session.engine.getConfig().format,
    config: tableConfigPayload(session.engine.getConfig()),
    players: session.engine.getActivePlayerCount(),
    handInProgress: session.engine.isHandInProgress(),
    seats: session.engine.getSeatedPlayers(),
    hand: session.engine.getHandState(),
    lastHandResult: session.engine.getLastHandResult(),
    sng: session.sng?.snapshot() ?? null,
  };
}

export function getTableSession(tableId: string): TableSession | undefined {
  return sessions.get(tableId);
}

export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return sessions.get(tableId)?.engine;
}
