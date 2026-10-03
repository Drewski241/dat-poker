import { describe, expect, it } from "vitest";
import {
  assignPlayersToTables,
  evenSeatCounts,
  nextOpenSeat,
  tablesNeeded,
} from "./seating.js";

describe("seating", () => {
  it("computes tables needed for 8-max", () => {
    expect(tablesNeeded(1, 8)).toBe(1);
    expect(tablesNeeded(8, 8)).toBe(1);
    expect(tablesNeeded(9, 8)).toBe(2);
    expect(tablesNeeded(1000, 8)).toBe(125);
    expect(tablesNeeded(10_000, 8)).toBe(1250);
  });

  it("distributes evenly with max-min <= 1", () => {
    const counts = evenSeatCounts(1000, 125, 8);
    expect(counts).toHaveLength(125);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(8);
  });

  it("assigns players into even tables", () => {
    const players = Array.from({ length: 27 }, (_, i) => `p${i}`);
    const tables = assignPlayersToTables(players, 4, 8);
    expect(tables).toHaveLength(4);
    const sizes = tables.map((t) => t.length).sort((a, b) => a - b);
    expect(sizes).toEqual([6, 7, 7, 7]);
    expect(tables.flat().sort()).toEqual([...players].sort());
  });

  it("finds next open seat", () => {
    expect(nextOpenSeat(new Set([0, 1, 3]), 8)).toBe(2);
    expect(nextOpenSeat(new Set([0, 1, 2, 3, 4, 5, 6, 7]), 8)).toBeNull();
  });
});
