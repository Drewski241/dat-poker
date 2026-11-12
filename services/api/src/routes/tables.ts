import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import {
  HOUSE_PLAYER_ID,
  isHousePlayer,
  NlheTableEngine,
  sngBlinds,
  SNG_STARTING_STACK_MOJOS,
} from "@dat-poker/game-engine";
import { collectableMojos, freshSitAndGo, playersRemaining, type SitAndGoState } from "../sit-and-go.js";
import { exportBuyIns, recordBuyIn, replaceBuyIns } from "../buy-in-store.js";
import { exportWithdrawals, replaceWithdrawals } from "../withdraw-store.js";
import { loadRoom, saveRoom } from "../table-store.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

interface TableRecord {
  engine: NlheTableEngine;
  names: Map<string, string>;
  sng?: SitAndGoState;
}

const tables = new Map<string, TableRecord>();
const storeFile =
  process.env.DAT_TABLE_STORE ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../data/tables.json");

let onCommit: (tableId: string) => void = () => {};

export function setTableCommitListener(listener: (tableId: string) => void): void {
  onCommit = listener;
}

function persistRoom(): void {
  saveRoom(storeFile, {
    tables: [...tables.entries()].map(([id, record]) => ({
      id,
      names: [...record.names.entries()],
      sng: record.sng ?? null,
      engine: record.engine.toSnapshot(),
    })),
    buyIns: exportBuyIns(),
    withdrawals: exportWithdrawals(),
  });
}

export function commitTable(tableId: string): void {
  persistRoom();
  onCommit(tableId);
}

function loadPersistedRoom(): void {
  try {
    const room = loadRoom(storeFile);
    tables.clear();
    for (const stored of room.tables) {
      tables.set(stored.id, {
        engine: NlheTableEngine.fromSnapshot(stored.engine),
        names: new Map(stored.names),
        sng: stored.sng ?? undefined,
      });
    }
    replaceBuyIns(room.buyIns);
    replaceWithdrawals(room.withdrawals);
  } catch (error) {
    console.error("Could not load saved tables", error);
  }
}

loadPersistedRoom();

function tournamentView(record: TableRecord) {
  if (!record.sng) return null;
  const sng = record.sng;
  return {
    status: sng.status,
    level: sng.levelIndex + 1,
    smallBlindMojos: record.engine.getSmallBlindMojos(),
    bigBlindMojos: record.engine.getBigBlindMojos(),
    handsPlayed: sng.handsPlayed,
    handsPerLevel: sng.handsPerLevel,
    playersLeft: playersRemaining(record.engine),
    entrants: sng.entrants,
    prizeMojos: sng.prizeMojos,
    winnerId: sng.winnerId,
    entryMojos: sng.entryMojos,
    startingStackMojos: sng.startingStackMojos,
  };
}

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
      format?: "cash" | "sng";
    };
  }>("/v1/tables", async (req) => {
    const id = randomUUID();
    const dat = readDatTokenConfig();
    const useDatStakes = Boolean(dat.assetId) || dat.devBuyInEnabled;
    const sitAndGo = req.body.format === "sng";
    const sng = sitAndGo ? freshSitAndGo() : undefined;
    const openingBlinds = sngBlinds(0);
    const minBuyIn = useDatStakes
      ? resolveDatMinBuyInMojos(dat.minBuyInMojos)
      : DAT_TABLE_DEFAULTS.minBuyInMojos;
    const config: TableConfig = {
      id,
      variant: "nlhe",
      format: sitAndGo ? "sng" : "cash",
      maxSeats: req.body.maxSeats ?? 6,
      smallBlindMojos: sitAndGo
        ? openingBlinds.smallBlindMojos
        : BigInt(
            req.body.smallBlindMojos ??
              (useDatStakes ? DAT_TABLE_DEFAULTS.smallBlindMojos : 50_000_000_000n),
          ),
      bigBlindMojos: sitAndGo
        ? openingBlinds.bigBlindMojos
        : BigInt(
            req.body.bigBlindMojos ??
              (useDatStakes ? DAT_TABLE_DEFAULTS.bigBlindMojos : 100_000_000_000n),
          ),
      minBuyInMojos: sitAndGo ? SNG_STARTING_STACK_MOJOS : minBuyIn,
      maxBuyInMojos: sitAndGo
        ? SNG_STARTING_STACK_MOJOS
        : useDatStakes
          ? DAT_TABLE_DEFAULTS.maxBuyInMojos
          : 20_000_000_000_000n,
      rakeBps: sitAndGo ? 0 : 500,
    };
    tables.set(id, { engine: new NlheTableEngine(config), names: new Map(), sng });
    commitTable(id);
    return {
      tableId: id,
      config: {
        ...config,
        entryMojos: sng?.entryMojos,
        startingStackMojos: sng?.startingStackMojos,
      },
    };
  });

  app.get("/v1/tables", async () => ({
    tables: [...tables.entries()].map(([tableId, record]) => ({
      tableId,
      maxSeats: record.engine.getMaxSeats(),
      seated: record.engine.getActivePlayerCount(),
      smallBlindMojos: record.engine.getSmallBlindMojos(),
      bigBlindMojos: record.engine.getBigBlindMojos(),
      buttonSeat: record.engine.getButtonSeat(),
      format: record.sng ? "sng" : "cash",
      tournamentStatus: record.sng?.status ?? null,
    })),
  }));

  app.get<{ Params: { tableId: string }; Querystring: { playerId?: string } }>(
    "/v1/tables/:tableId",
    async (req, reply) => {
      const view = tableView(req.params.tableId, req.query.playerId ?? null);
      if (!view) return reply.status(404).send({ error: "Table not found" });
      return view;
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
    if (record.sng && record.sng.status !== "registering") {
      return reply.status(400).send({ error: "Registration is closed" });
    }

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos);
    const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);

    if (record.sng && buyInMojos !== record.sng.entryMojos) {
      return reply.status(400).send({
        error: `Sit-and-go entry is ${record.sng.entryMojos.toString()} mojos`,
      });
    }

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
      const stack = record.sng?.startingStackMojos ?? buyInMojos;
      table.seatPlayer(req.body.playerId, req.body.seatIndex, stack);
      const name = req.body.displayName?.trim();
      record.names.set(req.body.playerId, name && name.length > 0 ? name.slice(0, 18) : req.body.playerId);
      commitTable(req.params.tableId);
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
    if (record.sng && record.sng.status !== "registering") {
      return reply.status(400).send({ error: "Registration is closed" });
    }
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
    const buyInMojos = record.sng
      ? record.sng.startingStackMojos
      : BigInt(req.body.buyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString());
    try {
      table.seatPlayer(playerId, seatIndex, buyInMojos);
      record.names.set(playerId, houseCount === 0 ? "House" : `House ${houseCount + 1}`);
      commitTable(req.params.tableId);
      return { ok: true, playerId, seatIndex, displayName: record.names.get(playerId) };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId)?.engine;
}

export function getTableRecord(tableId: string): TableRecord | undefined {
  return tables.get(tableId);
}

export function tableView(tableId: string, playerId: string | null) {
  const record = tables.get(tableId);
  if (!record) return null;
  const table = record.engine;
  return {
    tableId,
    maxSeats: table.getMaxSeats(),
    buttonSeat: table.getButtonSeat(),
    players: table.getActivePlayerCount(),
    handInProgress: table.isHandInProgress(),
    seats: seatView(record),
    hand: table.getPublicHandState(playerId),
    lastHandResult: table.getLastHandResult(),
    tournament: tournamentView(record),
    collectableMojos: playerId ? collectableMojos(record, playerId) : null,
  };
}
