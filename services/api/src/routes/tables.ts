import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig, TableFormat } from "@dat-poker/shared";
import {
  DAT_SNG_DEFAULTS,
  DAT_TABLE_DEFAULTS,
  HOUSE_PLAYER_ID,
  isHousePlayerId,
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

  app.get("/v1/tables", async () => ({
    tables: [...sessions.entries()]
      .map(([tableId, session]) => serializeLobbyTable(tableId, session))
      .filter((row) => row.sngStatus !== "finished"),
  }));

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

    const buyInError = validateSeatBuyIn(req.params.tableId, session, {
      playerId: req.body.playerId,
      seatIndex: req.body.seatIndex,
      buyInMojos: req.body.buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyInError) {
      return reply.status(buyInError.status).send({ error: buyInError.error });
    }

    try {
      session.engine.seatPlayer(req.body.playerId, req.body.seatIndex, BigInt(req.body.buyInMojos));
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

  app.post<{
    Params: { tableId: string };
    Body: {
      playerId: string;
      seatIndex?: number;
      buyInMojos: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/:tableId/claim-house", async (req, reply) => {
    const session = sessions.get(req.params.tableId);
    if (!session) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (!req.body.playerId || !req.body.buyInMojos) {
      return reply.status(400).send({ error: "playerId and buyInMojos required" });
    }
    if (isHousePlayerId(req.body.playerId)) {
      return reply.status(400).send({ error: "House bots cannot claim a seat" });
    }

    const previewSeat =
      req.body.seatIndex ?? session.engine.houseSeats()[0]?.seatIndex ?? 0;
    const buyInError = validateSeatBuyIn(req.params.tableId, session, {
      playerId: req.body.playerId,
      seatIndex: previewSeat,
      buyInMojos: req.body.buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyInError) {
      return reply.status(buyInError.status).send({ error: buyInError.error });
    }

    try {
      const claimed = session.sng
        ? session.sng.claimHouseSeat(req.body.playerId, req.body.seatIndex)
        : session.engine.claimHouseSeat(req.body.playerId, req.body.seatIndex);
      return {
        ok: true,
        replacedPlayerId: claimed.replacedPlayerId,
        seatIndex: claimed.seatIndex,
        stackMojos: claimed.stackMojos,
        ...serializeTable(req.params.tableId, session),
      };
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

function validateSeatBuyIn(
  tableId: string,
  session: TableSession,
  body: {
    playerId: string;
    seatIndex: number;
    buyInMojos: string;
    buyInProof?: BuyInProof;
    devAck?: boolean;
  },
): { status: number; error: string } | null {
  const dat = readDatTokenConfig();
  const buyInMojos = BigInt(body.buyInMojos);
  const minBuyIn = session.sng
    ? session.sng.buyInMojos
    : resolveDatMinBuyInMojos(dat.minBuyInMojos);

  if (buyInMojos < minBuyIn) {
    return { status: 400, error: `Buy-in below minimum (${minBuyIn.toString()} mojos)` };
  }

  if (!dat.devBuyInEnabled) {
    if (!dat.assetId) {
      return { status: 503, error: "DAT token not configured" };
    }
    if (!body.buyInProof) {
      return { status: 400, error: "Wallet buy-in proof required" };
    }
    const proofError = validateBuyInProof(body.buyInProof, {
      tableId,
      seatIndex: body.seatIndex,
      buyInMojos: body.buyInMojos,
      playerId: body.playerId,
    });
    if (proofError) {
      return { status: 400, error: proofError };
    }
    if (body.buyInProof.datBalanceMojos) {
      const balance = BigInt(body.buyInProof.datBalanceMojos);
      if (balance < buyInMojos) {
        return { status: 400, error: "Insufficient DAT balance for buy-in" };
      }
    }
  } else if (!body.devAck && dat.assetId && body.buyInProof) {
    const proofError = validateBuyInProof(body.buyInProof, {
      tableId,
      seatIndex: body.seatIndex,
      buyInMojos: body.buyInMojos,
      playerId: body.playerId,
    });
    if (proofError) {
      return { status: 400, error: proofError };
    }
  }

  recordBuyIn(
    tableId,
    body.playerId,
    body.buyInProof ?? {
      address: body.playerId,
      message: "",
      signature: "",
      pubkey: "",
    },
    body.buyInMojos,
  );
  return null;
}

function serializeLobbyTable(tableId: string, session: TableSession) {
  const seats = session.engine.getSeatedPlayers();
  const houseSeats = seats.filter((p) => isHousePlayerId(p.playerId) && p.stackMojos > 0n);
  const humans = seats.filter((p) => !isHousePlayerId(p.playerId));
  return {
    tableId,
    format: session.engine.getConfig().format,
    sngStatus: session.sng?.getStatus() ?? null,
    handInProgress: session.engine.isHandInProgress(),
    players: seats.length,
    humanCount: humans.length,
    houseSeatsAvailable: houseSeats.length,
    buyInMojos: (session.sng?.buyInMojos ?? session.engine.getConfig().minBuyInMojos).toString(),
    smallBlindMojos: session.engine.getConfig().smallBlindMojos.toString(),
    bigBlindMojos: session.engine.getConfig().bigBlindMojos.toString(),
  };
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
