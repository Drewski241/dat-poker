import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { clearBuyIn, getBuyInRecord, hasBuyIn } from "../buy-in-store.js";
import {
  computeWithdrawPayout,
  readTreasuryPayoutConfig,
  requestTreasuryOffer,
} from "../treasury-payout.js";
import { getTableEngine } from "./tables.js";
import { hasWithdrawal, recordWithdrawal } from "../withdraw-store.js";
import {
  buildBuyInMessage,
  buildWithdrawMessage,
  readDatTokenConfig,
  type WithdrawProof,
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
      chiaGaming: {
        lobbyUrl: chia.lobbyBaseUrl,
        gameUrl: chia.gameBaseUrl,
      },
    };
  });

  app.get("/v1/wallet/dat-token", async () => readDatTokenConfig());

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
    const { tableId, seatIndex, buyInMojos, address } = req.query;
    if (!tableId || seatIndex === undefined || !buyInMojos || !address) {
      return reply.status(400).send({ error: "tableId, seatIndex, buyInMojos, and address required" });
    }
    const message = buildBuyInMessage({
      tableId,
      seatIndex: Number(seatIndex),
      buyInMojos,
      address,
    });
    return { message };
  });

  app.get<{
    Querystring: { tableId?: string; address?: string; stackMojos?: string };
  }>("/v1/wallet/withdraw/message", async (req, reply) => {
    const { tableId, address, stackMojos } = req.query;
    if (!tableId || !address || !stackMojos) {
      return reply.status(400).send({ error: "tableId, address, and stackMojos required" });
    }

    const table = getTableEngine(tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }

    const stack = table.getPlayerStack(address);
    if (stack === null) {
      return reply.status(400).send({ error: "Player not seated at table" });
    }
    if (stack.toString() !== stackMojos) {
      return reply.status(400).send({
        error: `Stack mismatch — refresh table (expected ${stack.toString()} mojos)`,
      });
    }

    const message = buildWithdrawMessage({ tableId, stackMojos, address });
    return { message, stackMojos: stack.toString() };
  });

  app.post<{
    Body: {
      tableId: string;
      playerId: string;
      withdrawProof?: WithdrawProof;
      devAck?: boolean;
    };
  }>("/v1/wallet/withdraw", async (req, reply) => {
    const { tableId, playerId, withdrawProof, devAck } = req.body;
    if (!tableId || !playerId) {
      return reply.status(400).send({ error: "tableId and playerId required" });
    }

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
          recipientAddress: playerId,
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
      note:
        mode === "ledger"
          ? payoutMojos > 0n
            ? "Virtual buy-in: table stack cleared. Configure DAT_TREASURY_PAYOUT_URL for on-chain winnings."
            : "Table stack cleared. No net winnings to pay out."
          : "Approve the treasury offer in Sage to receive DAT.",
    };
  });
}
