import { HOUSE_PLAYER_ID } from "./house-id.js";
import type { NlheTableEngine } from "@dat-poker/game-engine";

export function playHouseIfDue(table: NlheTableEngine): void {
  for (let i = 0; i < 16; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) {
      return;
    }
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
    if (!actor || actor.playerId !== HOUSE_PLAYER_ID) {
      return;
    }
    const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
    try {
      if (toCall > 0n) {
        table.applyAction(HOUSE_PLAYER_ID, "call");
      } else {
        table.applyAction(HOUSE_PLAYER_ID, "check");
      }
    } catch {
      try {
        table.applyAction(HOUSE_PLAYER_ID, "fold");
      } catch {
        return;
      }
    }
  }
}
