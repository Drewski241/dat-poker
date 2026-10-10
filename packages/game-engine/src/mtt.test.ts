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
    expect(event.prizePoolMojos).toBe(
      DAT_MTT_DEFAULTS.buyInMojos * BigInt(DAT_MTT_DEFAULTS.fieldSize),
    );
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
    const finalEngine = event.engineFor(finalId!)!;
    expect(finalEngine.activeSeatedPlayers().length).toBe(8);
    expect(finalEngine.getLastHandResult()).toBeNull();
    finalEngine.startHand("final-hand-1");
    expect(finalEngine.isHandInProgress()).toBe(true);
    finalEngine.abortHandRefundBets();
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

  it("consolidates a third short table so survivors refill toward 8-max", () => {
    const event = MttEvent.create({ fieldSize: 24, maxHumans: 3 });
    const [a, b, c] = event.tableIds();
    expect(event.tableIds()).toHaveLength(3);
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();

    // Bust table C down to 4 and table B down to 4 → 8+4+4 = 16 alive, ideal = 2 tables.
    const bustB = event.engineFor(b)!.getSeatedPlayers().slice(0, 4);
    const bustC = event.engineFor(c)!.getSeatedPlayers().slice(0, 4);
    for (const row of bustB) bust(event, b, row.playerId);
    for (const row of bustC) bust(event, c, row.playerId);
    event.afterHand(b);
    event.afterHand(c);

    const openIds = event.openTableIds();
    expect(openIds).toHaveLength(2);
    expect(event.snapshot(a).eventPlayersRemaining).toBe(16);
    expect(event.snapshot(a).tableCount).toBe(2);
    const counts = openIds.map(
      (id) => event.engineFor(id)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length,
    );
    expect(counts.sort((x, y) => x - y)).toEqual([8, 8]);
    expect(event.engineFor(a)!.hasPlayer("alice")).toBe(true);
    // Closed table redirects into the remaining field.
    expect(event.relocatedTo(c) ?? event.relocatedTo(b)).toBeTruthy();
  });

  it("collapses many short tables toward ceil(alive/8) like a mid-field 500 MTT", () => {
    const event = MttEvent.create({ fieldSize: 40, maxHumans: 5 });
    const ids = event.tableIds();
    expect(ids).toHaveLength(5);
    event.seatPlayer(ids[0]!, "alice", 0);
    event.fillHouseSeats();
    event.start();

    // Bust extras on every table first, then settle once — mirrors late-field redraw
    // after many tables finish hands with ~3 survivors each (15 alive → 2 tables).
    for (const tableId of ids) {
      const keep = tableId === ids[0]! ? new Set(["alice"]) : new Set<string>();
      const seated = event.engineFor(tableId)!.getSeatedPlayers();
      for (const row of seated) {
        if (keep.has(row.playerId)) continue;
        if (keep.size >= 3) {
          bust(event, tableId, row.playerId);
        } else {
          keep.add(row.playerId);
        }
      }
    }
    for (const tableId of ids) {
      event.afterHand(tableId);
    }

    const openIds = event.openTableIds();
    expect(openIds).toHaveLength(2);
    expect(event.snapshot(openIds[0]!).eventPlayersRemaining).toBe(15);
    const counts = openIds
      .map((id) => event.engineFor(id)!.getSeatedPlayers().filter((p) => p.stackMojos > 0n).length)
      .sort((a, b) => a - b);
    expect(counts).toEqual([7, 8]);
    expect(
      openIds.some((id) => event.engineFor(id)!.hasPlayer("alice")),
    ).toBe(true);
  });

  it("pauses short break-candidate tables in a large field until redraw completes", () => {
    const event = MttEvent.create({ fieldSize: 24, maxHumans: 3 });
    const [a, b, c] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    const bustB = event.engineFor(b)!.getSeatedPlayers().slice(0, 4);
    const bustC = event.engineFor(c)!.getSeatedPlayers().slice(0, 4);
    for (const row of bustB) bust(event, b, row.playerId);
    for (const row of bustC) bust(event, c, row.playerId);
    // Both fuller/sibling tables busy — short table cannot reseat yet.
    event.engineFor(a)!.startHand("hand-hold-a");
    event.engineFor(b)!.startHand("hand-hold-b");
    event.afterHand(c);
    expect(event.openTableIds()).toHaveLength(3);
    const breakPaused = [b, c].filter((id) => event.shouldPauseDeals(id));
    expect(breakPaused.length).toBeGreaterThanOrEqual(1);
    expect(event.shouldPauseDeals(a)).toBe(false);
    event.engineFor(a)!.abortHandRefundBets();
    event.engineFor(b)!.abortHandRefundBets();
    event.afterHand(a);
    event.afterHand(b);
    event.afterHand(c);
    expect(event.openTableIds()).toHaveLength(2);
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

  it("tracks hands per table and advances blinds by the furthest table only", () => {
    const event = MttEvent.create();
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.start();
    event.onHandStarted(a);
    event.onHandStarted(a);
    event.onHandStarted(b);
    expect(event.handsDealtAt(a)).toBe(2);
    expect(event.handsDealtAt(b)).toBe(1);
    expect(event.snapshot(a).handNumber).toBe(2);
    event.onHandStarted(b);
    expect(event.snapshot(a).handNumber).toBe(2);
  });

  it("caps humans at maxHumans and keeps remaining seats as house", () => {
    const event = MttEvent.create({ maxHumans: 2 });
    const [a, b] = event.tableIds();
    event.seatPlayer(a, "alice", 0);
    event.fillHouseSeats();
    event.claimHouseSeat(a, "bob");
    expect(event.enteredHumanCount()).toBe(2);
    expect(event.canAcceptHuman("carol")).toBe(false);
    expect(() => event.claimHouseSeat(b, "carol")).toThrow(/maximum of 2 human/);
    expect(event.snapshot(a).maxHumans).toBe(2);
  });
});
