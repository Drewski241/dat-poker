import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import {
  DEFAULT_MAX_SEATS,
  HOUSE_PLAYER_ID,
  buildDefaultTableConfig,
  createOpenTableWithHouse,
  findJoinableTableId,
  findOpenSeatIndex,
  findPlayerSeat,
  summarizeOpenTables,
} from "../open-tables.js";
import { seatPlayerWithBuyIn } from "../table-seating.js";
import { type BuyInProof, readDatTokenConfig } from "../wallet-config.js";

const tables = new Map<string, NlheTableEngine>();

function resolveDefaultBuyInMojos(): bigint {
  const dat = readDatTokenConfig();
  return dat.assetId
    ? resolveDatMinBuyInMojos(dat.minBuyInMojos)
    : DAT_TABLE_DEFAULTS.minBuyInMojos;
}

export function registerTableRoutes(app: FastifyInstance): void {
  app.get("/v1/tables", async () => ({
    tables: summarizeOpenTables(tables),
  }));

  app.post<{ Body: { playerId: string; buyInMojos?: string } }>(
    "/v1/tables/join-open/preview",
    async (req, reply) => {
      const { playerId } = req.body;
      if (!playerId) {
        return reply.status(400).send({ error: "playerId required" });
      }

      const buyInMojos = req.body.buyInMojos ?? resolveDefaultBuyInMojos().toString();
      const existingSeat = findPlayerSeat(tables, playerId);
      if (existingSeat) {
        return {
          tableId: existingSeat.tableId,
          seatIndex: existingSeat.seatIndex,
          buyInMojos,
          alreadySeated: true,
          createdTable: false,
        };
      }

      let tableId = findJoinableTableId(tables);
      let createdTable = false;
      let table: NlheTableEngine;

      if (tableId) {
        table = tables.get(tableId)!;
      } else {
        tableId = randomUUID();
        table = createOpenTableWithHouse(tables, tableId, BigInt(buyInMojos));
        createdTable = true;
      }

      const seatIndex = findOpenSeatIndex(table);
      if (seatIndex === null) {
        if (createdTable) {
          tables.delete(tableId);
        }
        return reply.status(409).send({ error: "No open seats at the public table" });
      }

      return {
        tableId,
        seatIndex,
        buyInMojos,
        alreadySeated: false,
        createdTable,
      };
    },
  );

  app.post<{
    Body: {
      playerId: string;
      tableId?: string;
      seatIndex?: number;
      buyInMojos?: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/join-open", async (req, reply) => {
    const { playerId, buyInProof, devAck } = req.body;
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }

    const buyInMojos = req.body.buyInMojos ?? resolveDefaultBuyInMojos().toString();
    const existingSeat = findPlayerSeat(tables, playerId);
    if (existingSeat) {
      return {
        ok: true,
        tableId: existingSeat.tableId,
        seatIndex: existingSeat.seatIndex,
        alreadySeated: true,
        createdTable: false,
      };
    }

    let tableId: string;
    let seatIndex: number;
    let createdTable = false;
    let table: NlheTableEngine;

    if (req.body.tableId !== undefined && req.body.seatIndex !== undefined) {
      tableId = req.body.tableId;
      seatIndex = req.body.seatIndex;
      const existingTable = tables.get(tableId);
      if (!existingTable) {
        return reply.status(404).send({ error: "Table not found" });
      }
      table = existingTable;
      const openSeat = findOpenSeatIndex(table);
      if (openSeat === null || openSeat !== seatIndex) {
        return reply.status(409).send({ error: "Seat no longer available — try again" });
      }
    } else {
      const joinableId = findJoinableTableId(tables);
      if (joinableId) {
        tableId = joinableId;
        table = tables.get(tableId)!;
      } else {
        tableId = randomUUID();
        table = createOpenTableWithHouse(tables, tableId, BigInt(buyInMojos));
        createdTable = true;
      }

      const openSeat = findOpenSeatIndex(table);
      if (openSeat === null) {
        if (createdTable) {
          tables.delete(tableId);
        }
        return reply.status(409).send({ error: "No open seats at the public table" });
      }
      seatIndex = openSeat;
    }

    const seatResult = seatPlayerWithBuyIn(table, {
      tableId,
      playerId,
      seatIndex,
      buyInMojos,
      buyInProof,
      devAck,
    });
    if (!seatResult.ok) {
      if (createdTable) {
        tables.delete(tableId);
      }
      return reply.status(seatResult.status).send({ error: seatResult.error });
    }

    return {
      ok: true,
      tableId,
      seatIndex,
      alreadySeated: false,
      createdTable,
    };
  });

  app.post<{
    Body: {
      variant?: string;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      maxSeats?: number;
    };
  }>("/v1/tables", async (req) => {
    const id = randomUUID();
    const config = buildDefaultTableConfig(id, req.body.maxSeats ?? DEFAULT_MAX_SEATS);
    if (req.body.smallBlindMojos) {
      config.smallBlindMojos = BigInt(req.body.smallBlindMojos);
    }
    if (req.body.bigBlindMojos) {
      config.bigBlindMojos = BigInt(req.body.bigBlindMojos);
    }
    tables.set(id, new NlheTableEngine(config));
    return { tableId: id, config: config as TableConfig };
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

    const seatResult = seatPlayerWithBuyIn(table, {
      tableId: req.params.tableId,
      playerId: req.body.playerId,
      seatIndex: req.body.seatIndex,
      buyInMojos: req.body.buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (!seatResult.ok) {
      return reply.status(seatResult.status).send({ error: seatResult.error });
    }
    return { ok: true };
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const buyInMojos = BigInt(req.body.buyInMojos ?? resolveDefaultBuyInMojos().toString());
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

export { HOUSE_PLAYER_ID };
