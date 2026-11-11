import {
  chooseHouseAction,
  HOUSE_PLAYER_ID,
  type HouseDecision,
  type NlheTableEngine,
} from "@dat-poker/game-engine";

/** Apply the house policy until the seat belongs to someone else or the hand ends. */
export function runHouseTurn(table: NlheTableEngine): HouseDecision[] {
  const taken: HouseDecision[] = [];
  for (let i = 0; i < 8; i++) {
    const hand = table.getHandState();
    if (!hand || hand.actionSeat == null) break;
    const actor = hand.players.find(
      (p) => p.seatIndex === hand.actionSeat && !p.folded && !p.allIn,
    );
    if (!actor || actor.playerId !== HOUSE_PLAYER_ID) break;
    const decision = chooseHouseAction({
      street: hand.street,
      board: hand.board,
      holeCards: actor.holeCards,
      potMojos: hand.potMojos,
      currentBetMojos: hand.currentBetMojos,
      betThisStreetMojos: actor.betThisStreetMojos,
      stackMojos: actor.stackMojos,
      bigBlindMojos: table.getBigBlindMojos(),
    });
    try {
      table.applyAction(HOUSE_PLAYER_ID, decision.action, decision.amountMojos);
      taken.push(decision);
    } catch {
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      const fallback = toCall <= 0n ? "check" : "call";
      try {
        table.applyAction(HOUSE_PLAYER_ID, fallback, 0n);
        taken.push({ action: fallback, amountMojos: 0n });
      } catch {
        table.applyAction(HOUSE_PLAYER_ID, "fold", 0n);
        taken.push({ action: "fold", amountMojos: 0n });
      }
    }
  }
  return taken;
}
