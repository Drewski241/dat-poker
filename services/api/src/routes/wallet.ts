import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import {
  playthroughHandsRequired,
  playthroughWithdrawableMojos,
  resolveDatDailyRedeemMojos,
  utcDateKey,
} from "@dat-poker/shared";
import { clearBuyIn, getBuyInRecord, hasBuyIn } from "../buy-in-store.js";
import {
  consumePlaythroughWithdraw,
  creditAccount,
  debitAccount,
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
  looksLikeXchAddress,
  onChainSageWithdrawEnabled,
  inspectTreasuryPayout,
  readTreasuryPayoutConfig,
  requestTreasuryOffer,
  sageLedgerWithdrawNote,
  sageOfferWithdrawNote,
  treasurySelfPayoutError,
} from "../treasury-payout.js";
import { getUserById } from "../user-store.js";
import { getTableEngine, persistTablePlaythrough, playthroughFields } from "./tables.js";
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
  return playthroughFields(playerId);
}

async function playerSagePayoutAddress(
  session: {
    playerId: string;
    displayAddress: string;
  },
  requested?: string,
): Promise<string | null> {
  if (requested && looksLikeXchAddress(requested)) {
    return requested.trim();
  }
  if (looksLikeXchAddress(session.displayAddress)) {
    return session.displayAddress.trim();
  }
  const user = await getUserById(session.playerId);
  if (user?.sageAddress && looksLikeXchAddress(user.sageAddress)) {
    return user.sageAddress.trim();
  }
  return null;
}

async function requestPlayerTreasuryOffer(params: {
  playerId: string;
  displayAddress: string;
  amountMojos: bigint;
  assetId: string;
  treasuryPayoutUrl: string;
  requestedAddress?: string;
}): Promise<{ offer: string } | { error: string; status: number } | { skipped: string }> {
  if (!onChainSageWithdrawEnabled()) {
    return { skipped: sageLedgerWithdrawNote("table") };
  }
  const ping = await inspectTreasuryPayout(params.treasuryPayoutUrl);
  if (!ping.reachable) {
    return {
      status: 502,
      error: `Treasury is not reachable at ${ping.host}${ping.error ? ` (${ping.error})` : ""}.`,
    };
  }
  if (ping.offerMode === "rpc" && ping.walletConfigured === false) {
    return {
      status: 502,
      error:
        ping.error ??
        "Sage RPC certs are missing on the AWS host. Run: sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh",
    };
  }
  if (ping.offerMode === "rpc" && ping.walletRpcReachable === false) {
    return {
      status: 502,
      error:
        "Treasury HTTP is up, but Sage RPC is not logged in on that host. Enable RPC :9257 and TREASURY_SAGE_FINGERPRINT, then try again.",
    };
  }
  const address = await playerSagePayoutAddress(params, params.requestedAddress);
  if (!address) {
    return {
      status: 400,
      error: "Link a player Sage wallet first (not the treasury key). Then click Withdraw again.",
    };
  }
  const self = treasurySelfPayoutError(address);
  if (self) {
    return { status: 400, error: self };
  }
  try {
    const offer = await requestTreasuryOffer({
      assetId: params.assetId,
      recipientAddress: address,
      amountMojos: params.amountMojos,
      treasuryPayoutUrl: params.treasuryPayoutUrl,
    });
    if (!offer) {
      return {
        status: 502,
        error: "Treasury did not return an offer. Check Sage RPC and DAT balance on the AWS host.",
      };
    }
    return { offer };
  } catch (e) {
    return { status: 502, error: (e as Error).message };
  }
}

function isSngEngine(table: NlheTableEngine | undefined): boolean {
  return table?.getConfig().format === "sng" || table?.getConfig().format === "mtt";
}

function unlockedFromHeld(playerId: string, heldMojos: bigint): bigint {
  const pt = getPlaythrough(playerId);
  const required = playthroughHandsRequired(pt.poolMojos);
  if (required > 0 && pt.handsPlayed >= required) {
    return heldMojos < 0n ? 0n : heldMojos;
  }
  return playthroughWithdrawableMojos(pt.handsPlayed, pt.poolMojos, heldMojos);
}

function unlockedTableWithdrawMojos(table: NlheTableEngine, playerId: string): bigint {
  const stack = table.getPlayerStack(playerId);
  if (stack === null) return 0n;
  return unlockedFromHeld(playerId, stack);
}

function unlockedAccountWithdrawMojos(playerId: string): bigint {
  return BigInt(playthroughView(playerId).withdrawableMojos);
}

function sagePlaythroughBlock(playerId: string, available: bigint): string | null {
  if (available > 0n) return null;
  const view = playthroughView(playerId);
  if (view.handsRequired <= 0) {
    return "No DAT is unlocked for withdraw yet. Buy in and complete hands — each hand unlocks 1 DAT.";
  }
  const unlocked = BigInt(view.unlockedMojos);
  if (unlocked > 0n && getAccountBalance(playerId) <= 0n) {
    return "SNG hands unlocked DAT, but Sage withdraw uses leftover account chips or a 1st–3rd prize. Redeem or finish in the money, then withdraw the unlocked amount.";
  }
  if (view.playthroughRemaining <= 0) {
    return getAccountBalance(playerId) <= 0n
      ? "Unlocked DAT needs leftover account chips or an SNG prize before it can leave."
      : null;
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
        ...(payout.treasuryPayoutUrl
          ? await inspectTreasuryPayout(payout.treasuryPayoutUrl).then((ping) => ({
              treasuryReachable: ping.reachable,
              treasuryHost: ping.host,
              treasuryError:
                ping.reachable && ping.offerMode === "rpc" && ping.walletConfigured === false
                  ? (ping.error ??
                    "Sage RPC certs missing. Run sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh")
                  : ping.reachable && ping.offerMode === "rpc" && ping.walletRpcReachable === false
                    ? "Sage RPC is not logged in on the treasury host"
                    : ping.error,
              treasuryWalletRpcReachable: ping.walletRpcReachable,
            }))
          : {
              treasuryReachable: false,
              treasuryHost: null,
              treasuryError: null,
              treasuryWalletRpcReachable: null,
            }),
        onChainPayoutEnabled: onChainSageWithdrawEnabled(),
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
      playthrough: playthroughView(playerId),
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
      ...(payout.treasuryPayoutUrl
        ? await inspectTreasuryPayout(payout.treasuryPayoutUrl).then((ping) => ({
            treasuryReachable: ping.reachable,
            treasuryHost: ping.host,
            treasuryError: ping.error,
          }))
        : { treasuryReachable: false, treasuryHost: null, treasuryError: null }),
      onChainPayoutEnabled: onChainSageWithdrawEnabled(),
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
    Querystring: { tableId?: string; address?: string; stackMojos?: string; fromAccount?: string };
  }>("/v1/wallet/withdraw/message", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, stackMojos } = req.query;
    const fromAccount = req.query.fromAccount === "1" || req.query.fromAccount === "true";
    if (!sessionMatchesClaim(session, req.query.address)) {
      return reply.status(403).send({ error: "address does not match the signed-in account" });
    }

    const playerId = session.playerId;
    const table = tableId ? getTableEngine(tableId) : undefined;
    if (tableId && !fromAccount && !table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table?.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }
    if (table) persistTablePlaythrough(table);

    const useAccount = fromAccount || !table || isSngEngine(table) || table.getPlayerStack(playerId) === null;
    const withdrawMojos = useAccount
      ? unlockedAccountWithdrawMojos(playerId)
      : unlockedTableWithdrawMojos(table!, playerId);
    const blocked = sagePlaythroughBlock(playerId, withdrawMojos);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }
    if (stackMojos && stackMojos !== withdrawMojos.toString()) {
      return reply.status(400).send({
        error: `Stack mismatch — refresh table (expected ${withdrawMojos.toString()} unlocked mojos)`,
      });
    }

    const message = buildWithdrawMessage({
      tableId: useAccount ? tableId || "account" : tableId!,
      stackMojos: withdrawMojos.toString(),
      address: session.displayAddress,
    });
    return { message, stackMojos: withdrawMojos.toString(), unlockedMojos: withdrawMojos.toString() };
  });

  app.post<{
    Body: {
      tableId?: string;
      playerId?: string;
      withdrawProof?: WithdrawProof;
      devAck?: boolean;
      toAccount?: boolean;
      fromAccount?: boolean;
      address?: string;
    };
  }>("/v1/wallet/withdraw", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const { tableId, withdrawProof, devAck, toAccount, fromAccount, address } = req.body;
    if (!sessionMatchesClaim(session, req.body.playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }
    const playerId = session.playerId;
    const table = tableId ? getTableEngine(tableId) : undefined;
    if (tableId && !fromAccount && !toAccount && !table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table?.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish the current hand before withdrawing" });
    }
    if (table) persistTablePlaythrough(table);

    const cashOutToAccount = Boolean(toAccount);
    if (cashOutToAccount) {
      if (!table || !tableId) {
        return reply.status(400).send({ error: "tableId required" });
      }
      if (isSngEngine(table)) {
        return reply.status(400).send({
          error: "Sit-n-go stacks are tournament chips. Prizes credit your account; SNG hands unlock DAT from leftover chips or prizes.",
        });
      }
    }

    const seatedStack = table?.getPlayerStack(playerId) ?? null;
    const useAccount =
      Boolean(fromAccount) ||
      !cashOutToAccount && (isSngEngine(table) || seatedStack === null);

    if (!useAccount && seatedStack === null) {
      return reply.status(400).send({ error: "Player not seated at table" });
    }

    const dat = readDatTokenConfig();
    const payoutConfig = readTreasuryPayoutConfig();
    const stack = seatedStack ?? 0n;
    const withdrawKey = tableId || "account";

    if (useAccount) {
      const withdrawMojos = unlockedAccountWithdrawMojos(playerId);
      const blocked = sagePlaythroughBlock(playerId, withdrawMojos);
      if (blocked) {
        return reply.status(400).send({ error: blocked });
      }
      if (withdrawMojos <= 0n) {
        return reply.status(400).send({ error: "Nothing unlocked" });
      }

      if (!dat.devBuyInEnabled) {
        if (!dat.assetId) {
          return reply.status(503).send({ error: "DAT token not configured" });
        }
        if (!withdrawProof) {
          return reply.status(400).send({ error: "Wallet withdraw proof required" });
        }
        const proofError = validateWithdrawProof(withdrawProof, {
          tableId: withdrawKey,
          stackMojos: withdrawMojos.toString(),
          playerId,
          address: session.displayAddress,
        });
        if (proofError) {
          return reply.status(400).send({ error: proofError });
        }
      } else if (!devAck) {
        if (dat.assetId && withdrawProof) {
          const proofError = validateWithdrawProof(withdrawProof, {
            tableId: withdrawKey,
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

      let mode: "ledger" | "offer" = "ledger";
      let offer: string | undefined;
      let accountMojos = getAccountBalance(playerId);
      let offerNote: string | undefined;
      if (payoutConfig.treasuryPayoutUrl && dat.assetId) {
        const payout = await requestPlayerTreasuryOffer({
          playerId,
          displayAddress: session.displayAddress,
          amountMojos: withdrawMojos,
          assetId: dat.assetId,
          treasuryPayoutUrl: payoutConfig.treasuryPayoutUrl,
          requestedAddress: address,
        });
        if ("error" in payout) {
          return reply.status(payout.status).send({ error: payout.error });
        }
        if ("offer" in payout) {
          accountMojos = debitAccount(playerId, withdrawMojos);
          mode = "offer";
          offer = payout.offer;
        } else {
          offerNote = payout.skipped;
        }
      }
      consumePlaythroughWithdraw(playerId, withdrawMojos);
      if (table && seatedStack !== null) {
        table.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
      }
      syncPlaythroughHeld(playerId, getAccountBalance(playerId));

      const withdrawalId = randomUUID();
      recordWithdrawal({
        withdrawalId,
        tableId: withdrawKey,
        playerId,
        stackMojos: withdrawMojos.toString(),
        originalBuyInMojos: withdrawMojos.toString(),
        payoutMojos: withdrawMojos.toString(),
        mode,
        createdAt: new Date().toISOString(),
      });

      return {
        ok: true,
        withdrawalId,
        stackMojos: withdrawMojos.toString(),
        remainingStackMojos: stack.toString(),
        stillSeated: seatedStack !== null,
        unlockedMojos: withdrawMojos.toString(),
        originalBuyInMojos: withdrawMojos.toString(),
        payoutMojos: withdrawMojos.toString(),
        payoutMode: payoutConfig.payoutMode,
        mode,
        offer,
        feeMojos: payoutConfig.withdrawFeeMojos.toString(),
        accountMojos: accountMojos.toString(),
        playthrough: playthroughView(playerId),
        note:
          mode === "offer" ? sageOfferWithdrawNote() : (offerNote ?? sageLedgerWithdrawNote("sng")),
      };
    }

    if (!cashOutToAccount) {
      if (tableId && hasWithdrawal(tableId, playerId)) {
        return reply.status(400).send({ error: "Withdrawal already completed for this table session" });
      }
      const blocked = sagePlaythroughBlock(playerId, unlockedTableWithdrawMojos(table!, playerId));
      if (blocked) {
        return reply.status(400).send({ error: blocked });
      }
    }

    const ptNow = getPlaythrough(playerId);
    const requiredNow = playthroughHandsRequired(ptNow.poolMojos);
    const fullyUnlocked = requiredNow > 0 && ptNow.handsPlayed >= requiredNow;
    const withdrawMojos = cashOutToAccount || fullyUnlocked ? stack : unlockedTableWithdrawMojos(table!, playerId);
    if (!cashOutToAccount && !fullyUnlocked && withdrawMojos <= 0n) {
      return reply.status(400).send({
        error: sagePlaythroughBlock(playerId, withdrawMojos) ?? "Nothing unlocked",
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
        tableId: tableId!,
        stackMojos: withdrawMojos.toString(),
        playerId,
        address: session.displayAddress,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
      if (!hasBuyIn(tableId!, playerId)) {
        return reply.status(400).send({ error: "No verified buy-in found for this player" });
      }
    } else if (!cashOutToAccount && !devAck) {
      if (dat.assetId && withdrawProof) {
        const proofError = validateWithdrawProof(withdrawProof, {
          tableId: tableId!,
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

    const buyInRecord = tableId ? getBuyInRecord(tableId, playerId) : undefined;
    const originalBuyInMojos = buyInRecord ? BigInt(buyInRecord.buyInMojos) : stack;
    const payoutMojos = cashOutToAccount
      ? computeWithdrawPayout(stack, originalBuyInMojos, payoutConfig.payoutMode)
      : withdrawMojos;

    let mode: "ledger" | "offer" = "ledger";
    let offer: string | undefined;
    let offerNote: string | undefined;
    const feeMojos = payoutConfig.withdrawFeeMojos;

    if (!cashOutToAccount && payoutMojos > 0n && payoutConfig.treasuryPayoutUrl && dat.assetId) {
      const payout = await requestPlayerTreasuryOffer({
        playerId,
        displayAddress: session.displayAddress,
        amountMojos: payoutMojos,
        assetId: dat.assetId,
        treasuryPayoutUrl: payoutConfig.treasuryPayoutUrl,
        requestedAddress: address,
      });
      if ("error" in payout) {
        return reply.status(payout.status).send({ error: payout.error });
      }
      if ("offer" in payout) {
        mode = "offer";
        offer = payout.offer;
      } else {
        offerNote = payout.skipped;
      }
    }

    let remainingStack = stack;
    let stillSeated = true;
    try {
      if (cashOutToAccount || fullyUnlocked) {
        table!.cashOutPlayer(playerId);
        remainingStack = 0n;
        stillSeated = false;
        if (!cashOutToAccount) {
          clearPlaythrough(playerId);
        }
      } else {
        const debit = table!.debitStack(playerId, withdrawMojos);
        remainingStack = debit.remaining;
        stillSeated = debit.remaining > 0n;
        consumePlaythroughWithdraw(playerId, withdrawMojos);
        if (stillSeated) {
          table!.setHandsPlayed(playerId, getPlaythrough(playerId).handsPlayed);
        }
      }
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }

    const credited = cashOutToAccount ? stack : withdrawMojos;
    const accountMojos = creditAccount(playerId, credited);
    if (cashOutToAccount) {
      syncPlaythroughHeld(playerId, accountMojos);
      if (tableId) clearBuyIn(tableId, playerId);
    } else if (!stillSeated) {
      syncPlaythroughHeld(playerId, accountMojos);
      if (tableId) clearBuyIn(tableId, playerId);
    } else {
      syncPlaythroughHeld(playerId, getAccountBalance(playerId) + remainingStack);
    }

    const withdrawalId = randomUUID();
    if (!stillSeated) {
      recordWithdrawal({
        withdrawalId,
        tableId: withdrawKey,
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
          ? sageOfferWithdrawNote()
          : (offerNote ?? sageLedgerWithdrawNote("table")),
    };
  });
}

