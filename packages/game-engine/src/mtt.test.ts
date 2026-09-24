import { describe, expect, it } from "vitest";
import { DAT_MTT_DEFAULTS, isHousePlayerId } from "@dat-poker/shared";
import { MttEvent } from "./mtt.js";

function bust(event: MttEvent, tableId: string, playerId: string): void {
  event.engineFor(tableId)!.setPlayerStack(playerId, 0n);
}

describe("16-player MTT", () => {
  it("starts two 8-max tables and fills house seats", () => {
    const event = MttEvent.create();
    const ids = event.tableIds();
    expect(ids).toHaveLength(2);
    event.seatPlayer(ids[0], "alice", 0);
    event.fillHouseSeats();
    expect(event.engines().every((eng) => eng.getActivePlayerCount() === 8)).toBe(true);
    expect(event.engines().every((eng) => eng.getConfig().format === "mtt")).toBe(true);
    expect(event.canStart()).toBe(true);
    event.start();
    expect(event.getStatus()).toBe("running");
    expect(event.snapshot(ids[0]).kind).toBe("mtt");
    expect(event.snapshot(ids[0]).tableLabel).toBe("Table 1");
    expect(event.snapshot(ids[1]).tableLabel).toBe("Table 2");
    expect(event.snapshot(ids[0]).eventPlayersRemaining).toBe(16);
    expect(event.prizePoolMojos).toBe(DAT_MTT_DEFAULTS.buyInMojos);
  });

  it("moves survivors to a final table when eight or fewer remain", () => {
    const event = MttEvent.create();
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();

    const extraBusts = event
      .engineFor(a)!
      .getSeatedPlayers()
      .filter((p) => p.playerId !== "alice")
      .slice(0, 4);
    for (const row of extraBusts) bust(event, a, row.playerId);
    event.afterHand(a);
    expect(event.relocatedTo(a)).toBeNull();
    expect(event.engineFor(a)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n)).toHaveLength(6);
    expect(event.engineFor(b)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n)).toHaveLength(6);

    const extraBustsB = event.engineFor(b)!.getSeatedPlayers().slice(0, 4);
    for (const row of extraBustsB) bust(event, b, row.playerId);
    const snap = event.afterHand(b);
    const finalId = event.consumePendingTables()[0]?.getConfig().id;
    expect(finalId).toBeTruthy();
    expect(event.relocatedTo(a)).toBe(finalId);
    expect(event.relocatedTo(b)).toBe(finalId);
    expect(snap.relocatedToTableId).toBe(finalId);
    const final = event.snapshot(finalId!);
    expect(final.isFinalTable).toBe(true);
    expect(final.tableLabel).toBe("Final Table");
    expect(final.eventPlayersRemaining).toBe(8);
    expect(event.engineFor(finalId!)!.hasPlayer("alice")).toBe(true);
  });

  it("waits to form the final table while the other table is still in a hand", () => {
    const event = MttEvent.create({
      blindLevels: [{ smallBlindMojos: 10n, bigBlindMojos: 20n }],
    });
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    const toBustA = event
      .engineFor(a)!
      .getSeatedPlayers()
      .filter((p) => p.playerId !== "alice")
      .slice(0, 4);
    const toBustB = event.engineFor(b)!.getSeatedPlayers().slice(0, 4);
    for (const row of toBustA) bust(event, a, row.playerId);
    for (const row of toBustB) bust(event, b, row.playerId);
    event.engineFor(b)!.startHand("hand-hold");
    event.afterHand(a);
    expect(event.relocatedTo(a)).toBeNull();
    expect(event.shouldPauseDeals(a)).toBe(true);
    expect(event.snapshot(a).pendingFinalTable).toBe(true);
    event.engineFor(b)!.abortHandRefundBets();
    event.afterHand(b);
    expect(event.consumePendingTables()).toHaveLength(1);
  });

  it("balances a 4-max table against an 8-max table instead of waiting for eight left", () => {
    const event = MttEvent.create();
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    const busts = event
      .engineFor(a)!
      .getSeatedPlayers()
      .filter((p) => p.playerId !== "alice")
      .slice(0, 4);
    for (const row of busts) bust(event, a, row.playerId);
    event.afterHand(a);
    expect(event.snapshot(a).isFinalTable).toBe(false);
    expect(event.snapshot(a).eventPlayersRemaining).toBe(12);
    expect(event.engineFor(a)!.hasPlayer("alice")).toBe(true);
    expect(event.engineFor(a)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n)).toHaveLength(6);
    expect(event.engineFor(b)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n)).toHaveLength(6);
    expect(event.shouldPauseDeals(a)).toBe(false);
  });

  it("pays overall 1st–3rd when the last human busts", () => {
    const event = MttEvent.create();
    const [a] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    bust(event, a, "alice");
    event.afterHand(a);
    expect(event.getStatus()).toBe("finished");
    const alice = event.snapshot(a).placements.find((row) => row.playerId === "alice");
    expect(alice).toBeTruthy();
    expect(isHousePlayerId(alice!.playerId)).toBe(false);
  });
});
