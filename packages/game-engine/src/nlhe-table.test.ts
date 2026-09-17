import { describe, expect, it } from "vitest";
import type { TableConfig } from "@dat-poker/shared";
import { NlheTableEngine } from "./nlhe-table.js";
import { generateServerSeed } from "./shuffle.js";

const config: TableConfig = {
  id: "table-1",
  variant: "nlhe",
  format: "cash",
  maxSeats: 6,
  smallBlindMojos: 50_000_000_000n,
  bigBlindMojos: 100_000_000_000n,
  minBuyInMojos: 2_000_000_000_000n,
  maxBuyInMojos: 20_000_000_000_000n,
  rakeBps: 500,
};

describe("NlheTableEngine", () => {
  it("runs commit-reveal deal and heads-up fold", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    const { commitHash } = table.startHand("hand-1");
    expect(commitHash).toHaveLength(64);

    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState();
    expect(state?.players.every((p) => p.holeCards.length === 2)).toBe(true);

    table.applyAction("alice", "fold");
    expect(table.getHandState()).toBeNull();
    expect(table.getLastHandResult()?.winnerId).toBe("bob");
    expect(table.getLastHandResult()?.reason).toBe("fold");
    expect(table.getLastHandResult()?.shown).toEqual([]);
    expect(table.getHandsPlayed("alice")).toBe(1);
    expect(table.getHandsPlayed("bob")).toBe(1);
  });

  it("enforces min raise equal to the last bet increment", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 10_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-min-raise");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const actor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(actor.playerId, "call");
    state = table.getHandState()!;
    const bb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb.playerId, "check");

    state = table.getHandState()!;
    expect(state.street).toBe("flop");
    const flopActor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    const betTo = 300_000n;
    table.applyAction(flopActor.playerId, "bet", betTo);

    state = table.getHandState()!;
    expect(state.currentBetMojos).toBe(betTo);
    expect(state.lastRaiseIncrementMojos).toBe(betTo);

    const raiser = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    expect(() => table.applyAction(raiser.playerId, "raise", 500_000n)).toThrow(/last bet or raise/i);
    table.applyAction(raiser.playerId, "raise", 600_000n);
    expect(table.getHandState()?.currentBetMojos).toBe(600_000n);
  });

  it("runs out board to showdown when both players are all-in preflop", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 10_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-ai-runout");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const sb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(sb.playerId, "raise", 500_000n);
    state = table.getHandState()!;
    const bb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb.playerId, "raise", 1_500_000n);
    state = table.getHandState()!;
    const sb2 = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(sb2.playerId, "all-in");
    state = table.getHandState()!;
    const bb2 = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    table.applyAction(bb2.playerId, "call");

    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
  });

  it("marks a player all-in when a raise consumes their entire stack", () => {
    const small: TableConfig = {
      ...config,
      smallBlindMojos: 50_000n,
      bigBlindMojos: 100_000n,
      minBuyInMojos: 5_000_000n,
      maxBuyInMojos: 50_000_000n,
    };
    const table = new NlheTableEngine(small);
    table.seatPlayer("alice", 0, 5_000_000n);
    table.seatPlayer("bob", 1, 10_000_000n);
    table.startHand("hand-shove");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    let state = table.getHandState()!;
    const sb = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    const shoveTo = sb.betThisStreetMojos + sb.stackMojos;
    table.applyAction(sb.playerId, "raise", shoveTo);
    state = table.getHandState()!;
    expect(state.actionSeat).not.toBe(sb.seatIndex);
    const alice = table.getHandState()!.players.find((p) => p.playerId === "alice")!;
    expect(alice.stackMojos).toBe(0n);
    expect(alice.allIn).toBe(true);
  });

  it("heads-up: after a raise the other player must act before the street advances", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-bet-response");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    expect(pre.actionSeat).toBe(0);
    const raiseTo = pre.currentBetMojos + config.bigBlindMojos;
    table.applyAction("alice", "raise", raiseTo);

    const afterRaise = table.getHandState()!;
    expect(afterRaise.street).toBe("preflop");
    expect(afterRaise.actionSeat).toBe(1);
    expect(afterRaise.players.find((p) => p.playerId === "bob")!.betThisStreetMojos).toBeLessThan(
      afterRaise.currentBetMojos,
    );
  });

  it("three-way: limps to the big blind leave the BB an option to act", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("carol", 5, 5_000_000_000_000n);

    table.startHand("hand-bb-option");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    expect(pre.actionSeat).toBe(0);
    table.applyAction("alice", "call");
    table.applyAction("bob", "call");

    const afterLimp = table.getHandState()!;
    expect(afterLimp.street).toBe("preflop");
    expect(afterLimp.actionSeat).toBe(5);
    expect(afterLimp.players.find((p) => p.seatIndex === 5)!.actedThisStreet).toBe(false);

    table.applyAction("carol", "check");
    expect(table.getHandState()?.street).toBe("flop");
  });

  it("advances to flop after raise and call", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-2");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    const actor = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    const other = pre.players.find((p) => p.playerId !== actor.playerId)!;
    const raiseTo = pre.currentBetMojos + config.bigBlindMojos;

    table.applyAction(actor.playerId, "raise", raiseTo);
    expect(table.getHandState()?.street).toBe("preflop");

    table.applyAction(other.playerId, "call");
    const flop = table.getHandState();
    expect(flop?.street).toBe("flop");
    expect(flop?.board).toHaveLength(3);
  });

  it("cashes out player stack when no hand is active", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-3");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.applyAction("alice", "fold");

    expect(table.isHandInProgress()).toBe(false);
    expect(table.getPlayerStack("bob")).toBeGreaterThan(5_000_000_000_000n);

    const cashOut = table.cashOutPlayer("bob");
    expect(cashOut.seatIndex).toBe(1);
    expect(cashOut.stackMojos).toBeGreaterThan(5_000_000_000_000n);
    expect(table.getPlayerStack("bob")).toBeNull();
    expect(table.getActivePlayerCount()).toBe(1);
  });

  it("restores hands played and debits a partial stack", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.setHandsPlayed("alice", 50);
    expect(table.getHandsPlayed("alice")).toBe(50);
    const debit = table.debitStack("alice", 50_000_000_000n);
    expect(debit.remaining).toBe(4_950_000_000_000n);
    expect(table.getPlayerStack("alice")).toBe(4_950_000_000_000n);
    expect(table.getHandsPlayed("alice")).toBe(50);
  });

  it("rejects cash out during active hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-4");
    expect(() => table.cashOutPlayer("alice")).toThrow(/active hand/i);
  });

  it("runs out when both players are all-in from the blinds", () => {
    const short = {
      ...config,
      minBuyInMojos: 1000n,
      smallBlindMojos: 5000n,
      bigBlindMojos: 10_000n,
    };
    const table = new NlheTableEngine(short);
    table.seatPlayer("alice", 0, 1000n);
    table.seatPlayer("dat-poker:house", 1, 1000n);
    table.startHand("hand-short");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();
    expect(table.getHandState()).toBeNull();
    expect(table.getLastHandResult()?.reason).toBe("showdown");
  });

  it("excludes sitting-out players from the next hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.setSittingOut("bob", true);
    expect(() => table.startHand("hand-sit")).toThrow(/2 active players/i);

    table.seatPlayer("dat-poker:house", 2, 5_000_000_000_000n);
    table.startHand("hand-sit-house");
    expect(table.getHandState()?.players.map((p) => p.playerId).sort()).toEqual([
      "alice",
      "dat-poker:house",
    ]);
  });

  it("seats six-max with three players and awards a fold", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("dat-poker:house", 5, 5_000_000_000_000n);
    expect(table.getMaxSeats()).toBe(6);
    expect(table.emptySeatIndex()).toBe(1);

    table.startHand("hand-5");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();

    expect(table.getHandState()?.players).toHaveLength(3);
    const first = table.getHandState()!;
    const actorId = first.players.find((p) => p.seatIndex === first.actionSeat)!.playerId;
    table.applyAction(actorId, "fold");
    expect(table.getHandState()?.players.filter((p) => !p.folded).length).toBe(2);
  });

  it("reveals remaining hole cards after a showdown", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("dat-poker:house", 1, 5_000_000_000_000n);

    table.startHand("hand-6");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("dat-poker:house", generateServerSeed());
    table.revealAndDeal();

    for (let i = 0; i < 40; i++) {
      const hand = table.getHandState();
      if (!hand || hand.actionSeat == null) break;
      const actor = hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded);
      if (!actor) break;
      const toCall = hand.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    }

    expect(table.getHandState()).toBeNull();
    const result = table.getLastHandResult();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
    expect(result?.shown).toHaveLength(2);
    expect(result?.shown.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(result?.shown.some((p) => p.playerId === "dat-poker:house")).toBe(true);
    expect(result?.shown.map((p) => p.playerId).sort()).toEqual(["alice", "dat-poker:house"]);
    expect(result?.shown.find((p) => p.playerId === result.winnerId)?.category).toBeTruthy();
  });

  it("posts small and big blind relative to the dealer button", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 2, 5_000_000_000_000n);
    table.seatPlayer("carol", 5, 5_000_000_000_000n);

    table.startHand("hand-blinds");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState()!;
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(2);
    expect(state.bigBlindSeat).toBe(5);
    expect(state.actionSeat).toBe(0);
    const sb = state.players.find((p) => p.seatIndex === 2)!;
    const bb = state.players.find((p) => p.seatIndex === 5)!;
    expect(sb.betThisStreetMojos).toBe(config.smallBlindMojos);
    expect(bb.betThisStreetMojos).toBe(config.bigBlindMojos);
    expect(state.currentBetMojos).toBe(config.bigBlindMojos);
  });

  it("rotates the dealer button clockwise after each completed hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.seatPlayer("carol", 2, 5_000_000_000_000n);

    table.startHand("hand-d1");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();
    expect(table.getHandState()?.dealerSeat).toBe(0);

    const firstActor = table.getHandState()!.players.find(
      (p) => p.seatIndex === table.getHandState()!.actionSeat,
    )!.playerId;
    table.applyAction(firstActor, "fold");
    const secondActor = table.getHandState()!.players.find(
      (p) => p.seatIndex === table.getHandState()!.actionSeat,
    )!.playerId;
    table.applyAction(secondActor, "fold");
    expect(table.getHandState()).toBeNull();

    table.startHand("hand-d2");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("carol", generateServerSeed());
    table.revealAndDeal();
    expect(table.getHandState()?.dealerSeat).toBe(1);
  });

  it("heads-up: dealer posts small blind and acts first preflop", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);

    table.startHand("hand-hu");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const state = table.getHandState()!;
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(0);
    expect(state.bigBlindSeat).toBe(1);
    expect(state.actionSeat).toBe(0);
    expect(state.players.find((p) => p.seatIndex === 0)!.betThisStreetMojos).toBe(
      config.smallBlindMojos,
    );
    expect(state.players.find((p) => p.seatIndex === 1)!.betThisStreetMojos).toBe(
      config.bigBlindMojos,
    );
  });

  it("refunds this-hand bets when a hand is aborted for restart", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-abort");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    table.abortHandRefundBets();
    expect(table.isHandInProgress()).toBe(false);
    expect(table.getPlayerStack("alice")).toBe(5_000_000_000_000n);
    expect(table.getPlayerStack("bob")).toBe(5_000_000_000_000n);
  });
});
