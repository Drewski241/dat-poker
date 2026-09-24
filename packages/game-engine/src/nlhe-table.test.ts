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

  it("rejects cash out during active hand", () => {
    const table = new NlheTableEngine(config);
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.startHand("hand-4");
    expect(() => table.cashOutPlayer("alice")).toThrow(/active hand/i);
  });

  it("gives the big blind an option in a 3-handed pot", () => {
    const table = new NlheTableEngine({ ...config, maxSeats: 9 });
    table.seatPlayer("alice", 0, 5_000_000_000_000n);
    table.seatPlayer("bob", 1, 5_000_000_000_000n);
    table.seatPlayer("carol", 2, 5_000_000_000_000n);

    deal(table, "hand-5", ["alice", "bob", "carol"]);
    const pre = table.getHandState()!;
    expect(pre.dealerSeat).toBe(0);
    expect(pre.actionSeat).toBe(0);

    table.applyAction("alice", "call");
    table.applyAction("bob", "call");
    const stillPre = table.getHandState()!;
    expect(stillPre.street).toBe("preflop");
    expect(stillPre.actionSeat).toBe(2);

    table.applyAction("carol", "check");
    expect(table.getHandState()?.street).toBe("flop");
    expect(table.getHandState()?.actionSeat).toBe(1);
  });

  it("awards a short all-in only the main pot", () => {
    const shortConfig: TableConfig = {
      ...config,
      minBuyInMojos: 100n,
      maxBuyInMojos: 20_000_000_000_000n,
      smallBlindMojos: 50n,
      bigBlindMojos: 100n,
    };
    const table = new NlheTableEngine(shortConfig);
    table.seatPlayer("short", 0, 150n);
    table.seatPlayer("mid", 1, 1_000n);
    table.seatPlayer("deep", 2, 1_000n);

    deal(table, "hand-6", ["short", "mid", "deep"]);
    table.applyAction("short", "all-in");
    table.applyAction("mid", "raise", 400n);
    table.applyAction("deep", "call");
    table.applyAction("mid", "check");
    table.applyAction("deep", "check");
    table.applyAction("mid", "check");
    table.applyAction("deep", "check");
    table.applyAction("mid", "check");
    table.applyAction("deep", "check");

    expect(table.isHandInProgress()).toBe(false);
    const stacks = {
      short: table.getPlayerStack("short")!,
      mid: table.getPlayerStack("mid")!,
      deep: table.getPlayerStack("deep")!,
    };
    expect(stacks.short + stacks.mid + stacks.deep).toBe(2_150n);
    expect(stacks.short === 0n || stacks.short === 450n).toBe(true);
  });
});

function deal(table: NlheTableEngine, handId: string, players: string[]): void {
  table.startHand(handId);
  for (const playerId of players) {
    table.submitPlayerSeed(playerId, generateServerSeed());
  }
  table.revealAndDeal();
}
