import {
  SNG_ENTRY_MOJOS,
  SNG_HANDS_PER_LEVEL,
  SNG_STARTING_STACK_MOJOS,
  sngBlinds,
  sngLevelIndex,
  type NlheTableEngine,
} from "@dat-poker/game-engine";

export interface SitAndGoState {
  entryMojos: bigint;
  startingStackMojos: bigint;
  handsPerLevel: number;
  handsPlayed: number;
  levelIndex: number;
  status: "registering" | "running" | "complete";
  entrants: number;
  prizeMojos: bigint;
  winnerId: string | null;
  lastAccountedHandId: string | null;
}

export interface SitAndGoTable {
  engine: NlheTableEngine;
  sng?: SitAndGoState;
}

export function freshSitAndGo(): SitAndGoState {
  return {
    entryMojos: SNG_ENTRY_MOJOS,
    startingStackMojos: SNG_STARTING_STACK_MOJOS,
    handsPerLevel: SNG_HANDS_PER_LEVEL,
    handsPlayed: 0,
    levelIndex: 0,
    status: "registering",
    entrants: 0,
    prizeMojos: 0n,
    winnerId: null,
    lastAccountedHandId: null,
  };
}

export function playersRemaining(engine: NlheTableEngine): number {
  const hand = engine.getHandState();
  if (hand) return hand.players.filter((player) => !player.folded).length;
  return engine.getSeatedPlayers().filter((player) => player.stackMojos > 0n).length;
}

/** Freeze the field and post the level that the next hand should use. */
export function prepareSitAndGoHand(table: SitAndGoTable): void {
  const sng = table.sng;
  if (!sng) return;
  if (sng.status === "complete") throw new Error("Sit-and-go is over");
  const live = table.engine.getSeatedPlayers().filter((player) => player.stackMojos > 0n);
  if (live.length < 2) throw new Error("Need at least 2 players with chips");
  if (sng.status === "registering") {
    sng.status = "running";
    sng.entrants = table.engine.getActivePlayerCount();
    sng.prizeMojos = sng.entryMojos * BigInt(sng.entrants);
  }
  sng.levelIndex = sngLevelIndex(sng.handsPlayed, sng.handsPerLevel);
  const blinds = sngBlinds(sng.levelIndex);
  table.engine.setLimits(blinds.smallBlindMojos, blinds.bigBlindMojos);
}

/** Count a finished hand once, and close the tournament when one player has chips. */
export function accountSitAndGoHand(table: SitAndGoTable): void {
  const sng = table.sng;
  if (!sng || sng.status !== "running") return;
  if (table.engine.isHandInProgress()) return;
  const result = table.engine.getLastHandResult();
  if (!result || result.handId === sng.lastAccountedHandId) return;
  sng.lastAccountedHandId = result.handId;
  sng.handsPlayed += 1;
  const live = table.engine.getSeatedPlayers().filter((player) => player.stackMojos > 0n);
  if (live.length <= 1) {
    sng.status = "complete";
    sng.winnerId = live[0]?.playerId ?? null;
  }
}

/** Cash tables pay the chip stack. A finished sit-and-go pays the prize to the winner. */
export function collectableMojos(table: SitAndGoTable, playerId: string): bigint | null {
  const stack = table.engine.getPlayerStack(playerId);
  if (stack === null) return null;
  if (!table.sng) return stack;
  if (table.sng.status !== "complete" || table.sng.winnerId !== playerId) return null;
  return table.sng.prizeMojos;
}
