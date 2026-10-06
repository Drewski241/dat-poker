import { describe, expect, it } from "vitest";
import { TournamentEngine } from "./tournament.js";

function playerIds(n: number, prefix = "p"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

describe("TournamentEngine", () => {
  it("runs an 8-max SNG from registration to winner", () => {
    const t = new TournamentEngine({
      name: "Test SNG",
      format: "sng",
      maxSeats: 8,
      maxEntries: 8,
      minEntries: 8,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
      feeBps: 0,
    });

    t.registerPlayers(playerIds(8));
    const started = t.start();
    expect(started.tableCount).toBe(1);
    expect(started.status).toBe("final_table");
    expect(started.prizePool.prizePoolMojos).toBeGreaterThan(0n);
    expect(t.getSnapshot().tables?.[0]?.seats).toHaveLength(8);

    for (let i = 0; i < 7; i++) {
      const result = t.eliminatePlayer(`p${i}`);
      expect(result.finishPosition).toBe(8 - i);
    }
    expect(t.getStatus()).toBe("completed");
    expect(t.getSnapshot().winnerId).toBe("p7");
    expect(t.getSnapshot().players?.find((p) => p.playerId === "p7")?.finishPosition).toBe(1);
    expect(t.getSnapshot().players?.find((p) => p.playerId === "p7")?.prizeMojos).toBeGreaterThan(
      0n,
    );
  });

  it("defaults MTT registration to unlimited", () => {
    const t = new TournamentEngine({ name: "Open field", format: "mtt" });
    expect(t.isRegistrationUnlimited()).toBe(true);
    expect(t.getConfig().maxEntries).toBeNull();
    t.registerPlayers(playerIds(50));
    expect(t.getRegisteredCount()).toBe(50);
  });

  it("seats thousands of MTT players across 8-max tables", () => {
    const entries = 2_000;
    const t = new TournamentEngine({
      name: "Field of 2000",
      format: "mtt",
      maxSeats: 8,
      maxEntries: null,
      minEntries: 2,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });

    t.registerPlayers(playerIds(entries));
    const started = t.start();
    expect(started.tableCount).toBe(250);
    expect(started.status).toBe("running");
    expect(started.movesTruncated).toBe(false);

    const snap = t.getSnapshot();
    expect(snap.activeCount).toBe(entries);
    expect(snap.tableCount).toBe(250);
    expect(snap.tables?.every((table) => table.seats.length <= 8)).toBe(true);

    const sizes = snap.tables!.map((table) => table.seats.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("reseats after eliminations and reaches a final table", () => {
    const t = new TournamentEngine({
      name: "24-runner MTT",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 24,
      minEntries: 24,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });
    t.registerPlayers(playerIds(24));
    t.start();
    expect(t.getSnapshot().tableCount).toBe(3);

    for (let i = 0; i < 16; i++) {
      const result = t.eliminatePlayer(`p${i}`);
      expect(result.finishPosition).toBe(24 - i);
    }

    const snap = t.getSnapshot();
    expect(snap.status).toBe("final_table");
    expect(snap.activeCount).toBe(8);
    expect(snap.tableCount).toBe(1);
    expect(snap.handForHand?.active).toBe(true);
    expect(snap.tables?.filter((x) => !x.closed)).toHaveLength(1);
    expect(snap.tables?.find((x) => !x.closed)?.isFinalTable).toBe(true);
    expect(snap.tables?.find((x) => !x.closed)?.seats).toHaveLength(8);
  });

  it("breaks tables and balances as the field shrinks", () => {
    const t = new TournamentEngine({
      name: "Balance demo",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 20,
      minEntries: 20,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });
    t.registerPlayers(playerIds(20));
    t.start();
    expect(t.getSnapshot().tableCount).toBe(3);

    for (let i = 0; i < 4; i++) {
      t.eliminatePlayer(`p${i}`);
    }
    const mid = t.getSnapshot();
    expect(mid.activeCount).toBe(16);
    expect(mid.tableCount).toBe(2);
    const openSizes = mid.tables!.filter((x) => !x.closed).map((x) => x.seats.length);
    expect(Math.max(...openSizes) - Math.min(...openSizes)).toBeLessThanOrEqual(1);
  });

  it("seats 100k players with lazy engines (no per-table engine until asked)", () => {
    const entries = 100_000;
    const t = new TournamentEngine({
      name: "Mega field",
      format: "mtt",
      maxSeats: 8,
      maxEntries: null,
      minEntries: 2,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });
    const ids = playerIds(entries);
    const t0 = Date.now();
    t.registerPlayers(ids);
    const started = t.start();
    const elapsed = Date.now() - t0;

    expect(started.tableCount).toBe(12_500);
    expect(started.movesTruncated).toBe(true);
    expect(t.getActiveCount()).toBe(entries);
    expect(t.isRegistrationUnlimited()).toBe(true);

    const summary = t.getSummary();
    expect(summary.tableCount).toBe(12_500);
    expect(summary.maxEntries).toBeNull();
    expect(summary.prizePoolMojos).toBeGreaterThan(0n);

    const snap = t.getSnapshot();
    expect(snap.players).toBeUndefined();
    expect(snap.tables).toBeUndefined();

    const tableId = t.listOpenTableIds()[0]!;
    const engine = t.getTableEngine(tableId);
    expect(engine).toBeDefined();
    expect(engine!.getActivePlayerCount()).toBeGreaterThanOrEqual(7);
    expect(engine!.getActivePlayerCount()).toBeLessThanOrEqual(8);

    expect(elapsed).toBeLessThan(60_000);
  });

  it("advances blinds on materialized open tables", () => {
    const t = new TournamentEngine({
      name: "Blind up",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 16,
      minEntries: 16,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
    });
    t.registerPlayers(playerIds(16));
    t.start();
    for (const tableId of t.listOpenTableIds()) {
      t.getTableEngine(tableId);
    }
    const before = t.getSummary().bigBlindMojos;
    const level = t.advanceBlindLevel();
    expect(level.bigBlindMojos).toBeGreaterThan(before);
    for (const tableId of t.listOpenTableIds()) {
      const engine = t.getTableEngine(tableId);
      expect(engine?.getConfig().bigBlindMojos).toBe(level.bigBlindMojos);
    }
  });

  it("exposes live ICM on the final table", () => {
    const t = new TournamentEngine({
      name: "ICM FT",
      format: "sng",
      maxSeats: 3,
      maxEntries: 3,
      minEntries: 3,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
      feeBps: 0,
      buyInMojos: 1_000n,
    });
    t.registerPlayers(["a", "b", "c"]);
    t.start();
    const icm = t.computeLiveIcm();
    expect(icm).toHaveLength(3);
    const sum = icm.reduce((a, r) => a + r.equityMojos, 0n);
    expect(sum).toBe(t.getPrizePoolMojos());
  });

  it("fills remaining SNG seats with house bots that never cash", () => {
    const t = new TournamentEngine({
      name: "House SNG",
      format: "sng",
      maxSeats: 4,
      maxEntries: 4,
      minEntries: 2,
      lateRegThroughLevel: -1,
      reentryAllowed: false,
      feeBps: 0,
      buyInMojos: 1_000n,
    });
    t.registerPlayer("alice");
    const filled = t.fillHouseSeats();
    expect(filled.added).toBe(3);
    expect(t.getRegisteredCount()).toBe(4);
    t.start();
    expect(t.listOpenTableIds()).toHaveLength(1);

    // Bust house first — they get finish places but 0 prize
    const houseIds = filled.houseIds;
    for (const id of houseIds.slice(0, 2)) {
      const r = t.eliminatePlayer(id);
      expect(r.prizeMojos).toBe(0n);
    }
    t.eliminatePlayer(houseIds[2]!);
    expect(t.getStatus()).toBe("completed");
    expect(t.getSnapshot().winnerId).toBe("alice");
    const alice = t.getSnapshot({ detail: true }).players?.find((p) => p.playerId === "alice");
    expect(alice?.finishPosition).toBe(1);
    expect(alice?.prizeMojos).toBeGreaterThan(0n);
  });
});
