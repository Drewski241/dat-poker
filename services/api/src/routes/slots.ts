import type { FastifyInstance } from "fastify";
import {
  SLOTS_BET_OPTIONS_MOJOS,
  SLOTS_DEFAULT_BET_PER_LINE_MOJOS,
  SLOTS_LINE_COUNT,
  SLOT_PAYTABLE,
  type SlotSpin,
} from "@dat-poker/game-engine";
import { loginSlots, spinSlotsAccount, type SlotsAccount } from "../slots-session.js";

function presentAccount(account: SlotsAccount) {
  return {
    playerId: account.playerId,
    displayName: account.displayName,
    bankrollMojos: account.bankrollMojos.toString(),
    lines: SLOTS_LINE_COUNT,
    betOptionsMojos: SLOTS_BET_OPTIONS_MOJOS.map((bet) => bet.toString()),
    defaultBetPerLineMojos: SLOTS_DEFAULT_BET_PER_LINE_MOJOS.toString(),
    paytable: SLOT_PAYTABLE,
  };
}

function presentSpin(account: SlotsAccount, spin: SlotSpin) {
  return {
    grid: spin.grid,
    wins: spin.wins.map((win) => ({
      lineIndex: win.lineIndex,
      symbol: win.symbol,
      multiplier: win.multiplier,
      payoutMojos: win.payoutMojos.toString(),
      cells: win.cells,
    })),
    totalBetMojos: spin.totalBetMojos.toString(),
    payoutMojos: spin.payoutMojos.toString(),
    bigWin: spin.bigWin,
    bankrollMojos: account.bankrollMojos.toString(),
  };
}

export function registerSlotsRoutes(app: FastifyInstance): void {
  app.post<{ Body: { displayName?: unknown } }>("/v1/slots/login", async (req, reply) => {
    const result = loginSlots(req.body?.displayName);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }
    return presentAccount(result.account);
  });

  app.post<{ Body: { playerId?: unknown; betPerLineMojos?: unknown } }>(
    "/v1/slots/spin",
    async (req, reply) => {
      const playerId = req.body?.playerId;
      const rawBet = req.body?.betPerLineMojos;
      if (typeof playerId !== "string" || playerId.length === 0) {
        return reply.status(400).send({ error: "Log in before you spin." });
      }
      if (typeof rawBet !== "string" || !/^\d+$/.test(rawBet)) {
        return reply.status(400).send({ error: "Pick one of the listed bets." });
      }
      const result = spinSlotsAccount(playerId, BigInt(rawBet));
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error });
      }
      return presentSpin(result.account, result.spin);
    },
  );
}
