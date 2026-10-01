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
    });

    t.registerPlayers(playerIds(8));
    const started = t.start();
    expect(started.tableCount).toBe(1);
    expect(started.status).toBe("final_table");
    expect(t.getSnapshot().tables[0]?.seats).toHaveLength(8);

    // Eliminate down to one winner
    for (let i = 0; i < 7; i++) {
      const result = t.eliminatePlayer(`p${i}`);
      expect(result.finishPosition).toBe(8 - i);
    }
    expect(t.getStatus()).toBe("completed");
    expect(t.getSnapshot().winnerId).toBe("p7");
    expect(t.getSnapshot().players.find((p) => p.playerId === "p7")?.finishPosition).toBe(1);
  });

  it("seats thousands of MTT players across 8-max tables", () => {
    const entries = 2_000;
    const t = new TournamentEngine({
      name: "Field of 2000",
      format: "mtt",
      maxSeats: 8,
      maxEntries: entries,
      minEntries: 2,
    });

    t.registerPlayers(playerIds(entries));
    const started = t.start();
    expect(started.tableCount).toBe(250);
    expect(started.status).toBe("running");

    const snap = t.getSnapshot();
    expect(snap.activeCount).toBe(entries);
    expect(snap.tableCount).toBe(250);
    expect(snap.tables.every((table) => table.seats.length <= 8)).toBe(true);

    const sizes = snap.tables.map((table) => table.seats.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("reseats after eliminations and reaches a final table", () => {
    // 24 players → 3 tables of 8. Bust down until final table (≤8).
    const t = new TournamentEngine({
      name: "24-runner MTT",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 24,
      minEntries: 24,
    });
    t.registerPlayers(playerIds(24));
    t.start();
    expect(t.getSnapshot().tableCount).toBe(3);

    // Eliminate 16 players → 8 remain → final table
    for (let i = 0; i < 16; i++) {
      const result = t.eliminatePlayer(`p${i}`);
      expect(result.finishPosition).toBe(24 - i);
    }

    const snap = t.getSnapshot();
    expect(snap.status).toBe("final_table");
    expect(snap.activeCount).toBe(8);
    expect(snap.tableCount).toBe(1);
    expect(snap.tables.filter((x) => !x.closed)).toHaveLength(1);
    expect(snap.tables.find((x) => !x.closed)?.isFinalTable).toBe(true);
    expect(snap.tables.find((x) => !x.closed)?.seats).toHaveLength(8);
  });

  it("breaks tables and balances as the field shrinks", () => {
    const t = new TournamentEngine({
      name: "Balance demo",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 20,
      minEntries: 20,
    });
    t.registerPlayers(playerIds(20));
    t.start();
    // 20 players → 3 tables (ceil(20/8)=3), sizes 7/7/6
    expect(t.getSnapshot().tableCount).toBe(3);

    // Bust 4 → 16 players → still 2 tables needed
    for (let i = 0; i < 4; i++) {
      t.eliminatePlayer(`p${i}`);
    }
    const mid = t.getSnapshot();
    expect(mid.activeCount).toBe(16);
    expect(mid.tableCount).toBe(2);
    const openSizes = mid.tables.filter((x) => !x.closed).map((x) => x.seats.length);
    expect(Math.max(...openSizes) - Math.min(...openSizes)).toBeLessThanOrEqual(1);
  });

  it("scales seating for 10k players efficiently", () => {
    const entries = 10_000;
    const t = new TournamentEngine({
      name: "Mega field",
      format: "mtt",
      maxSeats: 8,
      maxEntries: entries,
      minEntries: 2,
    });
    const ids = playerIds(entries);
    const t0 = Date.now();
    t.registerPlayers(ids);
    const started = t.start();
    const elapsed = Date.now() - t0;

    expect(started.tableCount).toBe(1250);
    expect(t.getActiveCount()).toBe(entries);
    // Should be well under a couple seconds even in CI
    expect(elapsed).toBeLessThan(15_000);
  });

  it("advances blinds on all open tables", () => {
    const t = new TournamentEngine({
      name: "Blind up",
      format: "mtt",
      maxSeats: 8,
      maxEntries: 16,
      minEntries: 16,
    });
    t.registerPlayers(playerIds(16));
    t.start();
    const before = t.getSnapshot().bigBlindMojos;
    const level = t.advanceBlindLevel();
    expect(level.bigBlindMojos).toBeGreaterThan(before);
    for (const tableId of t.listOpenTableIds()) {
      const engine = t.getTableEngine(tableId);
      expect(engine?.getConfig().bigBlindMojos).toBe(level.bigBlindMojos);
    }
  });
});
