import { describe, expect, it, beforeEach } from "vitest";
import { NlheTableEngine, generateServerSeed } from "@dat-poker/game-engine";
import type { TableConfig } from "@dat-poker/shared";
import { PLAYER_ACTION_LIMIT_MS } from "@dat-poker/shared";
import { playHumansIfDue, resetHumanTurnClockForTests } from "./human-play.js";

const config: TableConfig = {
  id: "t1",
  variant: "nlhe",
  format: "cash",
  maxSeats: 6,
  smallBlindMojos: 5_000n,
  bigBlindMojos: 10_000n,
  minBuyInMojos: 1_000_000n,
  maxBuyInMojos: 50_000_000n,
  rakeBps: 500,
};

describe("playHumansIfDue", () => {
  beforeEach(() => {
    resetHumanTurnClockForTests();
  });

  it("auto-folds a human after the action limit and marks them sitting out", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000n);
    table.seatPlayer("bob", 1, 5_000_000n);
    table.startHand("hand-timeout");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const hand = table.getHandState()!;
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat)!;
    expect(actor.playerId).toMatch(/alice|bob/);

    playHumansIfDue("t1", table, 0);
    expect(table.getHandState()?.actionSeat).toBe(hand.actionSeat);

    playHumansIfDue("t1", table, PLAYER_ACTION_LIMIT_MS + 1);
    expect(table.isSittingOut(actor.playerId)).toBe(true);
    const after = table.getHandState();
    if (after?.actionSeat != null) {
      const next = after.players.find((p) => p.seatIndex === after.actionSeat);
      expect(next?.playerId).not.toBe(actor.playerId);
    }
  });

  it("instantly auto-folds a sitting-out human without waiting for the timer", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000n);
    table.seatPlayer("bob", 1, 5_000_000n);
    table.startHand("hand-sitout");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const hand = table.getHandState()!;
    const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat)!;
    table.markTimedOutSittingOut(actor.playerId);
    playHumansIfDue("t1", table, 0);
    const after = table.getHandState();
    if (after?.actionSeat != null) {
      expect(after.players.find((p) => p.seatIndex === after.actionSeat)?.playerId).not.toBe(
        actor.playerId,
      );
    }
  });
});
