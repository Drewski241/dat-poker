import { describe, expect, it } from "vitest";
import { generateServerSeed, NlheTableEngine } from "@dat-poker/game-engine";
import { DAT_TABLE_DEFAULTS } from "@dat-poker/shared";
import { HOUSE_PLAYER_ID } from "./house-id.js";
import { playHouseIfDue } from "./house-play.js";

describe("playHouseIfDue", () => {
  it("takes a legal action when the house is first to act", () => {
    const table = new NlheTableEngine({
      id: "house-bot",
      variant: "nlhe",
      format: "cash",
      maxSeats: 6,
      smallBlindMojos: DAT_TABLE_DEFAULTS.smallBlindMojos,
      bigBlindMojos: DAT_TABLE_DEFAULTS.bigBlindMojos,
      minBuyInMojos: DAT_TABLE_DEFAULTS.minBuyInMojos,
      maxBuyInMojos: DAT_TABLE_DEFAULTS.maxBuyInMojos,
      rakeBps: 0,
    });
    table.seatPlayer(HOUSE_PLAYER_ID, 0, DAT_TABLE_DEFAULTS.minBuyInMojos);
    table.seatPlayer("alice", 1, DAT_TABLE_DEFAULTS.minBuyInMojos);
    table.startHand("hand-bot");
    table.submitPlayerSeed(HOUSE_PLAYER_ID, generateServerSeed());
    table.submitPlayerSeed("alice", generateServerSeed());
    table.revealAndDeal();

    expect(() => playHouseIfDue(table, () => 0.5)).not.toThrow();

    const hand = table.getHandState();
    if (hand && hand.actionSeat != null) {
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat);
      expect(actor?.playerId).not.toBe(HOUSE_PLAYER_ID);
    }
  });
});
