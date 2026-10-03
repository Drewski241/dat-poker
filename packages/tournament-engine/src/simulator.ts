import { randomUUID } from "node:crypto";
import { generateServerSeed } from "@dat-poker/game-engine";
import { TournamentEngine, type CreateTournamentInput } from "./tournament.js";

export type BotStyle = "passive" | "loose" | "random";

export interface SimulateTournamentOptions {
  players: number;
  style?: BotStyle;
  /** Max completed hands across all tables before abort (safety). */
  maxHands?: number;
  /** Max outer scheduler loops (guards against stuck-hand busy loops). */
  maxLoops?: number;
  seed?: number;
  create?: Omit<CreateTournamentInput, "name"> & { name?: string };
  onProgress?: (info: {
    hands: number;
    active: number;
    tables: number;
    status: string;
  }) => void;
}

export interface SimulateTournamentResult {
  tournamentId: string;
  winnerId: string | null;
  handsPlayed: number;
  prizePoolMojos: bigint;
  paidPlaces: number;
  payouts: Array<{ playerId: string; finishPosition: number; prizeMojos: bigint }>;
  status: string;
  elapsedMs: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Drive a full MTT/SNG with bot players — no human beta testers required.
 * Bots use the real NLHE engine (commit-reveal + actions).
 */
export async function simulateTournament(
  options: SimulateTournamentOptions,
): Promise<SimulateTournamentResult> {
  const t0 = Date.now();
  const rand = mulberry32(options.seed ?? 1);
  const style = options.style ?? "random";
  const maxHands = options.maxHands ?? options.players * 200;
  const maxLoops = options.maxLoops ?? maxHands * 4;

  const tournament = new TournamentEngine({
    name: options.create?.name ?? `Sim ${options.players}-max`,
    format: options.create?.format ?? (options.players <= 8 ? "sng" : "mtt"),
    maxSeats: options.create?.maxSeats ?? 8,
    maxEntries: options.create?.maxEntries ?? options.players,
    minEntries: options.create?.minEntries ?? Math.min(2, options.players),
    buyInMojos: options.create?.buyInMojos ?? 10_000n,
    startingStackMojos: options.create?.startingStackMojos ?? 1_500_000n,
    feeBps: options.create?.feeBps ?? 500,
    lateRegThroughLevel: options.create?.lateRegThroughLevel ?? -1,
    reentryAllowed: options.create?.reentryAllowed ?? false,
    maxReentries: options.create?.maxReentries ?? 0,
    blindLevels: options.create?.blindLevels,
    id: options.create?.id,
  });

  const ids = Array.from({ length: options.players }, (_, i) => `bot-${i}`);
  tournament.registerPlayers(ids);
  tournament.start();

  let handsPlayed = 0;
  let levelHands = 0;
  let loops = 0;

  while (
    tournament.getStatus() !== "completed" &&
    tournament.getActiveCount() > 1 &&
    handsPlayed < maxHands &&
    loops++ < maxLoops
  ) {
    const tableIds = tournament.listOpenTableIds();
    if (tableIds.length === 0) break;

    let playedThisWave = 0;
    for (const tableId of tableIds) {
      if (!tournament.canDealNextHand(tableId)) continue;
      const engine = tournament.getTableEngine(tableId);
      if (!engine || engine.getActivePlayerCount() < 2) continue;

      if (engine.isHandInProgress()) {
        engine.forceCompleteHand();
      }

      const before = engine.isHandInProgress();
      playBotHand(engine, style, rand);
      if (engine.isHandInProgress()) {
        engine.forceCompleteHand();
      }
      if (!before && !engine.isHandInProgress()) {
        handsPlayed += 1;
        levelHands += 1;
        playedThisWave += 1;
      }

      tournament.reportHandComplete(tableId);
      tournament.syncEliminationsFromStacks();
      if (tournament.getStatus() === "completed") break;
    }

    if (playedThisWave === 0) {
      // Nothing could deal — advance blinds / force progress
      tournament.advanceBlindLevel();
      for (const tableId of tableIds) {
        const engine = tournament.getTableEngine(tableId);
        if (engine?.isHandInProgress()) engine.forceCompleteHand();
      }
      tournament.syncEliminationsFromStacks();
    }

    if (levelHands >= Math.max(4, tableIds.length)) {
      tournament.advanceBlindLevel();
      levelHands = 0;
    }

    tournament.finalizeIfSingleWinner();

    options.onProgress?.({
      hands: handsPlayed,
      active: tournament.getActiveCount(),
      tables: tournament.listOpenTableIds().length,
      status: tournament.getStatus(),
    });
  }

  while (tournament.isLateRegOpen()) {
    tournament.advanceBlindLevel();
  }
  tournament.finalizeIfSingleWinner();

  // Last-resort chip attrition if hands couldn't bust the field
  let safety = 0;
  while (
    tournament.getStatus() !== "completed" &&
    tournament.getActiveCount() > 1 &&
    safety++ < options.players * 2
  ) {
    const snap = tournament.getSnapshot({ detail: true });
    const active = (snap.players ?? [])
      .filter((p) => p.status === "active")
      .sort((a, b) => Number(a.stackMojos - b.stackMojos));
    const victim = active[0];
    if (!victim) break;
    tournament.eliminatePlayer(victim.playerId);
  }
  tournament.finalizeIfSingleWinner();

  const snap = tournament.getSnapshot({ detail: true });
  const payouts = (snap.players ?? [])
    .filter((p) => p.finishPosition !== null && p.prizeMojos > 0n)
    .map((p) => ({
      playerId: p.playerId,
      finishPosition: p.finishPosition!,
      prizeMojos: p.prizeMojos,
    }))
    .sort((a, b) => a.finishPosition - b.finishPosition);

  return {
    tournamentId: tournament.getId(),
    winnerId: snap.winnerId,
    handsPlayed,
    prizePoolMojos: tournament.getPrizePoolMojos(),
    paidPlaces: snap.paidPlaces,
    payouts,
    status: tournament.getStatus(),
    elapsedMs: Date.now() - t0,
  };
}

function playBotHand(
  engine: NonNullable<ReturnType<TournamentEngine["getTableEngine"]>>,
  style: BotStyle,
  rand: () => number,
): void {
  const handId = randomUUID();
  try {
    engine.startHand(handId);
  } catch {
    return;
  }

  const state0 = engine.getHandState();
  if (!state0) return;
  for (const p of state0.players) {
    engine.submitPlayerSeed(p.playerId, generateServerSeed());
  }
  try {
    engine.revealAndDeal();
  } catch {
    engine.forceCompleteHand();
    return;
  }

  let guard = 0;
  while (engine.isHandInProgress() && guard++ < 200) {
    const hand = engine.getHandState();
    if (!hand || hand.actionSeat === null) break;
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat);
    if (!actor || actor.folded || actor.allIn) break;

    const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
    const roll = rand();

    try {
      if (toCall > 0n) {
        if (style === "passive" && roll < 0.3) {
          engine.applyAction(actor.playerId, "fold");
        } else if (actor.stackMojos <= toCall || roll < 0.75) {
          engine.applyAction(
            actor.playerId,
            toCall >= actor.stackMojos ? "all-in" : "call",
          );
        } else if (roll < 0.9) {
          engine.applyAction(actor.playerId, "fold");
        } else {
          engine.applyAction(actor.playerId, "all-in");
        }
      } else if (roll < 0.2) {
        engine.applyAction(actor.playerId, "all-in");
      } else {
        engine.applyAction(actor.playerId, "check");
      }
    } catch {
      try {
        engine.applyAction(actor.playerId, toCall > 0n ? "fold" : "check");
      } catch {
        break;
      }
    }
  }

  if (engine.isHandInProgress()) {
    engine.forceCompleteHand();
  }
}
