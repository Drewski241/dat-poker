import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { HOUSE_PLAYER_ID, isHousePlayer, NlheTableEngine } from "@dat-poker/game-engine";
import { recordBuyIn } from "../buy-in-store.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

interface TableRecord {
  engine: NlheTableEngine;
  names: Map<string, string>;
}

const tables = new Map<string, TableRecord>();

function seatView(record: TableRecord) {
  return record.engine.getSeatedPlayers().map((seat) => ({
    ...seat,
    displayName: record.names.get(seat.playerId) ?? seat.playerId,
  }));
}

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
    const useDatStakes = Boolean(dat.assetId) || dat.devBuyInEnabled;
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
    tables.set(id, { engine: new NlheTableEngine(config), names: new Map() });
    return { tableId: id, config };
  });

  app.get("/v1/tables", async () => ({
    tables: [...tables.entries()].map(([tableId, record]) => ({
      tableId,
      maxSeats: record.engine.getMaxSeats(),
      seated: record.engine.getActivePlayerCount(),
      smallBlindMojos: record.engine.getSmallBlindMojos(),
      bigBlindMojos: record.engine.getBigBlindMojos(),
      buttonSeat: record.engine.getButtonSeat(),
    })),
  }));

  app.get<{ Params: { tableId: string }; Querystring: { playerId?: string } }>(
    "/v1/tables/:tableId",
    async (req, reply) => {
      const record = tables.get(req.params.tableId);
      if (!record) {
        return reply.status(404).send({ error: "Table not found" });
      }
      const table = record.engine;
      return {
        tableId: req.params.tableId,
        maxSeats: table.getMaxSeats(),
        buttonSeat: table.getButtonSeat(),
        players: table.getActivePlayerCount(),
        handInProgress: table.isHandInProgress(),
        seats: seatView(record),
        hand: table.getPublicHandState(req.query.playerId ?? null),
        lastHandResult: table.getLastHandResult(),
      };
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: {
      playerId: string;
      seatIndex: number;
      buyInMojos: string;
      displayName?: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/:tableId/seat", async (req, reply) => {
    const record = tables.get(req.params.tableId);
    if (!record) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const table = record.engine;

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos);
    const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);

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
      table.seatPlayer(req.body.playerId, req.body.seatIndex, buyInMojos);
      const name = req.body.displayName?.trim();
      record.names.set(req.body.playerId, name && name.length > 0 ? name.slice(0, 18) : req.body.playerId);
      return { ok: true };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string; seatIndex?: number };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const record = tables.get(req.params.tableId);
    if (!record) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const table = record.engine;
    const seated = table.getSeatedPlayers();
    let seatIndex = req.body.seatIndex;
    if (seatIndex === undefined) {
      for (let seat = 0; seat < table.getMaxSeats(); seat++) {
        if (!seated.some((player) => player.seatIndex === seat)) {
          seatIndex = seat;
          break;
        }
      }
    }
    if (seatIndex === undefined) {
      return reply.status(400).send({ error: "No open seat" });
    }
    const houseCount = seated.filter((player) => isHousePlayer(player.playerId)).length;
    const playerId = houseCount === 0 ? HOUSE_PLAYER_ID : `${HOUSE_PLAYER_ID}:${houseCount + 1}`;
    const buyInMojos = BigInt(req.body.buyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString());
    try {
      table.seatPlayer(playerId, seatIndex, buyInMojos);
      record.names.set(playerId, houseCount === 0 ? "House" : `House ${houseCount + 1}`);
      return { ok: true, playerId, seatIndex, displayName: record.names.get(playerId) };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId)?.engine;
}
