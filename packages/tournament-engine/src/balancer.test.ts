import { describe, expect, it } from "vitest";
import { rebalanceTables, type BalancerTable } from "./balancer.js";

function table(
  id: string,
  playerIds: string[],
  opts?: { closed?: boolean; isFinalTable?: boolean },
): BalancerTable {
  const seats = new Map<number, string>();
  playerIds.forEach((pid, i) => seats.set(i, pid));
  return {
    tableId: id,
    closed: opts?.closed ?? false,
    isFinalTable: opts?.isFinalTable ?? false,
    seats,
  };
}

describe("rebalanceTables", () => {
  it("breaks a short table when capacity allows", () => {
    // 3 tables of 3, 3, 2 = 8 players → can fit on 1 table of 8
    // Wait: 8 players → final table. Use 10 players on 3 tables (4,3,3) → min tables = 2
    const tables = [
      table("t1", ["a", "b", "c", "d"]),
      table("t2", ["e", "f", "g"]),
      table("t3", ["h", "i", "j"]),
    ];
    // Eliminate nobody yet — 10 players, max 8 → need 2 tables. Should break one.
    const active = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((playerId) => ({
      playerId,
      stackMojos: 1000n,
      tableId: null,
      seatIndex: null,
    }));

    let next = 0;
    const result = rebalanceTables(tables, active, 8, () => `new-${next++}`);
    const open = result.tables.filter((t) => !t.closed);
    expect(open).toHaveLength(2);
    expect(open.every((t) => t.seats.size <= 8)).toBe(true);
    const sizes = open.map((t) => t.seats.size).sort((a, b) => a - b);
    expect(sizes[1]! - sizes[0]!).toBeLessThanOrEqual(1);
    expect(result.moves.some((m) => m.reason === "table_break")).toBe(true);
  });

  it("balances uneven tables without breaking", () => {
    // 16 players on 2 tables but uneven 10 would be invalid — use 9 and 7 then... max is 8
    // 14 players: tables of 8 and 6 → should move 1 to make 7/7
    const tables = [
      table("t1", ["a", "b", "c", "d", "e", "f", "g", "h"]),
      table("t2", ["i", "j", "k", "l", "m", "n"]),
    ];
    const active = [...tables[0]!.seats.values(), ...tables[1]!.seats.values()].map(
      (playerId) => ({
        playerId,
        stackMojos: 1000n,
        tableId: null as string | null,
        seatIndex: null as number | null,
      }),
    );

    const result = rebalanceTables(tables, active, 8, () => "x");
    const open = result.tables.filter((t) => !t.closed);
    expect(open).toHaveLength(2);
    expect(open.map((t) => t.seats.size).sort()).toEqual([7, 7]);
    expect(result.moves.some((m) => m.reason === "balance")).toBe(true);
    expect(result.isFinalTable).toBe(false);
  });

  it("merges to a final table when players fit on one", () => {
    const tables = [
      table("t1", ["a", "b", "c", "d"]),
      table("t2", ["e", "f", "g"]),
    ];
    const active = ["a", "b", "c", "d", "e", "f", "g"].map((playerId) => ({
      playerId,
      stackMojos: 500n,
      tableId: null as string | null,
      seatIndex: null as number | null,
    }));

    const result = rebalanceTables(tables, active, 8, () => "ft");
    expect(result.isFinalTable).toBe(true);
    const open = result.tables.filter((t) => !t.closed);
    expect(open).toHaveLength(1);
    expect(open[0]!.isFinalTable).toBe(true);
    expect(open[0]!.seats.size).toBe(7);
    expect(result.moves.some((m) => m.reason === "final_table")).toBe(true);
  });
});
