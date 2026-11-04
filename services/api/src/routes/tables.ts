import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import {
  freezeVaultForHeadsUp,
  hashStackVector,
  openDatHeadsUpSession,
  openTableVault,
  recordVaultConsent,
  toGameRelayUrl,
  withVaultSeats,
  type DatHeadsUpSession,
  type TableVault,
} from "@dat-poker/chia-bridge";
import { NlheTableEngine } from "@dat-poker/game-engine";
import type { PokerVariant, TableConfig, TableFormat } from "@dat-poker/shared";
import {
  assertDatOnlyWager,
  assertSeatCount,
  DAT_TABLE_DEFAULTS,
  getVariantMeta,
  isTableFormat,
  resolveDatMinBuyInMojos,
  resolveHybridPlay,
  WagerPolicyError,
} from "@dat-poker/shared";
import { clearBuyIn, recordBuyIn } from "../buy-in-store.js";
import {
  houseLockView,
  InsufficientHouseBankrollError,
  lockHouseBuyIn,
  settleHouseTable,
} from "../house-lock.js";
import {
  type BuyInProof,
  readDatTokenConfig,
  validateBuyInProof,
} from "../wallet-config.js";

const tables = new Map<string, NlheTableEngine>();
const metas = new Map<string, TableMeta>();
const sessions = new Map<string, DatHeadsUpSession>();
const vaults = new Map<string, TableVault>();
let chiaClient: ChiaGamingClient | null = null;

export const HOUSE_PLAYER_ID = "dat-poker:house";

export interface TableMeta {
  variant: PokerVariant;
  format: TableFormat;
  maxSeats: number;
  assetId: string | null;
}

function samePair(session: DatHeadsUpSession, a: string, b: string): boolean {
  return (
    (session.playerA === a && session.playerB === b) ||
    (session.playerA === b && session.playerB === a)
  );
}

function buildHybridView(tableId: string) {
  const table = tables.get(tableId);
  const meta = metas.get(tableId);
  if (!table || !meta) return null;
  const live = table.getSeatedPlayers().filter((seat) => seat.stackMojos > 0n);
  const decision = resolveHybridPlay({
    seated: live.length,
    maxSeats: meta.maxSeats,
    format: meta.format,
    variant: meta.variant,
  });
  const session = sessions.get(tableId);
  const vault = vaults.get(tableId);
  return {
    ...decision,
    session: session?.status === "ready" ? session : null,
    vault:
      vault && (decision.mode === "dat-table-vault" || vault.status === "frozen-for-heads-up")
        ? vault
        : null,
  };
}

/** Recompute channel vs vault from who is actually seated. */
export function syncTableHybrid(tableId: string) {
  const table = tables.get(tableId);
  const meta = metas.get(tableId);
  if (!table || !meta || !chiaClient) return null;

  const seated = table.getSeatedPlayers().filter((seat) => seat.stackMojos > 0n);
  const decision = resolveHybridPlay({
    seated: seated.length,
    maxSeats: meta.maxSeats,
    format: meta.format,
    variant: meta.variant,
  });

  if (decision.mode === "waiting") {
    const session = sessions.get(tableId);
    if (session?.status === "ready") {
      sessions.set(tableId, { ...session, status: "closed" });
    }
    vaults.delete(tableId);
  } else if (decision.mode === "chia-gaming-heads-up") {
    const [first, second] = seated;
    if (!first || !second) {
      throw new Error("Heads-up sync missing seats");
    }
    const existingVault = vaults.get(tableId);
    if (existingVault) {
      vaults.set(
        tableId,
        freezeVaultForHeadsUp({
          ...existingVault,
          seats: seated.map((seat) => ({
            playerId: seat.playerId,
            seatIndex: seat.seatIndex,
            bondMojos: seat.stackMojos,
          })),
        }),
      );
    }
    const prev = sessions.get(tableId);
    if (prev && prev.status === "ready" && samePair(prev, first.playerId, second.playerId)) {
      const stakeFor = (playerId: string) =>
        playerId === first.playerId ? first.stackMojos : second.stackMojos;
      sessions.set(tableId, {
        ...prev,
        playerAStakeMojos: stakeFor(prev.playerA),
        playerBStakeMojos: stakeFor(prev.playerB),
      });
    } else {
      sessions.set(
        tableId,
        openDatHeadsUpSession({
          tableId,
          variant: meta.variant,
          playerA: first.playerId,
          playerB: second.playerId,
          playerAStakeMojos: first.stackMojos,
          playerBStakeMojos: second.stackMojos,
          assetId: meta.assetId,
          hubPageUrl: `${chiaClient.lobbyBaseUrl}/`,
          gameRelayUrl: toGameRelayUrl(chiaClient.lobbyBaseUrl),
        }),
      );
    }
  } else {
    const session = sessions.get(tableId);
    if (session?.status === "ready") {
      sessions.set(tableId, { ...session, status: "closed" });
    }
    const existing = vaults.get(tableId);
    if (!existing || existing.status === "frozen-for-heads-up") {
      vaults.set(
        tableId,
        openTableVault({
          tableId,
          assetId: meta.assetId,
          seats: seated,
        }),
      );
    } else {
      vaults.set(tableId, withVaultSeats(existing, seated));
    }
  }

  return buildHybridView(tableId);
}

export function registerTableRoutes(app: FastifyInstance, chia: ChiaGamingClient): void {
  chiaClient = chia;

  app.post<{
    Body: {
      variant?: string;
      format?: string;
      unit?: string;
      smallBlindMojos?: string;
      bigBlindMojos?: string;
      maxSeats?: number;
    };
  }>("/v1/tables", async (req, reply) => {
    let maxSeats: number;
    let variant: PokerVariant;
    let format: TableFormat;
    try {
      assertDatOnlyWager(req.body.unit);
      maxSeats = req.body.maxSeats ?? 6;
      assertSeatCount(maxSeats);
      const requested = req.body.variant ?? "nlhe";
      const found = getVariantMeta(requested as PokerVariant);
      if (!found) {
        return reply.status(400).send({ error: "Unknown variant" });
      }
      variant = found.id;
      const requestedFormat = req.body.format ?? "cash";
      if (!isTableFormat(requestedFormat)) {
        return reply.status(400).send({ error: "format must be cash, sng, or mtt" });
      }
      format = requestedFormat;
    } catch (e) {
      const message = e instanceof WagerPolicyError || e instanceof Error ? e.message : "Invalid table";
      return reply.status(400).send({ error: message });
    }

    const id = randomUUID();
    const dat = readDatTokenConfig();
    const useDatStakes = Boolean(dat.assetId);
    const minBuyIn = useDatStakes
      ? resolveDatMinBuyInMojos(dat.minBuyInMojos)
      : DAT_TABLE_DEFAULTS.minBuyInMojos;
    const config: TableConfig = {
      id,
      variant,
      format,
      maxSeats,
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
    metas.set(id, { variant, format, maxSeats, assetId: dat.assetId });
    return { tableId: id, config, hybrid: syncTableHybrid(id) };
  });

  app.get<{ Params: { tableId: string } }>("/v1/tables/:tableId", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    const meta = metas.get(req.params.tableId);
    if (!table || !meta) {
      return reply.status(404).send({ error: "Table not found" });
    }
    return {
      tableId: req.params.tableId,
      variant: meta.variant,
      format: meta.format,
      maxSeats: meta.maxSeats,
      players: table.getActivePlayerCount(),
      handInProgress: table.isHandInProgress(),
      seats: table.getSeatedPlayers(),
      hand: table.getHandState(),
      lastHandResult: table.getLastHandResult(),
      hybrid: syncTableHybrid(req.params.tableId),
      houseLock: await houseLockView(req.params.tableId).catch(() => ({
        configured: false,
        spendableMojos: "0",
        lockedMojos: "0",
        availableMojos: "0",
        tableLockedMojos: null,
      })),
    };
  });

  app.post<{
    Params: { tableId: string };
    Body: { playerId: string };
  }>("/v1/tables/:tableId/vault/cosign", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table || !metas.has(req.params.tableId)) {
      return reply.status(404).send({ error: "Table not found" });
    }
    syncTableHybrid(req.params.tableId);
    const vault = vaults.get(req.params.tableId);
    if (!vault || vault.status !== "open") {
      return reply.status(400).send({ error: "Table is not on an open DAT vault" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the hand before co-signing stacks" });
    }
    const result = table.getLastHandResult();
    if (!result) {
      return reply.status(400).send({ error: "No completed hand to co-sign" });
    }
    if (!req.body.playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }
    const stacks = table.getSeatedPlayers();
    const stateRootHash = hashStackVector(req.params.tableId, result.handId, stacks);
    try {
      const next = recordVaultConsent(vault, {
        playerId: req.body.playerId,
        handId: result.handId,
        stateRootHash,
        stacks,
      });
      vaults.set(req.params.tableId, next);
      return {
        ok: true,
        completed: next.lastCoSigned?.handId === result.handId,
        hybrid: buildHybridView(req.params.tableId),
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
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
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
    return { ok: true, hybrid: syncTableHybrid(req.params.tableId) };
  });

  app.post<{
    Params: { tableId: string };
    Body: { playerId?: string; devAck?: boolean };
  }>("/v1/tables/:tableId/cancel-join", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress() || table.getLastHandResult()) {
      return reply.status(400).send({ error: "Play has started; withdraw instead of cancelling the join" });
    }
    const playerId = req.body.playerId;
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }
    if (table.getSeatedPlayers().some((seat) => seat.playerId === playerId)) {
      try {
        table.cashOutPlayer(playerId);
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
      clearBuyIn(req.params.tableId, playerId);
    }
    await releaseHouseIfAlone(req.params.tableId, 0n);
    return { ok: true, hybrid: syncTableHybrid(req.params.tableId) };
  });

  app.post<{
    Params: { tableId: string };
    Body: { buyInMojos?: string };
  }>("/v1/tables/:tableId/seat-house", async (req, reply) => {
    const table = tables.get(req.params.tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.getSeatedPlayers().some((seat) => seat.playerId === HOUSE_PLAYER_ID)) {
      return {
        ok: true,
        playerId: HOUSE_PLAYER_ID,
        hybrid: syncTableHybrid(req.params.tableId),
        houseLock: await houseLockView(req.params.tableId),
      };
    }
    const buyInMojos = BigInt(req.body.buyInMojos ?? DAT_TABLE_DEFAULTS.minBuyInMojos.toString());
    let locked = false;
    try {
      locked = (await lockHouseBuyIn(req.params.tableId, buyInMojos)) !== null;
      table.seatPlayer(HOUSE_PLAYER_ID, 1, buyInMojos);
    } catch (e) {
      if (locked) {
        await settleHouseTable(req.params.tableId, 0n);
      }
      const message = (e as Error).message;
      const status =
        e instanceof InsufficientHouseBankrollError || message.includes("not have enough free DAT")
          ? 409
          : 400;
      return reply.status(status).send({ error: message });
    }
    return {
      ok: true,
      playerId: HOUSE_PLAYER_ID,
      hybrid: syncTableHybrid(req.params.tableId),
      houseLock: await houseLockView(req.params.tableId),
    };
  });
}

export async function releaseHouseIfAlone(tableId: string, spentMojos: bigint): Promise<void> {
  const table = tables.get(tableId);
  if (!table || table.isHandInProgress()) return;
  const seats = table.getSeatedPlayers();
  const houseSeated = seats.some((seat) => seat.playerId === HOUSE_PLAYER_ID);
  const humans = seats.filter((seat) => seat.playerId !== HOUSE_PLAYER_ID);
  if (!houseSeated || humans.length > 0) return;
  try {
    table.cashOutPlayer(HOUSE_PLAYER_ID);
  } catch {
    // The house seat is already empty.
  }
  await settleHouseTable(tableId, spentMojos);
}

export function getTableEngine(tableId: string): NlheTableEngine | undefined {
  return tables.get(tableId);
}

export function getTableMeta(tableId: string): TableMeta | undefined {
  return metas.get(tableId);
}
