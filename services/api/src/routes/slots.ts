import type { FastifyInstance } from "fastify";
import { DAT_PLAY_DEFAULTS, resolveDatSpinCostMojos } from "@dat-poker/shared";
import {
  evaluateSpin,
  isProgressiveJackpotGrid,
  PAYLINES,
  spinGrid,
  type SpinResult,
  winTier,
} from "@dat-poker/slot-engine";
import {
  contributeToJackpot,
  payoutProgressiveJackpot,
  readProgressiveJackpotMojos,
} from "../jackpot-store.js";
import { getTableEngine } from "./tables.js";

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
  }));

  app.post<{
    Body: { tableId: string; playerId: string };
  }>("/v1/slots/spin", async (req, reply) => {
    const { tableId, playerId } = req.body;
    if (!tableId || !playerId) {
      return reply.status(400).send({ error: "tableId and playerId required" });
    }

    const table = getTableEngine(tableId);
    if (!table) {
      return reply.status(404).send({ error: "Table not found" });
    }
    if (table.isHandInProgress()) {
      return reply.status(400).send({ error: "Finish your poker hand before spinning" });
    }

    const spinCostMojos = resolveDatSpinCostMojos(process.env.DAT_SPIN_COST_MOJOS);
    const stack = table.getPlayerStack(playerId);
    if (stack === null) {
      return reply.status(400).send({ error: "Redeem daily play chips first" });
    }
    if (stack < spinCostMojos) {
      return reply.status(400).send({ error: "Insufficient stack for spin" });
    }

    const lineBetMojos = spinCostMojos / BigInt(PAYLINES.length);
    const lineBet = Number(lineBetMojos > 0n ? lineBetMojos : 1n);
    const grid = spinGrid();
    const result = evaluateSpin(grid, lineBet);

    let progressiveWinMojos = 0n;
    let wonProgressive = false;
    if (isProgressiveJackpotGrid(grid)) {
      progressiveWinMojos = payoutProgressiveJackpot();
      wonProgressive = true;
    } else {
      contributeToJackpot(spinCostMojos, DAT_PLAY_DEFAULTS.jackpotContributionBps);
    }

    const lineWinMojos = BigInt(result.totalPayout) * lineBetMojos;
    const netMojos = lineWinMojos + progressiveWinMojos - spinCostMojos;

    try {
      const newStack = table.adjustPlayerStack(playerId, netMojos);
      const client = spinResultToClient(result, lineBetMojos);

      return {
        ok: true,
        spinCostMojos: spinCostMojos.toString(),
        lineWinMojos: lineWinMojos.toString(),
        progressiveWinMojos: progressiveWinMojos.toString(),
        wonProgressive,
        netMojos: netMojos.toString(),
        stackMojos: newStack.toString(),
        progressiveJackpotMojos: readProgressiveJackpotMojos().toString(),
        result: {
          ...client,
          winTier: wonProgressive ? "jackpot" : client.winTier,
        },
      };
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
