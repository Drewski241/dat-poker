import { isHousePlayerId, type TableConfig } from "@dat-poker/shared";
import {
  generateServerSeed,
  playHouseUntilHuman,
  type NlheTableEngine,
  type SngTournament,
} from "@dat-poker/game-engine";

export interface TableSession {
  engine: NlheTableEngine;
  sng: SngTournament | null;
}

export function seedHousePlayers(engine: NlheTableEngine): void {
  const hand = engine.getHandState();
  if (!hand) return;
  for (const player of hand.players) {
    if (isHousePlayerId(player.playerId) && !hand.playerSeeds[player.playerId]) {
      engine.submitPlayerSeed(player.playerId, generateServerSeed());
    }
  }
}

export function playHouseActors(session: TableSession): void {
  const policy = session.sng?.housePolicy ?? "passive";
  playHouseUntilHuman(session.engine, policy);
}

export function finalizeIfHandOver(session: TableSession): void {
  if (session.engine.isHandInProgress() || !session.sng) return;
  if (session.sng.getStatus() !== "running") return;
  session.sng.afterHand();
}

export function tableConfigPayload(config: TableConfig) {
  return {
    id: config.id,
    variant: config.variant,
    format: config.format,
    maxSeats: config.maxSeats,
    minBuyInMojos: config.minBuyInMojos.toString(),
    maxBuyInMojos: config.maxBuyInMojos.toString(),
    smallBlindMojos: config.smallBlindMojos.toString(),
    bigBlindMojos: config.bigBlindMojos.toString(),
  };
}
