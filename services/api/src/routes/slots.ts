import type { FastifyInstance } from "fastify";
import {
  DAT_PLAY_DEFAULTS,
  DAT_SLOT_BET_MOJOS,
  parseSlotBetMojos,
} from "@dat-poker/shared";
import {
  evaluateSpin,
  isProgressiveJackpotGrid,
  PAYLINES,
  spinGrid,
  type SpinResult,
  winTier,
} from "@dat-poker/slot-engine";
import { creditAccount, debitAccount, getAccountBalance } from "../account-store.js";
import {
  contributeToJackpot,
  payoutProgressiveJackpot,
  readProgressiveJackpotMojos,
} from "../jackpot-store.js";
import { requirePlayer, sessionMatchesClaim } from "../player-session.js";
import { findSeatedPlayerTable } from "./tables.js";

function spinResultToClient(result: SpinResult, lineBetMojos: bigint) {
  return {
    grid: result.grid,
    lineWins: result.lineWins.map((w) => ({
      ...w,
      payout: (BigInt(w.payout) * lineBetMojos).toString(),
    })),
    scatterCount: result.scatterCount,
    scatterMultiplier: result.scatterMultiplier,
    totalMultiplier: result.totalMultiplier,
    totalPayoutMojos: (BigInt(result.totalPayout) * lineBetMojos).toString(),
    winTier: winTier(result.totalMultiplier),
  };
}

export function registerSlotsRoutes(app: FastifyInstance): void {
  app.get("/v1/slots/jackpot", async () => ({
    progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
    betOptionsMojos: DAT_SLOT_BET_MOJOS.map((m) => m.toString()),
    defaultBetMojos: DAT_SLOT_BET_MOJOS[0]!.toString(),
    /** Bumped when payline evaluation changes (left-run + wild rules). */
    paylineEvalVersion: 2,
  }));

  app.post<{
    Body: { playerId?: string; betMojos?: string };
  }>("/v1/slots/spin", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;

    const { playerId, betMojos: betRaw } = req.body ?? {};
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }
    if (!sessionMatchesClaim(session, playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }

    const betMojos = parseSlotBetMojos(betRaw);
    if (betMojos === null) {
      return reply.status(400).send({
        error: `Invalid bet. Choose one of: ${DAT_SLOT_BET_MOJOS.map((m) => m.toString()).join(", ")} mojos`,
      });
    }

    const seated = findSeatedPlayerTable(playerId);
    if (seated?.table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish your poker hand before spinning" });
    }

    const balance = getAccountBalance(playerId);
    if (balance < betMojos) {
      return reply.status(400).send({ error: "Insufficient account DAT for this bet" });
    }

    const lineBetMojos = betMojos / BigInt(PAYLINES.length);
    const grid = spinGrid();
    const result = evaluateSpin(grid, 1);

    let progressiveWinMojos = 0n;
    let wonProgressive = false;
    if (isProgressiveJackpotGrid(grid)) {
      progressiveWinMojos = payoutProgressiveJackpot();
      wonProgressive = true;
    } else {
      contributeToJackpot(betMojos, DAT_PLAY_DEFAULTS.jackpotContributionBps);
    }

    const lineWinMojos = BigInt(result.totalPayout) * lineBetMojos;
    const grossWinMojos = lineWinMojos + progressiveWinMojos;

    try {
      debitAccount(playerId, betMojos, { type: "debit", ref: "slots-spin" });
      if (grossWinMojos > 0n) {
        creditAccount(playerId, grossWinMojos, { type: "credit", ref: "slots-win" });
      }
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }

    const accountBalanceMojos = getAccountBalance(playerId);
    const client = spinResultToClient(result, lineBetMojos);

    return {
      ok: true,
      betMojos: betMojos.toString(),
      lineWinMojos: lineWinMojos.toString(),
      progressiveWinMojos: progressiveWinMojos.toString(),
      wonProgressive,
      netMojos: (grossWinMojos - betMojos).toString(),
      accountBalanceMojos: accountBalanceMojos.toString(),
      progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
      result: {
        ...client,
        winTier: wonProgressive ? "jackpot" : client.winTier,
      },
    };
  });
}
