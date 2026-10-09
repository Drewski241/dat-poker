import { describe, expect, it, beforeEach } from "vitest";
import { MttEvent } from "@dat-poker/game-engine";
import { maybeDealTournamentHandOnPoll } from "./tournament-poll-deal.js";

describe("maybeDealTournamentHandOnPoll", () => {
  beforeEach(() => {
    /* fresh engines per test */
  });

  it("starts the first hand on a fresh final table when a human is seated", () => {
    const event = MttEvent.create();
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    const bustA = event
      .engineFor(a)!
      .getSeatedPlayers()
      .filter((p) => p.playerId !== "alice")
      .slice(0, 4);
    const bustB = event.engineFor(b)!.getSeatedPlayers().slice(0, 4);
    for (const row of bustA) event.engineFor(a)!.setPlayerStack(row.playerId, 0n);
    for (const row of bustB) event.engineFor(b)!.setPlayerStack(row.playerId, 0n);
    event.afterHand(a);
    event.afterHand(b);
    const finalId = event.consumePendingTables()[0]!.getConfig().id;
    const finalEngine = event.engineFor(finalId)!;
    expect(finalEngine.getLastHandResult()).toBeNull();

    let started = false;
    const dealt = maybeDealTournamentHandOnPoll(finalId, finalEngine, event, undefined, {
      onHandStarted: () => {
        started = true;
        event.onHandStarted(finalId);
      },
      afterDeal: () => {},
    });
    expect(dealt).toBe(true);
    expect(started).toBe(true);
    expect(finalEngine.isHandInProgress()).toBe(true);
    finalEngine.abortHandRefundBets();
  });

  it("does not deal when a hand already completed on this table", () => {
    const event = MttEvent.create();
    const [tableId] = event.tableIds();
    event.seatPlayer(tableId, "alice", 0);
    event.fillHouseSeats();
    event.start();
    const engine = event.engineFor(tableId)!;
    engine.startHand("done-hand");
    for (const seated of engine.getSeatedPlayers()) {
      engine.submitPlayerSeed(seated.playerId, "seed");
    }
    engine.revealAndDeal();
    while (engine.isHandInProgress()) {
      const hand = engine.getHandState()!;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      engine.applyAction(actor.playerId, "fold");
      engine.advanceHandIfIdle();
    }
    expect(engine.getLastHandResult()).not.toBeNull();
    const dealt = maybeDealTournamentHandOnPoll(tableId, engine, event, undefined, {
      onHandStarted: () => {},
      afterDeal: () => {},
    });
    expect(dealt).toBe(false);
  });
});
