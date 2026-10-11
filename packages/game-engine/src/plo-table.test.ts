import { describe, expect, it } from "vitest";
import type { TableConfig } from "@dat-poker/shared";
import { NlheTableEngine } from "./nlhe-table.js";
import { generateServerSeed } from "./shuffle.js";
import { MttEvent } from "./mtt.js";

const ploCash: TableConfig = {
  id: "plo-cash-1",
  variant: "plo4",
  format: "cash",
  maxSeats: 6,
  smallBlindMojos: 50n,
  bigBlindMojos: 100n,
  minBuyInMojos: 1_000n,
  maxBuyInMojos: 10_000n,
  rakeBps: 0,
};

describe("PLO table engine", () => {
  it("deals four hole cards and enforces pot-limit opens", () => {
    const table = new NlheTableEngine(ploCash);
    table.seatPlayer("alice", 0, 5_000n);
    table.seatPlayer("bob", 1, 5_000n);
    table.startHand("plo-1");
    table.submitPlayerSeed("alice", generateServerSeed());
    table.submitPlayerSeed("bob", generateServerSeed());
    table.revealAndDeal();
    const state = table.getHandState()!;
    expect(state.players.every((p) => p.holeCards.length === 4)).toBe(true);

    // Pot-limit must clamp an oversize raise-to (never open for the whole stack).
    const actor = state.players.find((p) => p.seatIndex === state.actionSeat)!;
    const toCall =
      state.currentBetMojos > actor.betThisStreetMojos
        ? state.currentBetMojos - actor.betThisStreetMojos
        : 0n;
    const potMax = state.potMojos + state.currentBetMojos + toCall;
    expect(potMax).toBeLessThan(actor.stackMojos + actor.betThisStreetMojos);
    expect(() => table.applyAction(actor.playerId, "raise", 5_000n)).not.toThrow();
    const after = table.getHandState();
    if (after) {
      const raiser = after.players.find((p) => p.playerId === actor.playerId)!;
      expect(raiser.betThisStreetMojos).toBeLessThanOrEqual(potMax);
    }
  });

  it("builds a 16-player PLO SNG as two 8-max tables", () => {
    const event = MttEvent.create({
      fieldSize: 16,
      startingTableSeats: 8,
      finalTableSeats: 8,
      variant: "plo4",
      fillHouse: true,
      minHumansToStart: 1,
    });
    expect(event.variant).toBe("plo4");
    expect(event.startingTableSeats).toBe(8);
    expect(event.finalTableSeats).toBe(8);
    expect(event.startingTableCount).toBe(2);
    const [a, b] = event.tableIds();
    expect(event.engineFor(a)!.getConfig().variant).toBe("plo4");
    expect(event.engineFor(a)!.getMaxSeats()).toBe(8);
    expect(event.engineFor(b)!.getMaxSeats()).toBe(8);
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    expect(event.getStatus()).toBe("running");
    expect(event.snapshot(a).variant).toBe("plo4");
  });
});
