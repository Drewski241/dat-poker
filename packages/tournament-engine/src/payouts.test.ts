import { describe, expect, it } from "vitest";
import { buildPrizePool, paidPlacesForField, payoutPercentages } from "./payouts.js";

describe("payouts", () => {
  it("pays ~10% of large fields", () => {
    expect(paidPlacesForField(8)).toBe(3);
    expect(paidPlacesForField(100)).toBe(18);
    expect(paidPlacesForField(1000)).toBe(100);
  });

  it("percentages sum to ~1", () => {
    for (const n of [1, 2, 3, 5, 12, 45]) {
      const pcts = payoutPercentages(n);
      const sum = pcts.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("builds a prize pool with fees", () => {
    const pool = buildPrizePool({
      entries: 10,
      buyInMojos: 10_000n,
      feeBps: 500,
    });
    expect(pool.grossMojos).toBe(100_000n);
    expect(pool.feesMojos).toBe(5_000n);
    expect(pool.prizePoolMojos).toBe(95_000n);
    expect(pool.ladder.length).toBeGreaterThanOrEqual(3);
    const paid = pool.ladder.reduce((a, r) => a + r.amountMojos, 0n);
    expect(paid).toBe(pool.prizePoolMojos);
    expect(pool.ladder[0]!.amountMojos).toBeGreaterThan(pool.ladder[1]!.amountMojos);
  });
});
