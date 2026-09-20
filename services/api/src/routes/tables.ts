import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TableConfig } from "@dat-poker/shared";
import {
  DAT_TABLE_DEFAULTS,
  playthroughHandsRequired,
  playthroughUnlockedMojos,
  resolveDatMinBuyInMojos,
} from "@dat-poker/shared";
import { NlheTableEngine } from "@dat-poker/game-engine";
import {
  applyBuyInPlaythrough,
  creditAccount,
  debitAccount,
  getAccountBalance,
  getPlaythrough,
  reducePlaythroughPool,
  setPlaythroughHands,
  syncPlaythroughHeld,
} from "../account-store.js";
import { recordBuyIn, clearBuyIn } from "../buy-in-store.js";
import { HOUSE_PLAYER_ID } from "../house-id.js";
import { redactHandForViewer } from "../redact-hand.js";
import { allowIpBucket } from "../ip-rate-limit.js";
import { readPlayerSession, requirePlayer, sessionMatchesClaim } from "../player-session.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";
import {
  clearPlayerActivity,
  getLastPlayerActivity,
  inactiveUnseatMs,
  touchPlayerActivity,
} from "../player-activity.js";
import {
  getHandHistory,
  maybeRecordCompletedHand,
  resetHandHistoryForTests,
} from "../hand-history-store.js";
import { playHouseIfDue } from "../house-play.js";

export interface UnseatedInactivePlayer {
  playerId: string;
  stackMojos: string;
  inactiveForMs: number;
}

export interface UnseatInactiveResult {
  unseated: UnseatedInactivePlayer[];
}

const tables = new Map<string, NlheTableEngine>();
const playerLabels = new Map<string, string>();
export { HOUSE_PLAYER_ID };

function rememberLabel(playerId: string, displayAddress: string): void {
  if (displayAddress) playerLabels.set(playerId, displayAddress);
}

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

function defaultHouseBuyIn(): bigint {
  const dat = readDatTokenConfig();
  return resolveDatMinBuyInMojos(dat.minBuyInMojos);
}

/**
 * Remove human players who have not polled or acted recently. Only runs between hands;
 * stacks are returned to the in-game account ledger (same as voluntary leave).
 */
export function unseatInactivePlayers(
  tableId: string,
  table: NlheTableEngine,
  nowMs: number,
): UnseatInactiveResult {
  const unseated: UnseatedInactivePlayer[] = [];
  if (table.isHandInProgress()) {
    return { unseated };
  }
  const threshold = inactiveUnseatMs();
  persistTablePlaythrough(table);
  for (const seated of [...table.getSeatedPlayers()]) {
    if (seated.playerId === HOUSE_PLAYER_ID) continue;
    const last = getLastPlayerActivity(seated.playerId);
    if (last === undefined) {
      touchPlayerActivity(seated.playerId, nowMs);
      continue;
    }
    const inactiveForMs = nowMs - last;
    if (inactiveForMs < threshold) continue;
    try {
      const cash = table.cashOutPlayer(seated.playerId);
      creditAccount(seated.playerId, cash.stackMojos);
      syncPlaythroughHeld(seated.playerId, getAccountBalance(seated.playerId));
      clearBuyIn(tableId, seated.playerId);
      clearPlayerActivity(seated.playerId);
      unseated.push({
        playerId: seated.playerId,
        stackMojos: cash.stackMojos.toString(),
        inactiveForMs,
      });
    } catch {
      /* already unseated or hand started */
    }
  }
  if (unseated.length > 0) {
    seatHouseIfNeeded(table, defaultHouseBuyIn());
  }
  return { unseated };
}

function maintainTable(
  tableId: string,
  table: NlheTableEngine,
  viewerId?: string,
): UnseatInactiveResult {
  const nowMs = Date.now();
  if (viewerId && table.hasPlayer(viewerId)) {
    touchPlayerActivity(viewerId, nowMs);
  }
  if (table.isHandInProgress()) {
    const hand = table.getHandState();
    if (hand) {
      const actor =
        hand.actionSeat != null
          ? hand.players.find((p) => p.seatIndex === hand.actionSeat)
          : undefined;
      if (actor?.playerId === HOUSE_PLAYER_ID) {
        playHouseIfDue(table);
      } else if (actor?.allIn) {
        table.advanceHandIfIdle();
      }
      persistTablePlaythrough(table);
      maybeRecordCompletedHand(tableId, table);
    }
  }
  return unseatInactivePlayers(tableId, table, nowMs);
}

function tableSnapshot(
  tableId: string,
  table: NlheTableEngine,
  viewerId?: string,
  maintenance?: UnseatInactiveResult,
) {
  return {
    tableId,
    maxSeats: table.getMaxSeats(),
    players: table.getActivePlayerCount(),
    humans: humanCount(table),
    handInProgress: table.isHandInProgress(),
    smallBlindMojos: table.getSmallBlindMojos().toString(),
    bigBlindMojos: table.getBigBlindMojos().toString(),
    seats: table.getSeatedPlayers().map((s) => {
      const pt = s.playerId === HOUSE_PLAYER_ID ? { poolMojos: 0n, handsPlayed: 0 } : getPlaythrough(s.playerId);
      const handsRequired = playthroughHandsRequired(pt.poolMojos);
      const handsPlayed = s.playerId === HOUSE_PLAYER_ID ? table.getHandsPlayed(s.playerId) : pt.handsPlayed;
      const unlockedMojos = playthroughUnlockedMojos(handsPlayed, pt.poolMojos);
      return {
        ...s,
        displayAddress: playerLabels.get(s.playerId) ?? (s.playerId === HOUSE_PLAYER_ID ? "House" : s.playerId),
        handsPlayed,
        handsRequired,
        playthroughRemaining: Math.max(0, handsRequired - handsPlayed),
        unlockedMojos: unlockedMojos.toString(),
      };
    }),
    hand: redactHandForViewer(table.getHandState(), viewerId),
    lastHandResult: table.getLastHandResult(),
    dealerButtonSeat: table.getDealerButtonSeat(),
    ...(maintenance && maintenance.unseated.length > 0
      ? { unseatedInactive: maintenance.unseated }
      : {}),
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
  displayAddress: string;
  seatIndex: number;
  buyInMojos: bigint;
  buyInProof?: BuyInProof;
  devAck?: boolean;
}): { error: string | null; usedAccount: boolean; addedFreshMojos: bigint } {
  const dat = readDatTokenConfig();
  const minBuyIn = resolveDatMinBuyInMojos(dat.minBuyInMojos);
  if (params.buyInMojos < minBuyIn) {
    return { error: `Buy-in below minimum (${minBuyIn.toString()} mojos)`, usedAccount: false, addedFreshMojos: 0n };
  }

  const account = getAccountBalance(params.playerId);
  if (account >= params.buyInMojos) {
    const { addedFreshMojos } = applyBuyInPlaythrough(params.playerId, params.buyInMojos, true);
    debitAccount(params.playerId, params.buyInMojos);
    const buyInProof = params.buyInProof ?? {
      address: params.displayAddress,
      message: "account-credit",
      signature: "",
      pubkey: "",
    };
    recordBuyIn(params.tableId, params.playerId, buyInProof, params.buyInMojos.toString());
    return { error: null, usedAccount: true, addedFreshMojos };
  }

  if (!dat.devBuyInEnabled) {
    if (!dat.assetId) {
      return { error: "DAT token not configured", usedAccount: false, addedFreshMojos: 0n };
    }
    if (!params.buyInProof) {
      return {
        error: "Redeem daily DAT or provide a wallet buy-in proof",
        usedAccount: false,
        addedFreshMojos: 0n,
      };
    }
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos.toString(),
      playerId: params.playerId,
      address: params.displayAddress,
    });
    if (proofError) {
      return { error: proofError, usedAccount: false, addedFreshMojos: 0n };
    }
    if (params.buyInProof.datBalanceMojos) {
      const balance = BigInt(params.buyInProof.datBalanceMojos);
      if (balance < params.buyInMojos) {
        return {
          error: "Insufficient DAT — redeem 5000 DAT / day or fund Sage",
          usedAccount: false,
          addedFreshMojos: 0n,
        };
      }
    }
  } else if (!params.devAck && dat.assetId && params.buyInProof) {
    const proofError = validateBuyInProof(params.buyInProof, {
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos.toString(),
      playerId: params.playerId,
      address: params.displayAddress,
    });
    if (proofError) {
      return { error: proofError, usedAccount: false, addedFreshMojos: 0n };
    }
  }

  const buyInProof = params.buyInProof ?? {
    address: params.displayAddress,
    message: "",
    signature: "",
    pubkey: "",
  };
  const { addedFreshMojos } = applyBuyInPlaythrough(params.playerId, params.buyInMojos, false);
  recordBuyIn(params.tableId, params.playerId, buyInProof, params.buyInMojos.toString());
  return { error: null, usedAccount: false, addedFreshMojos };
}

export function registerTableRoutes(app: FastifyInstance): void {
  app.get("/v1/tables", async (req) => {
    const session = readPlayerSession(req);
    return {
      tables: [...tables.entries()].map(([tableId, table]) => {
        const maintenance = maintainTable(tableId, table, session?.playerId);
        return tableSnapshot(tableId, table, session?.playerId, maintenance);
      }),
    };
  });

  app.post<{
    Body: {
      variant?: string;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      maxSeats?: number;
    };
  }>("/v1/tables", async (req, reply) => {
    if (!requirePlayer(req, reply)) return;
    const created = createTable(req.body.maxSeats ?? 6);
    return { tableId: created.tableId, config: created.config };
  });

  app.post<{
    Body: {
      playerId?: string;
      buyInMojos?: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/join", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    if (!allowIpBucket(req.ip || "unknown", "join", Date.now(), 30)) {
      return reply.status(429).send({ error: "Too many join requests from this network" });
    }
    const playerId = session.playerId;
    rememberLabel(playerId, session.displayAddress);

    const existing = findPlayerTable(playerId);
    if (existing) {
      touchPlayerActivity(playerId);
      const maintenance = maintainTable(existing.tableId, existing.table, playerId);
      return {
        ok: true,
        joinedExisting: true,
        ...tableSnapshot(existing.tableId, existing.table, playerId, maintenance),
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
      displayAddress: session.displayAddress,
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
      target.table.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
      touchPlayerActivity(playerId);
      seatHouseIfNeeded(target.table, buyInMojos);
      const maintenance = maintainTable(target.tableId, target.table, playerId);
      return {
        ok: true,
        joinedExisting: false,
        ...tableSnapshot(target.tableId, target.table, playerId, maintenance),
      };
    } catch (e) {
      if (buyIn.usedAccount) {
        creditAccount(playerId, buyInMojos);
      }
      if (buyIn.addedFreshMojos > 0n) {
        reducePlaythroughPool(playerId, buyIn.addedFreshMojos);
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
      const session = readPlayerSession(req);
      const maintenance = maintainTable(req.params.tableId, table, session?.playerId);
      return tableSnapshot(req.params.tableId, table, session?.playerId, maintenance);
    },
  );

  app.get<{
    Params: { tableId: string };
    Querystring: { playerId?: string; limit?: string };
  }>("/v1/tables/:tableId/hand-history", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (
      req.query.playerId &&
      !sessionMatchesClaim(session, req.query.playerId)
    ) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const limit = Math.min(40, Math.max(1, Number(req.query.limit ?? "20") || 20));
    return {
      tableId: req.params.tableId,
      hands: getHandHistory(req.params.tableId, limit),
    };
  });

  app.post<{ Params: { tableId: string }; Body: { playerId?: string } }>(
    "/v1/tables/:tableId/seats/unseat-inactive",
    async (req, reply) => {
      const session = requirePlayer(req, reply);
      if (!session) return;
      if (!sessionMatchesClaim(session, req.body?.playerId)) {
        return reply.status(403).send({ error: "playerId does not match the signed-in account" });
      }
      const table = tables.get(req.params.tableId);
      if (!table) {
        return reply.status(404).send({ error: "Table not found" });
      }
      if (!table.hasPlayer(session.playerId)) {
        return reply.status(403).send({ error: "You are not seated at this table" });
      }
      touchPlayerActivity(session.playerId);
      const maintenance = unseatInactivePlayers(req.params.tableId, table, Date.now());
      return {
        ok: true,
        ...tableSnapshot(req.params.tableId, table, session.playerId, maintenance),
      };
    },
  );

  app.post<{
    Params: { tableId: string };
    Body: {
      playerId?: string;
      seatIndex: number;
      buyInMojos: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/:tableId/seat", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }

    const playerId = session.playerId;
    rememberLabel(playerId, session.displayAddress);
    const buyInMojos = BigInt(req.body.buyInMojos);
    const buyIn = takeBuyInFromAccountOrProof({
      tableId: req.params.tableId,
      playerId,
      displayAddress: session.displayAddress,
      seatIndex: req.body.seatIndex,
      buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyIn.error) {
      return reply.status(400).send({ error: buyIn.error });
    }

    try {
      table.seatPlayer(playerId, req.body.seatIndex, buyInMojos);
      table.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
      touchPlayerActivity(playerId);
      return { ok: true };
    } catch (e) {
      if (buyIn.usedAccount) {
        creditAccount(playerId, buyInMojos);
      }
      if (buyIn.addedFreshMojos > 0n) {
        reducePlaythroughPool(playerId, buyIn.addedFreshMojos);
      }
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (!table.hasPlayer(session.playerId)) {
      return reply.status(403).send({ error: "You are not seated at this table" });
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

  app.post<{
    Params: { tableId: string };
    Body: {
      playerId?: string;
      buyInMojos?: string;
      buyInProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/tables/:tableId/rebuy", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    const playerId = session.playerId;
    if (!table.hasPlayer(playerId)) {
      return reply.status(403).send({ error: "You are not seated at this table" });
    }
    const seated = table.getSeatedPlayers().find((s) => s.playerId === playerId);
    if (!seated) {
      return reply.status(400).send({ error: "You are not seated at this table" });
    }

    const dat = readDatTokenConfig();
    const buyInMojos = BigInt(req.body.buyInMojos ?? dat.minBuyInMojos);
    const buyIn = takeBuyInFromAccountOrProof({
      tableId: req.params.tableId,
      playerId,
      displayAddress: session.displayAddress,
      seatIndex: seated.seatIndex,
      buyInMojos,
      buyInProof: req.body.buyInProof,
      devAck: req.body.devAck,
    });
    if (buyIn.error) {
      return reply.status(400).send({ error: buyIn.error });
    }

    try {
      table.rebuyStack(playerId, buyInMojos);
      table.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
      seatHouseIfNeeded(table, buyInMojos);
      persistTablePlaythrough(table);
      touchPlayerActivity(playerId);
      return {
        ok: true,
        rebuy: true,
        ...tableSnapshot(req.params.tableId, table, playerId),
      };
    } catch (e) {
      if (buyIn.usedAccount) {
        creditAccount(playerId, buyInMojos);
      }
      if (buyIn.addedFreshMojos > 0n) {
        reducePlaythroughPool(playerId, buyIn.addedFreshMojos);
      }
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}

export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId);
}

export function persistTablePlaythrough(table: NlheTableEngine): void {
  for (const seated of table.getSeatedPlayers()) {
    if (seated.playerId === HOUSE_PLAYER_ID) continue;
    setPlaythroughHands(seated.playerId, table.getHandsPlayed(seated.playerId));
    syncPlaythroughHeld(seated.playerId, getAccountBalance(seated.playerId) + seated.stackMojos);
  }
}

/** Move seated stacks back to the persisted ledger (API restart / redeploy). */
export function returnAllStacksToAccounts(): { returned: number } {
  let returned = 0;
  for (const [tableId, table] of tables) {
    try {
      table.abortHandRefundBets();
    } catch {
      /* older engine without abort */
    }
    persistTablePlaythrough(table);
    for (const seated of [...table.getSeatedPlayers()]) {
      if (seated.playerId === HOUSE_PLAYER_ID) {
        try {
          table.cashOutPlayer(HOUSE_PLAYER_ID);
        } catch {
          /* house already gone */
        }
        continue;
      }
      try {
        const cash = table.cashOutPlayer(seated.playerId);
        creditAccount(seated.playerId, cash.stackMojos);
        syncPlaythroughHeld(seated.playerId, getAccountBalance(seated.playerId));
        clearBuyIn(tableId, seated.playerId);
        clearPlayerActivity(seated.playerId);
        returned += 1;
      } catch {
        /* already standing */
      }
    }
  }
  return { returned };
}

export function resetTablesForTests(): void {
  tables.clear();
  playerLabels.clear();
  resetHandHistoryForTests();
}
