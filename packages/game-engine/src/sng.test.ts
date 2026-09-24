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

  it("lets a human take over a house seat and keep that stack", () => {
    const sng = SngTournament.create("sng-claim");
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start();
    sng.engine.setPlayerStack(houseSeatPlayerId(3), 750_000n);

    const claimed = sng.claimHouseSeat("bob", 3);
    expect(claimed.replacedPlayerId).toBe(houseSeatPlayerId(3));
    expect(claimed.stackMojos).toBe(750_000n);
    expect(sng.engine.getPlayerStack("bob")).toBe(750_000n);
    expect(sng.engine.getPlayerStack(houseSeatPlayerId(3))).toBeNull();
    expect(sng.humanCount()).toBe(2);
    expect(sng.snapshot().houseSeatsAvailable).toBe(7);

    expect(() => sng.claimHouseSeat("alice")).toThrow(/already seated/i);
    sng.engine.startHand("claim-block");
    expect(() => sng.claimHouseSeat("carol")).toThrow(/current hand/i);
  });

  it("ends the tournament when the last human busts and clears house seats", () => {
    const sng = SngTournament.create("sng-last-human", { maxSeats: 3, fillHouse: true, minHumansToStart: 1 });
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start();
    sng.engine.setPlayerStack("alice", 0n);
    sng.afterHand();

    const snap = sng.snapshot();
    expect(snap.status).toBe("finished");
    expect(snap.humanCount).toBe(0);
    expect(sng.engine.getActivePlayerCount()).toBe(0);
    expect(sng.engine.houseSeats()).toHaveLength(0);
    expect(snap.placements.find((p) => p.playerId === "alice")?.place).toBe(3);
  });

  it("raises blinds on the clock between hands and waits if a hand is live", () => {
    const sng = SngTournament.create("sng-clock", {
      maxSeats: 2,
      fillHouse: true,
      minHumansToStart: 1,
      levelDurationMs: 60_000,
      handsPerLevel: 99,
    });
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start(1_000);

    expect(sng.snapshot(1_000).levelIndex).toBe(0);
    expect(sng.snapshot(1_000).smallBlindMojos).toBe(10_000n);
    expect(sng.snapshot(1_000).nextLevelAtMs).toBe(61_000);
    expect(sng.engine.getSmallBlindMojos()).toBe(10_000n);

    sng.syncBlindClock(61_000);
    expect(sng.snapshot(61_000).levelIndex).toBe(1);
    expect(sng.engine.getSmallBlindMojos()).toBe(15_000n);
    expect(sng.engine.getBigBlindMojos()).toBe(30_000n);
    expect(sng.snapshot(61_000).nextSmallBlindMojos).toBe(25_000n);

    sng.onHandStarted(70_000);
    sng.engine.startHand("clock-hand");
    for (const seat of sng.engine.getSeatedPlayers()) {
      sng.engine.submitPlayerSeed(seat.playerId, generateServerSeed());
    }
    sng.engine.revealAndDeal();
    const mid = sng.syncBlindClock(130_000);
    expect(mid.levelIndex).toBe(1);
    expect(mid.blindsUpNextHand).toBe(true);
    expect(sng.engine.getSmallBlindMojos()).toBe(15_000n);

    while (sng.engine.isHandInProgress()) {
      const actor = sng.engine.actorPlayerId();
      if (!actor) break;
      sng.engine.applyAction(actor, "fold");
    }
    expect(sng.engine.isHandInProgress()).toBe(false);
    const after = sng.syncBlindClock(130_000);
    expect(after.levelIndex).toBe(2);
    expect(after.blindsUpNextHand).toBe(false);
    expect(sng.engine.getSmallBlindMojos()).toBe(25_000n);
    expect(sng.engine.getBigBlindMojos()).toBe(50_000n);

    const stale = sng.syncBlindClock(1_000);
    expect(stale.levelIndex).toBe(2);
    expect(sng.engine.getSmallBlindMojos()).toBe(25_000n);
  });

  it("still raises blinds after enough hands when the clock has not elapsed", () => {
    const sng = SngTournament.create("sng-hands", {
      maxSeats: 2,
      fillHouse: true,
      minHumansToStart: 1,
      levelDurationMs: 3_600_000,
      handsPerLevel: 2,
    });
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.start(0);
    sng.onHandStarted(1_000);
    expect(sng.snapshot(1_000).levelIndex).toBe(0);
    sng.onHandStarted(2_000);
    expect(sng.snapshot(2_000).levelIndex).toBe(0);
    sng.onHandStarted(3_000);
    expect(sng.snapshot(3_000).levelIndex).toBe(1);
    expect(sng.engine.getSmallBlindMojos()).toBe(15_000n);
  });

  it("names house seats per index", () => {
    expect(houseSeatPlayerId(4)).toBe("dat-poker:house:4");
  });

  it("has no house seats left when humans fill the table", () => {
    const sng = SngTournament.create("sng-full", { maxSeats: 2, fillHouse: true, minHumansToStart: 1 });
    sng.engine.seatPlayer("alice", 0, DAT_SNG_DEFAULTS.startingStackMojos);
    sng.fillHouseSeats();
    sng.claimHouseSeat("bob");
    const snap = sng.snapshot();
    expect(snap.humanCount).toBe(2);
    expect(snap.houseSeatsAvailable).toBe(0);
    expect(sng.engine.getActivePlayerCount()).toBe(2);
  });
});
