import { randomInt, randomUUID } from "node:crypto";
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
  payoutDenominatorOf,
  payoutUnitsToMojos,
  redrawPokerGrid,
  shouldOfferHoldDraw,
  spinForGame,
  tierForResult,
  VAULT_BONUS_EVERY_N,
  buildVaultCards,
  flipVaultCard,
  vaultCollectedMultiplier,
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
  clearVaultBonus,
  getHouseEdgeState,
  getVaultBonus,
  setHouseEdgeState,
  setPokerHoldPending,
  setVaultBonus,
  takePokerHoldPending,
  type StoredVaultBonus,
} from "../slot-player-state.js";
import { requirePlayer, sessionMatchesClaim } from "../player-session.js";
import { findSeatedPlayerTable } from "./tables.js";

const VAULT_OPEN_ERROR = "The vault bonus is open. Flip your chips before the next spin.";

function vaultUnlocksThisSpin(): boolean {
  const mode = process.env.DAT_VAULT_BONUS?.trim();
  if (mode === "always") return true;
  if (mode === "never") return false;
  return randomInt(VAULT_BONUS_EVERY_N) === 0;
}

function vaultCollectedMojos(bonus: StoredVaultBonus): bigint {
  return BigInt(bonus.betMojos) * BigInt(vaultCollectedMultiplier(bonus.cards, bonus.revealed));
}

function vaultBonusView(bonus: StoredVaultBonus) {
  const bet = BigInt(bonus.betMojos);
  const cards = bonus.cards.map((card, index) => {
    if (!bonus.revealed.includes(index)) return { index, revealed: false as const };
    if (card.kind === "rake") return { index, revealed: true as const, kind: "rake" as const };
    const payoutMojos = (bet * BigInt(card.multiplier)).toString();
    return {
      index,
      revealed: true as const,
      kind: "prize" as const,
      multiplier: card.multiplier,
      payoutMojos,
    };
  });
  return {
    bonusId: bonus.bonusId,
    gameId: bonus.gameId,
    gameTitle: SLOT_GAMES[bonus.gameId].title,
    betMojos: bonus.betMojos,
    cards,
    collectedMojos: vaultCollectedMojos(bonus).toString(),
    open: true as const,
  };
}

function payVaultBonus(playerId: string, bonus: StoredVaultBonus): bigint {
  const payout = vaultCollectedMojos(bonus);
  if (payout > 0n) {
    creditAccount(playerId, payout, { type: "credit", ref: `slots-vault-${bonus.bonusId}` });
  }
  clearVaultBonus(playerId);
  return payout;
}

function spinPayoutMojos(result: SlotSpinCore, lineBetMojos: bigint): bigint {
  return payoutUnitsToMojos(result.totalPayout, lineBetMojos, payoutDenominatorOf(result.meta));
}

function spinResultToClient(result: SlotSpinCore, lineBetMojos: bigint) {
  return {
    grid: result.grid,
    lineWins: result.lineWins.map((w) => ({
      ...w,
      payout: payoutUnitsToMojos(w.payout, lineBetMojos).toString(),
    })),
    waysWins: result.waysWins.map((w) => ({
      ...w,
      payout: payoutUnitsToMojos(w.payout, lineBetMojos, w.payoutDenominator).toString(),
    })),
    scatterCount: result.scatterCount,
    scatterMultiplier: result.scatterMultiplier,
    totalMultiplier: result.totalMultiplier,
    totalPayoutMojos: spinPayoutMojos(result, lineBetMojos).toString(),
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

  const lineWinMojos = spinPayoutMojos(result, lineBetMojos);
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

  let vaultBonus: ReturnType<typeof vaultBonusView> | undefined;
  if (!isFreeBossSpin && !holdDrawOffer && !getVaultBonus(playerId) && vaultUnlocksThisSpin()) {
    const opened: StoredVaultBonus = {
      bonusId: randomUUID(),
      gameId,
      betMojos: betMojos.toString(),
      cards: buildVaultCards((max) => randomInt(max)),
      revealed: [],
    };
    setVaultBonus(playerId, opened);
    vaultBonus = vaultBonusView(opened);
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
    vaultBonus,
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

    if (getVaultBonus(playerId)) {
      return reply.status(409).send({ error: VAULT_OPEN_ERROR });
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

  app.get("/v1/slots/bonus", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const bonus = getVaultBonus(session.playerId);
    return { bonus: bonus ? vaultBonusView(bonus) : null };
  });

  app.post<{ Body: { index?: number } }>("/v1/slots/bonus/flip", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const bonus = getVaultBonus(session.playerId);
    if (!bonus) {
      return reply.status(400).send({ error: "No vault bonus is open" });
    }
    let flip: ReturnType<typeof flipVaultCard>;
    try {
      flip = flipVaultCard(bonus.cards, bonus.revealed, req.body?.index ?? -1);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
    bonus.revealed = flip.revealed;
    const reveal =
      flip.card.kind === "rake"
        ? { index: req.body?.index, kind: "rake" as const }
        : {
            index: req.body?.index,
            kind: "prize" as const,
            multiplier: flip.card.multiplier,
            payoutMojos: (BigInt(bonus.betMojos) * BigInt(flip.card.multiplier)).toString(),
          };
    if (!flip.finished) {
      setVaultBonus(session.playerId, bonus);
      return {
        ok: true,
        finished: false,
        hitRake: false,
        reveal,
        bonus: vaultBonusView(bonus),
        collectedMojos: vaultCollectedMojos(bonus).toString(),
        accountBalanceMojos: getAccountBalance(session.playerId).toString(),
      };
    }
    const collected = payVaultBonus(session.playerId, bonus);
    return {
      ok: true,
      finished: true,
      hitRake: flip.card.kind === "rake",
      reveal,
      bonus: null,
      collectedMojos: collected.toString(),
      accountBalanceMojos: getAccountBalance(session.playerId).toString(),
    };
  });

  app.post("/v1/slots/bonus/cash-out", async (req, reply) => {
    const session = requirePlayer(req, reply);
    if (!session) return;
    const bonus = getVaultBonus(session.playerId);
    if (!bonus) {
      return reply.status(400).send({ error: "No vault bonus is open" });
    }
    if (bonus.revealed.length === 0) {
      return reply.status(400).send({ error: "Flip a chip before cashing out" });
    }
    const collected = payVaultBonus(session.playerId, bonus);
    return {
      ok: true,
      finished: true,
      hitRake: false,
      collectedMojos: collected.toString(),
      accountBalanceMojos: getAccountBalance(session.playerId).toString(),
    };
  });

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
    const lineWinMojos = spinPayoutMojos(result, lineBetMojos);

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
