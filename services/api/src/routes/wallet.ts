import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import {
  playthroughHandsRequired,
  playthroughUnlockedMojos,
  playthroughWithdrawableMojos,
  resolveDatDailyRedeemMojos,
  utcDateKey,
} from "@dat-poker/shared";
import { clearBuyIn, getBuyInRecord, hasBuyIn } from "../buy-in-store.js";
import {
  consumePlaythroughWithdraw,
  creditAccount,
  getAccountBalance,
  getPlaythrough,
  hasRedeemedToday,
  clearPlaythrough,
  nextRedeemAvailableAt,
  syncPlaythroughHeld,
  tryRedeemDaily,
} from "../account-store.js";
import {
  computeWithdrawPayout,
  readTreasuryPayoutConfig,
  requestTreasuryOffer,
} from "../treasury-payout.js";
import { getTableEngine, persistTablePlaythrough } from "./tables.js";
import { assertUserEmailVerified } from "../user-store.js";
import { hasWithdrawal, recordWithdrawal } from "../withdraw-store.js";
import type { NlheTableEngine } from "@dat-poker/game-engine";
import { allowIpBucket } from "../ip-rate-limit.js";
import { requirePlayer, sessionMatchesClaim, sessionTtlSeconds } from "../player-session.js";
import {
  buildBuyInMessage,
  buildRedeemMessage,
  buildWithdrawMessage,
  readDatTokenConfig,
  type WithdrawProof,
  validateWithdrawProof,
} from "../wallet-config.js";

function playthroughView(playerId: string) {
  const pt = getPlaythrough(playerId);
  const handsRequired = playthroughHandsRequired(pt.poolMojos);
  return {
    poolMojos: pt.poolMojos.toString(),
    handsPlayed: pt.handsPlayed,
    handsRequired,
    unlockedMojos: playthroughUnlockedMojos(pt.handsPlayed, pt.poolMojos).toString(),
    playthroughRemaining: Math.max(0, handsRequired - pt.handsPlayed),
  };
}

function unlockedWithdrawMojos(table: NlheTableEngine, playerId: string): bigint {
  const stack = table.getPlayerStack(playerId);
  if (stack === null) return 0n;
  const pt = getPlaythrough(playerId);
  const required = playthroughHandsRequired(pt.poolMojos);
  if (required > 0 && pt.handsPlayed >= required) {
    return stack;
  }
  return playthroughWithdrawableMojos(pt.handsPlayed, pt.poolMojos, stack);
}

function sagePlaythroughBlock(table: NlheTableEngine, playerId: string): string | null {
  persistTablePlaythrough(table);
  const available = unlockedWithdrawMojos(table, playerId);
  if (available > 0n) return null;
  const view = playthroughView(playerId);
  if (view.handsRequired <= 0) {
    return "No DAT is unlocked for withdraw yet. Buy in and complete hands — each hand unlocks 1 DAT.";
  }
  if (view.playthroughRemaining <= 0) {
    return null;
  }
  return `Play through ${view.playthroughRemaining} more hand(s) to unlock DAT (${view.handsPlayed}/${view.handsRequired}). Each completed hand unlocks 1 DAT for withdraw.`;
}

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
      return reply.status(403).send({ error: "address does not match the signed-in account" });
    }
    const address = session.playerId;
    const amount = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
    const now = new Date();
    const pt = playthroughView(address);
    return {
      address: session.displayAddress,
      playerId: session.playerId,
      balanceMojos: getAccountBalance(address).toString(),
      dailyRedeemMojos: amount.toString(),
      redeemedToday: hasRedeemedToday(address, now),
      nextRedeemAt: nextRedeemAvailableAt(address, now),
      playthrough: pt,
    };
  });

  app.get<{ Querystring: { address?: string } }>("/v1/wallet/redeem/message", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed-in account" });
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
      playerId?: string;
      redeemProof?: unknown;
      devAck?: boolean;
    };
  }>("/v1/wallet/redeem", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    if (!allowIpBucket(req.ip || "unknown", "redeem", Date.now(), 20)) {
      return reply.status(429).send({ error: "Too many redeem attempts from this network" });
    }
    const playerId = session.playerId;
    try {
      await assertUserEmailVerified(playerId);
    } catch (e) {
      return reply.status(403).send({ error: (e as Error).message });
    }
    const dat = readDatTokenConfig();
    const amount = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS);
    const now = new Date();

    const result = tryRedeemDaily(playerId, amount, now);
    if (!result.credited) {
      return reply.status(429).send({
        error: "Already redeemed 5000 DAT. Wait 24 hours between redeems.",
        balanceMojos: result.balance.toString(),
        nextRedeemAt: nextRedeemAvailableAt(playerId, now),
      });
    }
    return {
      ok: true,
      creditedMojos: amount.toString(),
      balanceMojos: result.balance.toString(),
      ticker: dat.ticker,
      nextRedeemAt: nextRedeemAvailableAt(playerId, now),
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
      return reply.status(403).send({ error: "address does not match the signed-in account" });
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
      return reply.status(403).send({ error: "address does not match the signed-in account" });
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
    persistTablePlaythrough(table);
    const blocked = sagePlaythroughBlock(table, playerId);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }
    const withdrawMojos = unlockedWithdrawMojos(table, playerId);
    if (stack.toString() !== stackMojos && withdrawMojos.toString() !== stackMojos) {
      return reply.status(400).send({
        error: `Stack mismatch — refresh table (expected ${withdrawMojos.toString()} unlocked mojos)`,
      });
    }

    const message = buildWithdrawMessage({
      tableId,
      stackMojos: withdrawMojos.toString(),
      address: session.displayAddress,
    });
    return { message, stackMojos: withdrawMojos.toString(), unlockedMojos: withdrawMojos.toString() };
  });

  app.post<{
    Body: {
      tableId: string;
      playerId?: string;
      withdrawProof?: WithdrawProof;
      devAck?: boolean;
      toAccount?: boolean;
    };
  }>("/v1/wallet/withdraw", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, withdrawProof, devAck, toAccount } = req.body;
    if (!tableId) {
      return reply.status(400).send({ error: "tableId required" });
    }
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    const playerId = session.playerId;

    const table = getTableEngine(tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }

    const stack = table.getPlayerStack(playerId);
    if (stack === null) {
      return reply.status(400).send({ error: "Player not seated at table" });
    }
    persistTablePlaythrough(table);

    const dat = readDatTokenConfig();
    const payoutConfig = readTreasuryPayoutConfig();
    const cashOutToAccount = Boolean(toAccount);

    if (!cashOutToAccount) {
      if (hasWithdrawal(tableId, playerId)) {
        return reply.status(400).send({ error: "Withdrawal already completed for this table session" });
      }
      const blocked = sagePlaythroughBlock(table, playerId);
      if (blocked) {
        return reply.status(400).send({ error: blocked });
      }
    }

    const ptNow = getPlaythrough(playerId);
    const requiredNow = playthroughHandsRequired(ptNow.poolMojos);
    const fullyUnlocked = requiredNow > 0 && ptNow.handsPlayed >= requiredNow;
    const withdrawMojos = cashOutToAccount || fullyUnlocked ? stack : unlockedWithdrawMojos(table, playerId);
    if (!cashOutToAccount && !fullyUnlocked && withdrawMojos <= 0n) {
      return reply.status(400).send({
        error: sagePlaythroughBlock(table, playerId) ?? "Nothing unlocked",
      });
    }

    if (!cashOutToAccount && !dat.devBuyInEnabled) {
      if (!dat.assetId) {
        return reply.status(503).send({ error: "DAT token not configured" });
      }
      if (!withdrawProof) {
        return reply.status(400).send({ error: "Wallet withdraw proof required" });
      }
      const proofError = validateWithdrawProof(withdrawProof, {
        tableId,
        stackMojos: withdrawMojos.toString(),
        playerId,
        address: session.displayAddress,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
      if (!hasBuyIn(tableId, playerId)) {
        return reply.status(400).send({ error: "No verified buy-in found for this player" });
      }
    } else if (!cashOutToAccount && !devAck) {
      if (dat.assetId && withdrawProof) {
        const proofError = validateWithdrawProof(withdrawProof, {
          tableId,
          stackMojos: withdrawMojos.toString(),
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
    const payoutMojos = cashOutToAccount
      ? computeWithdrawPayout(stack, originalBuyInMojos, payoutConfig.payoutMode)
      : withdrawMojos;

    let mode: "ledger" | "offer" = "ledger";
    let offer: string | undefined;
    const feeMojos = payoutConfig.withdrawFeeMojos;

    if (
      !cashOutToAccount &&
      payoutMojos > 0n &&
      payoutConfig.treasuryPayoutUrl &&
      dat.assetId
    ) {
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
        return reply.status(502).send({ error: (e as Error).message });
      }
    }

    let remainingStack = stack;
    let stillSeated = true;
    try {
      if (cashOutToAccount || fullyUnlocked) {
        table.cashOutPlayer(playerId);
        remainingStack = 0n;
        stillSeated = false;
        if (!cashOutToAccount) {
          clearPlaythrough(playerId);
        }
      } else {
        const debit = table.debitStack(playerId, withdrawMojos);
        remainingStack = debit.remaining;
        stillSeated = debit.remaining > 0n;
        consumePlaythroughWithdraw(playerId, withdrawMojos);
        if (stillSeated) {
          table.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
        }
      }
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }

    const credited = cashOutToAccount ? stack : withdrawMojos;
    const accountMojos = creditAccount(playerId, credited);
    if (cashOutToAccount) {
      syncPlaythroughHeld(playerId, accountMojos);
      clearBuyIn(tableId, playerId);
    } else if (!stillSeated) {
      syncPlaythroughHeld(playerId, accountMojos);
      clearBuyIn(tableId, playerId);
    } else {
      syncPlaythroughHeld(playerId, getAccountBalance(playerId) + remainingStack);
    }

    const withdrawalId = randomUUID();
    if (!stillSeated) {
      recordWithdrawal({
        withdrawalId,
        tableId,
        playerId,
        stackMojos: credited.toString(),
        originalBuyInMojos: originalBuyInMojos.toString(),
        payoutMojos: payoutMojos.toString(),
        mode,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      ok: true,
      withdrawalId,
      stackMojos: credited.toString(),
      remainingStackMojos: remainingStack.toString(),
      stillSeated,
      unlockedMojos: cashOutToAccount
        ? playthroughView(playerId).unlockedMojos
        : withdrawMojos.toString(),
      originalBuyInMojos: originalBuyInMojos.toString(),
      payoutMojos: payoutMojos.toString(),
      payoutMode: payoutConfig.payoutMode,
      mode,
      offer,
      feeMojos: feeMojos.toString(),
      accountMojos: accountMojos.toString(),
      playthrough: playthroughView(playerId),
      note: cashOutToAccount
        ? "Table stack returned to your DAT account. Play-through progress is kept for the next sit."
        : mode === "offer"
          ? "Approve the treasury offer in Sage to receive unlocked DAT."
          : stillSeated
            ? "Unlocked DAT returned to your account. Remaining stack stays at the table until you play through more hands."
            : "Unlocked DAT returned to your DAT account. Configure DAT_TREASURY_PAYOUT_URL for on-chain CAT.",
    };
  });
}

