import type { FastifyInstance } from "fastify";
import {
  DAT_PLAY_DEFAULTS,
  resolveDatDailyRedeemMojos,
  resolveDatSpinCostMojos,
} from "@dat-poker/shared";
import { recordBuyIn } from "../buy-in-store.js";
import {
  buildDailyRedeemMessage,
  readDatTokenConfig,
  type BuyInProof,
  validateDailyRedeemProof,
} from "../wallet-config.js";
import { clearPlaySession, getPlaySession, setPlaySession, utcDayKey } from "../play-session-store.js";
import { createSpiritTable, resolveConfiguredDailyRedeemMojos } from "../table-factory.js";
import { unregisterTableEngine } from "./tables.js";
import { getTableEngine } from "./tables.js";
import { readProgressiveJackpotMojos } from "../jackpot-store.js";

const HOUSE_PLAYER_ID = "dat-poker:house";

export function registerPlayRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { playerId?: string } }>("/v1/play/session", async (req, reply) => {
    const { playerId } = req.query;
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }

    const session = getPlaySession(playerId);
    const today = utcDayKey();
    const spinCostMojos = resolveDatSpinCostMojos(process.env.DAT_SPIN_COST_MOJOS).toString();
    const dailyRedeemMojos = resolveConfiguredDailyRedeemMojos().toString();

    if (!session) {
      return {
        active: false,
        redeemAvailable: true,
        redeemUtcDay: today,
        dailyRedeemMojos,
        spinCostMojos,
        progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
      };
    }

    const table = getTableEngine(session.tableId);
    if (!table) {
      clearPlaySession(playerId);
      return {
        active: false,
        redeemAvailable: true,
        redeemUtcDay: today,
        dailyRedeemMojos,
        spinCostMojos,
        progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
      };
    }

    const stack = table.getPlayerStack(playerId);
    const active = stack !== null;
    if (!active) {
      clearPlaySession(playerId);
    }

    return {
      active,
      tableId: session.tableId,
      stackMojos: stack?.toString() ?? "0",
      redeemUtcDay: session.redeemUtcDay,
      redeemAvailable: session.redeemUtcDay !== today && !active,
      alreadyRedeemedToday: session.redeemUtcDay === today,
      dailyRedeemMojos,
      spinCostMojos,
      handInProgress: table.isHandInProgress(),
      progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
    };
  });

  app.get<{ Querystring: { address?: string; redeemMojos?: string } }>(
    "/v1/play/redeem/message",
    async (req, reply) => {
      const { address, redeemMojos } = req.query;
      if (!address) {
        return reply.status(400).send({ error: "address required" });
      }
      const amount = redeemMojos ?? resolveConfiguredDailyRedeemMojos().toString();
      const message = buildDailyRedeemMessage({
        utcDay: utcDayKey(),
        redeemMojos: amount,
        address,
      });
      return { message, redeemMojos: amount, utcDay: utcDayKey() };
    },
  );

  app.post<{
    Body: {
      playerId: string;
      redeemProof?: BuyInProof;
      devAck?: boolean;
    };
  }>("/v1/play/redeem-daily", async (req, reply) => {
    const { playerId, redeemProof, devAck } = req.body;
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }

    const dat = readDatTokenConfig();
    const redeemMojos = resolveConfiguredDailyRedeemMojos();
    const today = utcDayKey();
    const existing = getPlaySession(playerId);

    if (existing) {
      const table = getTableEngine(existing.tableId);
      const stack = table?.getPlayerStack(playerId) ?? null;
      if (existing.redeemUtcDay === today && stack !== null) {
        return {
          ok: true,
          tableId: existing.tableId,
          stackMojos: stack.toString(),
          redeemMojos: existing.redeemMojos,
          alreadyRedeemedToday: true,
          progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
        };
      }
      if (stack !== null && stack > 0n) {
        return reply.status(400).send({
          error: "Withdraw your current play stack before redeeming a new daily session",
        });
      }
    }

    if (!dat.devBuyInEnabled) {
      if (!dat.assetId) {
        return reply.status(503).send({ error: "DAT token not configured" });
      }
      if (!redeemProof) {
        return reply.status(400).send({ error: "Daily redeem wallet proof required" });
      }
      const proofError = validateDailyRedeemProof(redeemProof, {
        playerId,
        redeemMojos: redeemMojos.toString(),
        utcDay: today,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
    } else if (!devAck && dat.assetId && redeemProof) {
      const proofError = validateDailyRedeemProof(redeemProof, {
        playerId,
        redeemMojos: redeemMojos.toString(),
        utcDay: today,
      });
      if (proofError) {
        return reply.status(400).send({ error: proofError });
      }
    }

    const { tableId, engine } = createSpiritTable();
    try {
      engine.seatPlayer(playerId, 0, redeemMojos);
      engine.seatPlayer(HOUSE_PLAYER_ID, 1, redeemMojos);
    } catch (e) {
      unregisterTableEngine(tableId);
      return reply.status(400).send({ error: (e as Error).message });
    }

    const proof = redeemProof ?? {
      address: playerId,
      message: buildDailyRedeemMessage({
        utcDay: today,
        redeemMojos: redeemMojos.toString(),
        address: playerId,
      }),
      signature: "",
      pubkey: "",
    };
    recordBuyIn(tableId, playerId, proof, redeemMojos.toString());
    setPlaySession({
      playerId,
      tableId,
      redeemUtcDay: today,
      redeemMojos: redeemMojos.toString(),
    });

    return {
      ok: true,
      tableId,
      stackMojos: redeemMojos.toString(),
      redeemMojos: redeemMojos.toString(),
      alreadyRedeemedToday: false,
      spinCostMojos: resolveDatSpinCostMojos(process.env.DAT_SPIN_COST_MOJOS).toString(),
      progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
      note: `Daily play chips (${redeemMojos.toString()} mojos) — shared for poker and slots. Withdraw when done.`,
    };
  });

  app.get("/v1/play/config", async () => {
    const dailyRedeemMojos = resolveDatDailyRedeemMojos(process.env.DAT_DAILY_REDEEM_MOJOS).toString();
    return {
      dailyRedeemMojos,
      spinCostMojos: resolveDatSpinCostMojos(process.env.DAT_SPIN_COST_MOJOS).toString(),
      jackpotContributionBps: DAT_PLAY_DEFAULTS.jackpotContributionBps,
      progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
    };
  });
}
