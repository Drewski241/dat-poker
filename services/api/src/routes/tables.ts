import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import { DAT_TABLE_DEFAULTS, playthroughHandsRequired, resolveDatMinBuyInMojos } from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import { recordBuyIn, getBuyInRecord } from "../buy-in-store.js";
import { debitAccount, getAccountBalance, creditAccount } from "../account-store.js";
import { HOUSE_PLAYER_ID } from "../house-id.js";
import { redactHandForViewer } from "../redact-hand.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

const tables = new Map<string, NlheTableEngine>();
export { HOUSE_PLAYER_ID };

function humanCount(table: NlheTableEngine): number {
  return table.getSeatedPlayers().filter((s) => s.playerId !== HOUSE_PLAYER_ID).length;
}

function createTable(maxSeats = 6): { tableId: string; table: NlheTableEngine; config: TableConfig } {
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
    maxSeats,
    smallBlindMojos: BigInt(
      useDatStakes ? DAT_TABLE_DEFAULTS.smallBlindMojos : 50_000_000_000n,
    ),
    bigBlindMojos: BigInt(useDatStakes ? DAT_TABLE_DEFAULTS.bigBlindMojos : 100_000_000_000n),
    minBuyInMojos: minBuyIn,
    maxBuyInMojos: useDatStakes ? DAT_TABLE_DEFAULTS.maxBuyInMojos : 20_000_000_000_000n,
    rakeBps: 500,
  };
  const table = new NlheTableEngine(config);
  tables.set(id, table);
  return { tableId: id, table, config };
}

function tableSnapshot(tableId: string, table: NlheTableEngine, viewerId?: string) {
  return {
    tableId,
    maxSeats: table.getMaxSeats(),
    players: table.getActivePlayerCount(),
    humans: humanCount(table),
    handInProgress: table.isHandInProgress(),
    seats: table.getSeatedPlayers().map((s) => {
      const buyIn = getBuyInRecord(tableId, s.playerId);
      const handsRequired = buyIn ? playthroughHandsRequired(buyIn.buyInMojos) : 0;
      const handsPlayed = table.getHandsPlayed(s.playerId);
      return {
        ...s,
        handsPlayed,
        handsRequired,
        playthroughRemaining: Math.max(0, handsRequired - handsPlayed),
      };
    }),
    hand: redactHandForViewer(table.getHandState(), viewerId),
    lastHandResult: table.getLastHandResult(),
  };
}

function findPlayerTable(playerId: string): { tableId: string; table: NlheTableEngine } | null {
  for (const [tableId, table] of tables) {
    if (table.hasPlayer(playerId)) {
      return { tableId, table };
    }
  }
  return null;
}

export function pickJoinableTable(): { tableId: string; table: NlheTableEngine } | null {
  const open = [...tables.entries()]
    .filter(([, table]) => !table.isHandInProgress() && table.emptySeatIndex() !== null)
    .sort((a, b) => humanCount(b[1]) - humanCount(a[1]));
  if (open.length === 0) {
    return null;
  }
  return { tableId: open[0][0], table: open[0][1] };
}

function seatHouseIfNeeded(table: NlheTableEngine, buyInMojos: bigint): void {
  if (table.isHandInProgress()) {
    return;
  }
  if (humanCount(table) >= 2) {
    if (table.hasPlayer(HOUSE_PLAYER_ID)) {
      table.cashOutPlayer(HOUSE_PLAYER_ID);
    }
    return;
  }
  if (table.hasPlayer(HOUSE_PLAYER_ID)) {
    return;
  }
  const seat = table.emptySeatIndex();
  if (seat === null) {
    return;
  }
  table.seatPlayer(HOUSE_PLAYER_ID, seat, buyInMojos);
}

function takeBuyInFromAccountOrProof(params: {
  tableId: string;
  playerId: string;
  seatIndex: number;
  buyInMojos: bigint;
  buyInProof?: BuyInProof;
  devAck?: boolean;
}): { error: string | null; usedAccount: boolean } {
  const dat = readDatTokenConfig();
  const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);
  if (params.buyInMojos < minBuyIn) {
    return { error: `Buy-in below minimum (${minBuyIn.toString()} mojos)`, usedAccount: false };
  }

  const account = getAccountBalance(params.playerId);
  if (account >= params.buyInMojos) {
    debitAccount(params.playerId, params.buyInMojos);
    const buyInProof = params.buyInProof ?? {
      address: params.playerId,
      message: "account-credit",
      signature: "",
      pubkey: "",
    };
    recordBuyIn(params.tableId, params.playerId, buyInProof, params.buyInMojos.toString());
    return { error: null, usedAccount: true };
  }

  if (!dat.devBuyInEnabled) {
    if (!dat.assetId) {
      return { error: "DAT token not configured", usedAccount: false };
    }
    if (!params.buyInProof) {
      return { error: "Redeem daily DAT or provide a wallet buy-in proof", usedAccount: false };
    }
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos.toString(),
      playerId: params.playerId,
    });
    if (proofError) {
      return { error: proofError, usedAccount: false };
    }
    if (params.buyInProof.datBalanceMojos) {
      const balance = BigInt(params.buyInProof.datBalanceMojos);
      if (balance < params.buyInMojos) {
        return { error: "Insufficient DAT — redeem 5000 DAT / day or fund Sage", usedAccount: false };
      }
    }
  } else if (!params.devAck && dat.assetId && params.buyInProof) {
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos.toString(),
      playerId: params.playerId,
    });
    if (proofError) {
      return { error: proofError, usedAccount: false };
    }
  }

  const buyInProof = params.buyInProof ?? {
    address: params.playerId,
    message: "",
    signature: "",
    pubkey: "",
  };
  recordBuyIn(params.tableId, params.playerId, buyInProof, params.buyInMojos.toString());
  return { error: null, usedAccount: false };
}

export function registerTableRoutes(app: FastifyInstance): void {
  app.get("/v1/tables", async (req) => {
    const viewerId =
      typeof req.query === "object" && req.query && "playerId" in req.query
        ? String((req.query as { playerId?: string }).playerId ?? "")
        : "";
    return {
      tables: [...tables.entries()].map(([tableId, table]) =>
        tableSnapshot(tableId, table, viewerId || undefined),
      ),
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
    const created = createTable(req.body.maxSeats ?? 6);
    return { tableId: created.tableId, config: created.config };
  });

  app.post<{
    Body: {
      playerId: string;
      buyInMojos?: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/join", async (req, reply) => {
    const playerId = req.body.playerId;
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }

    const existing = findPlayerTable(playerId);
    if (existing) {
      return {
        ok: true,
        joinedExisting: true,
        ...tableSnapshot(existing.tableId, existing.table, playerId),
      };
    }

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos ?? dat.minBuyInMojos);
    let target = pickJoinableTable();
    if (!target) {
      const created = createTable(6);
      target = { tableId: created.tableId, table: created.table };
    }

    const seatIndex = target.table.emptySeatIndex();
    if (seatIndex === null) {
      const created = createTable(6);
      target = { tableId: created.tableId, table: created.table };
    }
    const seat = target.table.emptySeatIndex();
    if (seat === null) {
      return reply.status(500).send({ error: "No empty seat" });
    }

    const buyIn = takeBuyInFromAccountOrProof({
      tableId: target.tableId,
      playerId,
      seatIndex: seat,
      buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyIn.error) {
      return reply.status(400).send({ error: buyIn.error });
    }

    try {
      target.table.seatPlayer(playerId, seat, buyInMojos);
      seatHouseIfNeeded(target.table, buyInMojos);
      return {
        ok: true,
        joinedExisting: false,
        ...tableSnapshot(target.tableId, target.table, playerId),
      };
    } catch (e) {
      if (buyIn.usedAccount) {
        creditAccount(playerId, buyInMojos);
      }
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { tableId: string }; Querystring: { playerId?: string } }>(
    "/v1/tables/:tableId",
    async (req, reply) => {
      const table = tables.get(req.params.tableId);
      if (!table) {
        return reply.status(404).send({ error: "Table not found" });
      }
      return tableSnapshot(req.params.tableId, table, req.query.playerId);
    },
  );

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

    const buyInMojos = BigInt(req.body.buyInMojos);
    const buyIn = takeBuyInFromAccountOrProof({
      tableId: req.params.tableId,
      playerId: req.body.playerId,
      seatIndex: req.body.seatIndex,
      buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyIn.error) {
      return reply.status(400).send({ error: buyIn.error });
    }

    try {
      table.seatPlayer(req.body.playerId, req.body.seatIndex, buyInMojos);
      return { ok: true };
    } catch (e) {
      if (buyIn.usedAccount) {
        creditAccount(req.body.playerId, buyInMojos);
      }
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
    if (table.hasPlayer(HOUSE_PLAYER_ID)) {
      return { ok: true, playerId: HOUSE_PLAYER_ID };
    }
    const buyInMojos = BigInt(req.body.buyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString());
    const seat = table.emptySeatIndex();
    if (seat === null) {
      return reply.status(400).send({ error: "Table is full" });
    }
    try {
      table.seatPlayer(HOUSE_PLAYER_ID, seat, buyInMojos);
      return { ok: true, playerId: HOUSE_PLAYER_ID, seatIndex: seat };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}

export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId);
}

export function resetTablesForTests(): void {
  tables.clear();
}
