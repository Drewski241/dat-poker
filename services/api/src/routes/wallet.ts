import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import {
  nextUtcDayIso,
  playthroughHandsRequired,
  resolveDatDailyRedeemMojos,
  utcDateKey,
} from "@dat-poker/shared";
import { clearBuyIn, getBuyInRecord, hasBuyIn } from "../buy-in-store.js";
import {
  getAccountBalance,
  hasRedeemedToday,
  tryRedeemDaily,
  creditAccount,
} from "../account-store.js";
import {
  computeWithdrawPayout,
  readTreasuryPayoutConfig,
  requestTreasuryOffer,
} from "../treasury-payout.js";
import { getTableEngine } from "./tables.js";
import { hasWithdrawal, recordWithdrawal } from "../withdraw-store.js";
import type { NlheTableEngine } from "@dat-poker/game-engine";
import { allowIpBucket } from "../ip-rate-limit.js";
import { requirePlayer, sessionMatchesClaim, sessionTtlSeconds } from "../player-session.js";

function playthroughBlock(table: NlheTableEngine, tableId: string, playerId: string): string | null {
  const rec = getBuyInRecord(tableId, playerId);
  const required = rec ? playthroughHandsRequired(rec.buyInMojos) : 0;
  const played = table.getHandsPlayed(playerId);
  if (played < required) {
    return `Play through ${required - played} more hand(s) before withdraw (${played}/${required}). Requirement is one completed hand per DAT token of buy-in.`;
  }
  return null;
}
import {
  buildBuyInMessage,
  buildRedeemMessage,
  buildWithdrawMessage,
  readDatTokenConfig,
  type RedeemProof,
  type WithdrawProof,
  validateRedeemProof,
  validateWithdrawProof,
} from "../wallet-config.js";

export function registerWalletRoutes(app: FastifyInstance, chia: ChiaGamingClient): void {
  app.get("/v1/wallet/config", async () => {
    const projectId = process.env.WALLETCONNECT_PROJECT_ID?.trim();
    const chainId = process.env.CHIA_CHAIN_ID ?? "chia:mainnet";
    const payout = readTreasuryPayoutConfig();

    return {
      chiaNetwork: process.env.CHIA_NETWORK ?? "mainnet",
      chainId,
      coinsetUrl: process.env.COINSET_URL ?? "https://coinset.org",
      walletConnect: projectId
        ? {
            projectId,
            chainId,
          }
        : null,
      withdraw: {
        payoutMode: payout.payoutMode,
        treasuryConfigured: Boolean(payout.treasuryPayoutUrl),
        feeMojos: payout.withdrawFeeMojos.toString(),
      },
      playerSession: {
        required: true,
        ttlSeconds: sessionTtlSeconds(),
      },
      chiaGaming: {
        lobbyUrl: chia.lobbyBaseUrl,
        gameUrl: chia.gameBaseUrl,
      },
    };
  });

  app.get("/v1/wallet/dat-token", async () => readDatTokenConfig());

  app.get<{ Querystring: { address?: string } }>("/v1/wallet/account", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed Sage session" });
    }
    const address = session.playerId;
    const amount = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
    const now = new Date();
    return {
      address: session.displayAddress,
      playerId: session.playerId,
      balanceMojos: getAccountBalance(address).toString(),
      dailyRedeemMojos: amount.toString(),
      redeemedToday: hasRedeemedToday(address, now),
      nextRedeemAt: nextUtcDayIso(now),
    };
  });

  app.get<{ Querystring: { address?: string } }>("/v1/wallet/redeem/message", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed Sage session" });
    }
    const address = session.displayAddress;
    const amount = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
    const utcDate = utcDateKey();
    return {
      message: buildRedeemMessage({
        utcDate,
        address,
        amountMojos: amount.toString(),
      }),
      utcDate,
      amountMojos: amount.toString(),
    };
  });

  app.post<{
    Body: {
      playerId: string;
      redeemProof?: RedeemProof;
      devAck?: boolean;
    };
  }>("/v1/wallet/redeem", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed Sage session" });
    }
    if (!allowIpBucket(req.ip || "unknown", "redeem", Date.now(), 20)) {
      return reply.status(429).send({ error: "Too many redeem attempts from this network" });
    }
    const playerId = session.playerId;
    const dat = readDatTokenConfig();
    const amount = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
    const now = new Date();
    const utcDate = utcDateKey(now);

    if (!dat.devBuyInEnabled) {
      if (!req.body.redeemProof) {
        return reply.status(400).send({ error: "Redeem proof required (approve in Sage)" });
      }
      const proofError = validateRedeemProof(req.body.redeemProof, {
        utcDate,
        address: session.displayAddress,
        amountMojos: amount.toString(),
        playerId,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
    } else if (!req.body.devAck && req.body.redeemProof) {
      const proofError = validateRedeemProof(req.body.redeemProof, {
        utcDate,
        address: session.displayAddress,
        amountMojos: amount.toString(),
        playerId,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
    }

    const result = tryRedeemDaily(playerId, amount, now);
    if (!result.credited) {
      return reply.status(429).send({
        error: "Already redeemed 5000 DAT today. Come back after UTC midnight.",
        balanceMojos: result.balance.toString(),
        nextRedeemAt: nextUtcDayIso(now),
      });
    }
    return {
      ok: true,
      creditedMojos: amount.toString(),
      balanceMojos: result.balance.toString(),
      ticker: dat.ticker,
      nextRedeemAt: nextUtcDayIso(now),
      note: "In-game table credits (beta faucet). DAT CAT does not leave a treasury wallet on this host.",
    };
  });

  app.get("/v1/wallet/status", async () => {
    const dat = readDatTokenConfig();
    const payout = readTreasuryPayoutConfig();
    const lobbyOk = await chia.pingLobby();
    return {
      dat,
      walletConnectConfigured: Boolean(process.env.WALLETCONNECT_PROJECT_ID?.trim()),
      withdrawTreasuryConfigured: Boolean(payout.treasuryPayoutUrl),
      chiaGamingLobby: lobbyOk ? "up" : "down",
    };
  });

  app.get<{
    Querystring: { tableId?: string; seatIndex?: string; buyInMojos?: string; address?: string };
  }>("/v1/wallet/buy-in/message", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, seatIndex, buyInMojos } = req.query;
    if (!tableId || seatIndex === undefined || !buyInMojos) {
      return reply.status(400).send({ error: "tableId, seatIndex, and buyInMojos required" });
    }
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed Sage session" });
    }
    const message = buildBuyInMessage({
      tableId,
      seatIndex: Number(seatIndex),
      buyInMojos,
      address: session.displayAddress,
    });
    return { message };
  });

  app.get<{
    Querystring: { tableId?: string; address?: string; stackMojos?: string };
  }>("/v1/wallet/withdraw/message", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, stackMojos } = req.query;
    if (!tableId || !stackMojos) {
      return reply.status(400).send({ error: "tableId and stackMojos required" });
    }
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed Sage session" });
    }

    const table = getTableEngine(tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }

    const playerId = session.playerId;
    const stack = table.getPlayerStack(playerId);
    if (stack === null) {
      return reply.status(400).send({ error: "Player not seated at table" });
    }
    const blocked = playthroughBlock(table, tableId, playerId);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }
    if (stack.toString() !== stackMojos) {
      return reply.status(400).send({
        error: `Stack mismatch — refresh table (expected ${stack.toString()} mojos)`,
      });
    }

    const message = buildWithdrawMessage({
      tableId,
      stackMojos,
      address: session.displayAddress,
    });
    return { message, stackMojos: stack.toString() };
  });

  app.post<{
    Body: {
      tableId: string;
      playerId?: string;
      withdrawProof?: WithdrawProof;
      devAck?: boolean;
    };
  }>("/v1/wallet/withdraw", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, withdrawProof, devAck } = req.body;
    if (!tableId) {
      return reply.status(400).send({ error: "tableId required" });
    }
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed Sage session" });
    }
    const playerId = session.playerId;

    const table = getTableEngine(tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }
    if (hasWithdrawal(tableId, playerId)) {
      return reply.status(400).send({ error: "Withdrawal already completed for this table session" });
    }

    const stack = table.getPlayerStack(playerId);
    if (stack === null) {
      return reply.status(400).send({ error: "Player not seated at table" });
    }
    const blocked = playthroughBlock(table, tableId, playerId);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }

    const dat = readDatTokenConfig();
    const payoutConfig = readTreasuryPayoutConfig();

    if (!dat.devBuyInEnabled) {
      if (!dat.assetId) {
        return reply.status(503).send({ error: "DAT token not configured" });
      }
      if (!withdrawProof) {
        return reply.status(400).send({ error: "Wallet withdraw proof required" });
      }
      const proofError = validateWithdrawProof(withdrawProof, {
        tableId,
        stackMojos: stack.toString(),
        playerId,
        address: session.displayAddress,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
      if (!hasBuyIn(tableId, playerId)) {
        return reply.status(400).send({ error: "No verified buy-in found for this player" });
      }
    } else if (!devAck) {
      if (dat.assetId && withdrawProof) {
        const proofError = validateWithdrawProof(withdrawProof, {
          tableId,
          stackMojos: stack.toString(),
          playerId,
          address: session.displayAddress,
        });
        if (proofError) {
          return reply.status(400).send({ error: proofError });
        }
      } else if (dat.assetId) {
        return reply.status(400).send({ error: "Withdraw proof required (or pass devAck in dev mode)" });
      }
    }

    const buyInRecord = getBuyInRecord(tableId, playerId);
    const originalBuyInMojos = buyInRecord ? BigInt(buyInRecord.buyInMojos) : stack;
    const payoutMojos = computeWithdrawPayout(stack, originalBuyInMojos, payoutConfig.payoutMode);

    let cashOut;
    try {
      cashOut = table.cashOutPlayer(playerId);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }

    let mode: "ledger" | "offer" = "ledger";
    let offer: string | undefined;
    let feeMojos = payoutConfig.withdrawFeeMojos;

    if (payoutMojos > 0n && payoutConfig.treasuryPayoutUrl && dat.assetId) {
      try {
        const treasuryOffer = await requestTreasuryOffer({
          assetId: dat.assetId,
          recipientAddress: session.displayAddress,
          amountMojos: payoutMojos,
          treasuryPayoutUrl: payoutConfig.treasuryPayoutUrl,
        });
        if (treasuryOffer) {
          mode = "offer";
          offer = treasuryOffer;
        }
      } catch (e) {
        table.seatPlayer(playerId, cashOut.seatIndex, cashOut.stackMojos);
        return reply.status(502).send({ error: (e as Error).message });
      }
    }

    const withdrawalId = randomUUID();
    recordWithdrawal({
      withdrawalId,
      tableId,
      playerId,
      stackMojos: cashOut.stackMojos.toString(),
      originalBuyInMojos: originalBuyInMojos.toString(),
      payoutMojos: payoutMojos.toString(),
      mode,
      createdAt: new Date().toISOString(),
    });
    clearBuyIn(tableId, playerId);
    const accountMojos = creditAccount(playerId, cashOut.stackMojos);

    return {
      ok: true,
      withdrawalId,
      stackMojos: cashOut.stackMojos.toString(),
      originalBuyInMojos: originalBuyInMojos.toString(),
      payoutMojos: payoutMojos.toString(),
      payoutMode: payoutConfig.payoutMode,
      mode,
      offer,
      feeMojos: feeMojos.toString(),
      accountMojos: accountMojos.toString(),
      note:
        mode === "ledger"
          ? payoutMojos > 0n
            ? "Table stack returned to your DAT account. Configure DAT_TREASURY_PAYOUT_URL for on-chain CAT."
            : "Table stack returned to your DAT account."
          : "Approve the treasury offer in Sage to receive DAT.",
    };
  });
}

