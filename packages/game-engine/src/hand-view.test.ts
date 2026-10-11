import { describe, expect, it } from "vitest";
import { publicHandView } from "./hand-view.js";
import type { TableHandState } from "./nlhe-table.js";

function hand(street: TableHandState["street"]): TableHandState {
  return {
    handId: "h1",
    tableId: "t1",
    street,
    board: [],
    potMojos: 10n,
    currentBetMojos: 2n,
    lastRaiseIncrementMojos: 2n,
    dealerSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
    actionSeat: 0,
    players: [
      {
        playerId: "alice",
        seatIndex: 0,
        holeCards: [
          { rank: "A", suit: "s" },
          { rank: "K", suit: "s" },
        ],
        stackMojos: 100n,
        betThisStreetMojos: 0n,
        totalBetHandMojos: 0n,
        folded: false,
        allIn: false,
        actedThisStreet: false,
      },
      {
        playerId: "bob",
        seatIndex: 1,
        holeCards: [
          { rank: "2", suit: "c" },
          { rank: "7", suit: "d" },
        ],
        stackMojos: 100n,
        betThisStreetMojos: 0n,
        totalBetHandMojos: 0n,
        folded: false,
        allIn: false,
        actedThisStreet: false,
      },
    ],
    commitHash: "abc",
    serverSeed: "secret",
    playerSeeds: { alice: "a", bob: "b" },
    deck: [],
    deckIndex: 0,
    seq: 1,
  };
}

describe("publicHandView", () => {
  it("shows only the viewer's hole cards before showdown", () => {
    const view = publicHandView(hand("preflop"), "alice")!;
    expect(view.players.find((p) => p.playerId === "alice")?.holeCards).toEqual([
      { rank: "A", suit: "s" },
      { rank: "K", suit: "s" },
    ]);
    expect(view.players.find((p) => p.playerId === "bob")?.holeCards).toEqual([]);
    expect(view.players.find((p) => p.playerId === "bob")?.holeCardCount).toBe(2);
    expect(view).not.toHaveProperty("serverSeed");
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("playerSeeds");
  });

  it("hides every hole card when no viewer is given", () => {
    const view = publicHandView(hand("flop"), undefined)!;
    expect(view.players.every((p) => p.holeCards.length === 0)).toBe(true);
  });

  it("still hides the other player's hole cards at showdown", () => {
    const view = publicHandView(hand("showdown"), "alice")!;
    expect(view.players.find((p) => p.playerId === "alice")?.holeCards).toHaveLength(2);
    expect(view.players.find((p) => p.playerId === "bob")?.holeCards).toEqual([]);
    expect(view.players.find((p) => p.playerId === "bob")?.holeCardCount).toBe(2);
  });

  it("gives each viewer only their own cards from the same hand", () => {
    const source = hand("preflop");
    const alice = publicHandView(source, "alice")!;
    const bob = publicHandView(source, "bob")!;
    expect(alice.players.find((p) => p.playerId === "alice")?.holeCards[0]?.rank).toBe("A");
    expect(alice.players.find((p) => p.playerId === "bob")?.holeCards).toEqual([]);
    expect(bob.players.find((p) => p.playerId === "bob")?.holeCards[0]?.rank).toBe("2");
    expect(bob.players.find((p) => p.playerId === "alice")?.holeCards).toEqual([]);
  });
});
