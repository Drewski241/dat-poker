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
    expect(table.getLastHandResult()?.handLabel).toBeNull();
    expect(table.getLastHandResult()?.shownHands).toEqual([]);
  });

  it("hides the deck, the server seed, and the opponent's hole cards", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-public");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const view = table.getPublicHandState("alice");
    expect(view?.commitHash).toHaveLength(64);
    expect(view?.players.find((p) => p.playerId === "alice")?.holeCards).toHaveLength(2);
    expect(view?.players.find((p) => p.playerId === "bob")?.holeCards).toEqual([]);
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("serverSeed");
    expect(Object.keys(view ?? {})).not.toContain("playerSeeds");
  });

  it("names the winning hand and shows both hands at showdown", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-showdown");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const playCheckdown = () => {
      const state = table.getHandState();
      if (!state || state.actionSeat == null) return false;
      const actor = state.players.find((p) => p.seatIndex === state.actionSeat);
      if (!actor) return false;
      const toCall = state.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
      return true;
    };
    for (let i = 0; i < 12 && playCheckdown(); i++) {
      /* check or call through the river */
    }

    const result = table.getLastHandResult();
    expect(table.getHandState()).toBeNull();
    expect(result?.reason).toBe("showdown");
    expect(result?.board).toHaveLength(5);
    expect(result?.handLabel).toEqual(expect.any(String));
    expect(result?.shownHands).toHaveLength(2);
    expect(result?.shownHands.every((h) => h.holeCards.length === 2 && h.handLabel.length > 0)).toBe(true);
  });

  it("runs the board out when both players are all-in", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-allin");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    const actor = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    table.applyAction(actor.playerId, "all-in");
    const next = table.getHandState()!;
    const other = next.players.find((p) => p.seatIndex === next.actionSeat)!;
    table.applyAction(other.playerId, "call");

    expect(table.getHandState()).toBeNull();
    expect(table.getLastHandResult()?.reason).toBe("showdown");
    expect(table.getLastHandResult()?.board).toHaveLength(5);
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

  it("gives the other player a turn after a check", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-check");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();

    const pre = table.getHandState()!;
    const sb = pre.players.find((p) => p.seatIndex === pre.actionSeat)!;
    table.applyAction(sb.playerId, "call");
    const option = table.getHandState()!;
    expect(option.street).toBe("preflop");
    const bb = option.players.find((p) => p.seatIndex === option.actionSeat)!;
    expect(bb.playerId).not.toBe(sb.playerId);
    table.applyAction(bb.playerId, "check");

    const flop = table.getHandState()!;
    expect(flop.street).toBe("flop");
    const first = flop.players.find((p) => p.seatIndex === flop.actionSeat)!;
    table.applyAction(first.playerId, "check");
    const stillFlop = table.getHandState()!;
    expect(stillFlop.street).toBe("flop");
    expect(stillFlop.actionSeat).not.toBe(first.seatIndex);
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

  it("opens under the gun at six-max and moves the button", () => {
    const table = new NlheTableEngine(config);
    for (let seat = 0; seat < 6; seat++) {
      table.seatPlayer(`p${seat}`, seat, 5_000_000_000_000n);
    }
    table.startHand("six");
    for (let seat = 0; seat < 6; seat++) {
      table.submitPlayerSeed(`p${seat}`, generateServerSeed());
    }
    table.revealAndDeal();

    const hand = table.getHandState()!;
    expect(hand.dealerSeat).toBe(0);
    expect(hand.players.find((player) => player.seatIndex === 1)?.betThisStreetMojos).toBe(
      config.smallBlindMojos,
    );
    expect(hand.players.find((player) => player.seatIndex === 2)?.betThisStreetMojos).toBe(
      config.bigBlindMojos,
    );
    expect(hand.actionSeat).toBe(3);

    table.applyAction("p3", "fold");
    table.applyAction("p4", "fold");
    table.applyAction("p5", "fold");
    table.applyAction("p0", "fold");
    table.applyAction("p1", "fold");
    expect(table.isHandInProgress()).toBe(false);
    expect(table.getLastHandResult()?.winnerId).toBe("p2");
    expect(table.getButtonSeat()).toBe(1);
  });

  it("starts the flop with the small blind in a three-handed game", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.seatPlayer("cara", 2, 5_000_000_000_000n);
    table.startHand("three");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("cara", generateServerSeed());
    table.revealAndDeal();

    const act = () => {
      const state = table.getHandState();
      if (!state || state.actionSeat == null) return;
      const actor = state.players.find((player) => player.seatIndex === state.actionSeat)!;
      const toCall = state.currentBetMojos - actor.betThisStreetMojos;
      table.applyAction(actor.playerId, toCall > 0n ? "call" : "check");
    };
    act();
    act();
    act();
    const flop = table.getHandState()!;
    expect(flop.street).toBe("flop");
    expect(flop.actionSeat).toBe(1);
  });

  it("deals around a busted player and posts the new limits", () => {
    const table = new NlheTableEngine({
      ...config,
      format: "sng",
      smallBlindMojos: 10_000n,
      bigBlindMojos: 20_000n,
      minBuyInMojos: 1_500_000n,
      maxBuyInMojos: 1_500_000n,
    });
    table.seatPlayer("alice", 0, 1_500_000n);
    table.seatPlayer("bob", 1, 1_500_000n);
    table.seatPlayer("cara", 2, 1_500_000n);
    table.setPlayerStack("bob", 0n);
    table.setLimits(15_000n, 30_000n);

    table.startHand("sng");
    const dealt = table.getHandState()!;
    expect(dealt.players.map((player) => player.playerId)).toEqual(["alice", "cara"]);
    for (const player of dealt.players) {
      table.submitPlayerSeed(player.playerId, generateServerSeed());
    }
    table.revealAndDeal();
    const hand = table.getHandState()!;
    expect(hand.dealerSeat).toBe(0);
    expect(hand.players.find((player) => player.playerId === "alice")?.betThisStreetMojos).toBe(15_000n);
    expect(hand.players.find((player) => player.playerId === "cara")?.betThisStreetMojos).toBe(30_000n);
    expect(hand.actionSeat).toBe(0);
  });

  it("moves the button past a player who busted", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.seatPlayer("cara", 2, 5_000_000_000_000n);
    table.startHand("bust");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.submitPlayerSeed("cara", generateServerSeed());
    table.revealAndDeal();
    table.applyAction("alice", "fold");
    table.applyAction("bob", "fold");
    expect(table.getButtonSeat()).toBe(1);
    table.setPlayerStack("bob", 0n);
    table.startHand("after");
    expect(table.getHandState()?.players.map((player) => player.playerId)).toEqual(["alice", "cara"]);
    expect(table.getHandState()?.dealerSeat).toBe(2);
  });

  it("rejects cash out during active hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-4");
    expect(() => table.cashOutPlayer("alice")).toThrow(/active hand/i);
  });
});
