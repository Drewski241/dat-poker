import { describe, expect, it } from "vitest";
import { DAT_SNG_DEFAULTS, houseSeatPlayerId, isHousePlayerId, sngPrizes, defaultSngPayouts } from "@dat-poker/shared";
import { playHouseUntilHuman } from "./house-bot.js";
import { SngTournament } from "./sng.js";
import { generateServerSeed } from "./shuffle.js";

describe("SngTournament", () => {
  it("fills empty seats with house bots and starts a 9-max", () => {
    const sng = SngTournament.create("sng-1");
    sng.engine.seatPlayer("human", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    const filled = sng.fillHouseSeats();

    expect(filled).toHaveLength(8);
    expect(sng.engine.getActivePlayerCount()).toBe(9);
    expect(sng.humanCount()).toBe(1);
    expect(sng.canStart()).toBe(true);
    sng.start();
    expect(sng.getStatus()).toBe("running");
    expect(sng.snapshot().prizePoolMojos).toBe(DAT_SNG_DEFAULTS.buyInMojos * 9n);
  });

  it("does not start a human-only SNG until the table is full", () => {
    const sng = SngTournament.create("sng-2", { fillHouse: false, minHumansToStart: 9 });
    sng.engine.seatPlayer("human", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    expect(sng.canStart()).toBe(false);
    expect(sng.engine.emptySeats()).toHaveLength(8);
  });

  it("assigns 50/30/20 when players bust", () => {
    const sng = SngTournament.create("sng-3", { maxSeats: 3, housePolicy: "folding" });
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start();

    const seats = sng.engine.getSeatedPlayers();
    for (const seat of seats.filter((s) => s.playerId !== "alice")) {
      sng.engine.setPlayerStack(seat.playerId, 0n);
    }
    sng.afterHand();

    const snap = sng.snapshot();
    expect(snap.status).toBe("finished");
    expect(snap.placements.find((p) => p.playerId === "alice")?.place).toBe(1);
    expect(sng.prizeFor("alice")).toBe(sngPrizes(sng.prizePoolMojos, defaultSngPayouts(3)).get(1));
    const paid = snap.placements.reduce((sum, row) => sum + row.prizeMojos, 0n);
    expect(paid).toBe(sng.prizePoolMojos);
  });

  it("plays house actors until the human or the hand ends", () => {
    const sng = SngTournament.create("sng-4", { housePolicy: "folding" });
    sng.engine.seatPlayer("human", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start();
    sng.onHandStarted();
    sng.engine.startHand("sng-hand-1");
    for (const seat of sng.engine.getSeatedPlayers()) {
      sng.engine.submitPlayerSeed(seat.playerId, generateServerSeed());
    }
    sng.engine.revealAndDeal();
    playHouseUntilHuman(sng.engine, "folding");

    const hand = sng.engine.getHandState();
    if (hand) {
      expect(sng.engine.actorPlayerId()).toBe("human");
      expect(isHousePlayerId(sng.engine.actorPlayerId() ?? "")).toBe(false);
    } else {
      expect(sng.engine.getLastHandResult()?.winnerId).toBeDefined();
    }
  });

  it("finishes house play after the human folds", () => {
    const sng = SngTournament.create("sng-5", { housePolicy: "mixed" });
    sng.engine.seatPlayer("human", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start();
    sng.onHandStarted();
    sng.engine.startHand("sng-hand-fold");
    for (const seat of sng.engine.getSeatedPlayers()) {
      sng.engine.submitPlayerSeed(seat.playerId, generateServerSeed());
    }
    sng.engine.revealAndDeal();
    playHouseUntilHuman(sng.engine, "mixed");
    if (sng.engine.isHandInProgress()) {
      expect(sng.engine.actorPlayerId()).toBe("human");
      sng.engine.applyAction("human", "fold");
      playHouseUntilHuman(sng.engine, "mixed");
    }
    expect(sng.engine.isHandInProgress()).toBe(false);
    expect(sng.engine.getLastHandResult()?.winnerId).toBeTruthy();
  });

  it("names house seats per index", () => {
    expect(houseSeatPlayerId(4)).toBe("dat-poker:house:4");
  });
});
