import { describe, expect, it } from "vitest";
import { DAT_TABLE_DEFAULTS, type TableConfig } from "@dat-poker/shared";
import { houseSeatPlayerId, isHousePlayerId } from "@dat-poker/shared";
import {
  actorPlayerId,
  chooseHouseAction,
  playHouseUntilHuman,
  submitHouseSeeds,
} from "./house-bot.js";
import { generateServerSeed, NlheTableEngine } from "./index.js";

function cashTable(): NlheTableEngine {
  const config: TableConfig = {
    id: "t1",
    variant: "nlhe",
    format: "cash",
    maxSeats: 6,
    smallBlindMojos: DAT_TABLE_DEFAULTS.smallBlindMojos,
    bigBlindMojos: DAT_TABLE_DEFAULTS.bigBlindMojos,
    minBuyInMojos: DAT_TABLE_DEFAULTS.minBuyInMojos,
    maxBuyInMojos: DAT_TABLE_DEFAULTS.maxBuyInMojos,
    rakeBps: 0,
  };
  return new NlheTableEngine(config);
}

describe("house-bot", () => {
  it("identifies house seat ids", () => {
    expect(isHousePlayerId("dat-poker:house")).toBe(true);
    expect(isHousePlayerId(houseSeatPlayerId(3))).toBe(true);
    expect(isHousePlayerId("alice")).toBe(false);
  });

  it("plays house until a human must act", () => {
    const engine = cashTable();
    const human = "human-1";
    const house = houseSeatPlayerId(1);
    engine.seatPlayer(human, 0, DAT_TABLE_DEFAULTS.minBuyInMojos);
    engine.seatPlayer(house, 1, DAT_TABLE_DEFAULTS.minBuyInMojos);

    const { commitHash } = engine.startHand("h1");
    expect(commitHash).toBeTruthy();
    engine.submitPlayerSeed(human, generateServerSeed());
    submitHouseSeeds(engine, generateServerSeed);
    engine.revealAndDeal();

    playHouseUntilHuman(engine, "passive");
    const actor = actorPlayerId(engine);
    if (engine.isHandInProgress()) {
      expect(actor === null || actor === human || isHousePlayerId(actor)).toBe(true);
      // With passive house, if action remains it should be the human
      if (actor) expect(isHousePlayerId(actor)).toBe(false);
    }
  });

  it("chooses fold or check under folding policy", () => {
    const hand = {
      handId: "h",
      tableId: "t",
      street: "preflop" as const,
      board: [],
      potMojos: 100n,
      currentBetMojos: 50n,
      dealerSeat: 0,
      actionSeat: 1,
      players: [
        {
          playerId: houseSeatPlayerId(1),
          seatIndex: 1,
          holeCards: [],
          stackMojos: 1000n,
          betThisStreetMojos: 0n,
          totalBetHandMojos: 0n,
          folded: false,
          allIn: false,
        },
      ],
      commitHash: "x",
      serverSeed: null,
      playerSeeds: {},
      deck: [],
      deckIndex: 0,
      seq: 1,
    };
    const decision = chooseHouseAction(hand, houseSeatPlayerId(1), "folding", 50n);
    expect(decision.action).toBe("fold");
  });
});
