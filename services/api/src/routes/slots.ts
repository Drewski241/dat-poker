import type { FastifyInstance } from "fastify";
import {
  DAT_PLAY_DEFAULTS,
  DAT_SLOT_BET_MOJOS,
  isSlotGameId,
  parseSlotBetMojos,
  SLOT_GAMES,
  SLOT_GAME_IDS,
  type SlotGameId,
} from "@dat-poker/shared";
import { PAYLINES, type SlotSpinCore } from "@dat-poker/slot-engine";
import {
  evaluatePokerSpin,
  isProgressiveWin,
  redrawPokerGrid,
  shouldOfferHoldDraw,
  spinForGame,
  tierForResult,
} from "@dat-poker/slot-engine";
import { creditAccount, debitAccount, getAccountBalance } from "../account-store.js";
import {
  contributeToJackpot,
  payoutProgressiveJackpot,
  readAllProgressiveJackpots,
  readProgressiveJackpotMojos,
} from "../jackpot-store.js";
import {
  clearPokerHoldPending,
  getHouseEdgeState,
  setHouseEdgeState,
  setPokerHoldPending,
  takePokerHoldPending,
} from "../slot-player-state.js";
import { requirePlayer, sessionMatchesClaim } from "../player-session.js";
import { findSeatedPlayerTable } from "./tables.js";

function spinResultToClient(result: SlotSpinCore, lineBetMojos: bigint) {
  return {
    grid: result.grid,
    lineWins: result.lineWins.map((w) => ({
      ...w,
      payout: (BigInt(w.payout) * lineBetMojos).toString(),
    })),
    waysWins: result.waysWins.map((w) => ({
      ...w,
      payout: (BigInt(w.payout) * lineBetMojos).toString(),
    })),
    scatterCount: result.scatterCount,
    scatterMultiplier: result.scatterMultiplier,
    totalMultiplier: result.totalMultiplier,
    totalPayoutMojos: (BigInt(result.totalPayout) * lineBetMojos).toString(),
    winTier: tierForResult(result),
    meta: result.meta ?? {},
  };
}

async function handleSpin(
  gameId: SlotGameId,
  playerId: string,
  betMojos: bigint,
  opts?: { skipDebit?: boolean },
) {
  const lineBetMojos = betMojos / BigInt(PAYLINES.length);
  const houseState = gameId === "house-edge" ? getHouseEdgeState(playerId) : undefined;
  const isFreeBossSpin = gameId === "house-edge" && (houseState?.freeSpinsRemaining ?? 0) > 0;

  const spun = spinForGame(gameId, 1, houseState);
  const result: SlotSpinCore = spun;
  if (spun.nextHouseState) {
    setHouseEdgeState(playerId, spun.nextHouseState);
  }

  const bossBonusActive =
    gameId === "house-edge" &&
    Boolean((result.meta as { bossBonusActive?: boolean } | undefined)?.bossBonusActive);

  let progressiveWinMojos = 0n;
  let wonProgressive = false;
  if (isProgressiveWin(gameId, result.grid, bossBonusActive)) {
    progressiveWinMojos = payoutProgressiveJackpot(gameId);
    wonProgressive = true;
  } else if (!isFreeBossSpin) {
    contributeToJackpot(gameId, betMojos, DAT_PLAY_DEFAULTS.jackpotContributionBps);
  }

  const lineWinMojos = BigInt(result.totalPayout) * lineBetMojos;
  const grossWinMojos = lineWinMojos + progressiveWinMojos;

  if (!opts?.skipDebit && !isFreeBossSpin) {
    debitAccount(playerId, betMojos, { type: "debit", ref: `slots-${gameId}` });
  }
  if (grossWinMojos > 0n) {
    creditAccount(playerId, grossWinMojos, { type: "credit", ref: `slots-win-${gameId}` });
  }

  const client = spinResultToClient(result, lineBetMojos);
  let holdDrawOffer: { heldReels: number[] } | undefined;
  if (gameId === "poker-hands" && shouldOfferHoldDraw(result.lineWins)) {
    setPokerHoldPending(playerId, result.grid, betMojos.toString());
    holdDrawOffer = { heldReels: [] };
  }

  return {
    ok: true,
    gameId,
    betMojos: betMojos.toString(),
    lineWinMojos: lineWinMojos.toString(),
    progressiveWinMojos: progressiveWinMojos.toString(),
    wonProgressive,
    netMojos: ((isFreeBossSpin ? grossWinMojos : grossWinMojos - betMojos)).toString(),
    accountBalanceMojos: getAccountBalance(playerId).toString(),
    progressiveJackpotMojos: readProgressiveJackpotMojos(gameId).toString(),
    progressiveJackpots: readAllProgressiveJackpots(),
    freeSpin: isFreeBossSpin,
    holdDrawOffer,
    result: {
      ...client,
      winTier: wonProgressive ? "jackpot" : client.winTier,
    },
  };
}

export function registerSlotsRoutes(app: FastifyInstance): void {
  app.get("/v1/slots/catalog", async () => ({
    games: SLOT_GAME_IDS.map((id) => ({
      ...SLOT_GAMES[id],
      progressiveJackpotMojos: readProgressiveJackpotMojos(id).toString(),
    })),
    betOptionsMojos: DAT_SLOT_BET_MOJOS.map((m) => m.toString()),
    defaultBetMojos: DAT_SLOT_BET_MOJOS[0]!.toString(),
    paylineEvalVersion: 2,
  }));

  app.get("/v1/slots/jackpot", async () => ({
    progressiveJackpotMojos: readProgressiveJackpotMojos("spirit").toString(),
    betOptionsMojos: DAT_SLOT_BET_MOJOS.map((m) => m.toString()),
    defaultBetMojos: DAT_SLOT_BET_MOJOS[0]!.toString(),
    paylineEvalVersion: 2,
  }));

  app.get<{ Params: { gameId: string } }>("/v1/slots/:gameId/jackpot", async (req, reply) => {
    const { gameId } = req.params;
    if (!isSlotGameId(gameId)) {
      return reply.status(404).send({ error: "Unknown slot game" });
    }
    return {
      gameId,
      progressiveJackpotMojos: readProgressiveJackpotMojos(gameId).toString(),
      betOptionsMojos: DAT_SLOT_BET_MOJOS.map((m) => m.toString()),
      defaultBetMojos: DAT_SLOT_BET_MOJOS[0]!.toString(),
      title: SLOT_GAMES[gameId].title,
    };
  });

  const spinHandler = async (
    gameId: SlotGameId,
    req: { body?: { playerId?: string; betMojos?: string } },
    reply: { status: (c: number) => { send: (b: unknown) => unknown } },
  ) => {
    const session = requirePlayer(req as never, reply as never);
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
    const houseState = gameId === "house-edge" ? getHouseEdgeState(playerId) : undefined;
    const isFreeBossSpin = gameId === "house-edge" && (houseState?.freeSpinsRemaining ?? 0) > 0;

    if (!isFreeBossSpin && balance < betMojos) {
      return reply.status(400).send({ error: "Insufficient account DAT for this bet" });
    }

    try {
      return await handleSpin(gameId, playerId, betMojos);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  };

  app.post<{ Body: { playerId?: string; betMojos?: string } }>(
    "/v1/slots/spin",
    async (req, reply) => spinHandler("spirit", req, reply),
  );

  app.post<{ Params: { gameId: string }; Body: { playerId?: string; betMojos?: string } }>(
    "/v1/slots/:gameId/spin",
    async (req, reply) => {
      const { gameId } = req.params;
      if (!isSlotGameId(gameId)) {
        return reply.status(404).send({ error: "Unknown slot game" });
      }
      return spinHandler(gameId, req, reply);
    },
  );

  app.post<{
    Body: { playerId?: string; heldReels?: number[] };
  }>("/v1/slots/poker-hands/draw", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;

    const { playerId, heldReels } = req.body ?? {};
    if (!playerId) {
      return reply.status(400).send({ error: "playerId required" });
    }
    if (!sessionMatchesClaim(session, playerId)) {
      return reply.status(403).send({ error: "playerId does not match the signed-in account" });
    }

    const pending = takePokerHoldPending(playerId);
    if (!pending) {
      return reply.status(400).send({ error: "No hold & draw offer active — spin first" });
    }

    const holds = (heldReels ?? [])
      .filter((r) => Number.isInteger(r) && r >= 0 && r < 5)
      .slice(0, 2);
    const betMojos = BigInt(pending.betMojos);
    const lineBetMojos = betMojos / BigInt(PAYLINES.length);
    const grid = redrawPokerGrid(pending.grid, holds);
    const result = evaluatePokerSpin(grid, 1);
    const lineWinMojos = BigInt(result.totalPayout) * lineBetMojos;

    let progressiveWinMojos = 0n;
    let wonProgressive = false;
    if (isProgressiveWin("poker-hands", grid, false)) {
      progressiveWinMojos = payoutProgressiveJackpot("poker-hands");
      wonProgressive = true;
    }

    const grossWinMojos = lineWinMojos + progressiveWinMojos;
    if (grossWinMojos > 0n) {
      creditAccount(playerId, grossWinMojos, { type: "credit", ref: "slots-win-poker-hands-draw" });
    }

    const client = spinResultToClient(result, lineBetMojos);
    return {
      ok: true,
      gameId: "poker-hands",
      drawPhase: true,
      heldReels: holds,
      betMojos: betMojos.toString(),
      lineWinMojos: lineWinMojos.toString(),
      progressiveWinMojos: progressiveWinMojos.toString(),
      wonProgressive,
      netMojos: grossWinMojos.toString(),
      accountBalanceMojos: getAccountBalance(playerId).toString(),
      progressiveJackpotMojos: readProgressiveJackpotMojos("poker-hands").toString(),
      result: {
        ...client,
        winTier: wonProgressive ? "jackpot" : client.winTier,
      },
    };
  });

  app.post<{ Body: { playerId?: string } }>(
    "/v1/slots/poker-hands/skip-draw",
    async (req, reply) => {
      const session = requirePlayer(req, reply);
      if (!session) return;
      const { playerId } = req.body ?? {};
      if (!playerId) {
        return reply.status(400).send({ error: "playerId required" });
      }
      clearPokerHoldPending(playerId);
      return { ok: true };
    },
  );
}
