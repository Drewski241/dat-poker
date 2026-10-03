import { describe, expect, it } from "vitest";
import { computeIcm } from "./icm.js";

describe("ICM", () => {
  it("gives chip leader more equity but not chip EV", () => {
    const results = computeIcm(
      [
        { playerId: "a", stackMojos: 5000n },
        { playerId: "b", stackMojos: 3000n },
        { playerId: "c", stackMojos: 2000n },
      ],
      [5000n, 3000n, 2000n],
    );
    const byId = Object.fromEntries(results.map((r) => [r.playerId, r]));
    expect(byId.a!.equityMojos).toBeGreaterThan(byId.b!.equityMojos);
    expect(byId.b!.equityMojos).toBeGreaterThan(byId.c!.equityMojos);
    // Chip EV for A would be 5000; ICM should be less (bubble factor)
    expect(byId.a!.equityMojos).toBeLessThan(5000n);
    const sum = results.reduce((a, r) => a + r.equityMojos, 0n);
    expect(sum).toBeGreaterThanOrEqual(9900n);
    expect(sum).toBeLessThanOrEqual(10_100n);
  });

  it("is winner-take-all when only one prize", () => {
    const results = computeIcm(
      [
        { playerId: "a", stackMojos: 7000n },
        { playerId: "b", stackMojos: 3000n },
      ],
      [10_000n],
    );
    expect(results[0]!.equityMojos + results[1]!.equityMojos).toBe(10_000n);
    expect(results.find((r) => r.playerId === "a")!.equityMojos).toBe(7000n);
  });
});
