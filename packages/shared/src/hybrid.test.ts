import { describe, expect, it } from "vitest";
import {
  assertDatOnlyWager,
  assertSeatCount,
  resolveHybridPlay,
  WagerPolicyError,
} from "./hybrid.js";
import { POKER_VARIANTS } from "./variants.js";

describe("DAT wager policy", () => {
  it("accepts DAT and rejects XCH and other assets", () => {
    expect(() => assertDatOnlyWager(undefined)).not.toThrow();
    expect(() => assertDatOnlyWager("")).not.toThrow();
    expect(() => assertDatOnlyWager("dat")).not.toThrow();
    expect(() => assertDatOnlyWager("xch")).toThrow(WagerPolicyError);
    expect(() => assertDatOnlyWager("cat")).toThrow(/DAT governance token/);
  });
});

describe("resolveHybridPlay", () => {
  it("sends every variant's heads-up table onto chia-gaming with a zero XCH stake", () => {
    for (const variant of POKER_VARIANTS) {
      const decision = resolveHybridPlay({
        seated: 2,
        maxSeats: 2,
        format: "cash",
        variant: variant.id,
      });
      expect(decision.mode).toBe("chia-gaming-heads-up");
      expect(decision.wagerAsset).toBe("dat");
      expect(decision.xchWagerMojos).toBe(0n);
      expect(decision.headsUpPromotion).toBe(false);
    }
  });

  it("keeps a short-handed ring on the channel until a third player sits", () => {
    expect(
      resolveHybridPlay({ seated: 2, maxSeats: 6, format: "cash" }).mode,
    ).toBe("chia-gaming-heads-up");
    expect(
      resolveHybridPlay({ seated: 2, maxSeats: 6, format: "cash" }).headsUpPromotion,
    ).toBe(true);
  });

  it("uses the DAT vault for 3+ players, including tournament tables", () => {
    const ring = resolveHybridPlay({ seated: 6, maxSeats: 6, format: "cash" });
    const finalTable = resolveHybridPlay({ seated: 9, maxSeats: 9, format: "mtt" });
    expect(ring.mode).toBe("dat-table-vault");
    expect(finalTable.mode).toBe("dat-table-vault");
    expect(finalTable.xchWagerMojos).toBe(0n);
    expect(finalTable.headsUpPromotion).toBe(true);
  });

  it("promotes a tournament table to the channel at heads-up", () => {
    const decision = resolveHybridPlay({ seated: 2, maxSeats: 9, format: "mtt" });
    expect(decision.mode).toBe("chia-gaming-heads-up");
    expect(decision.headsUpPromotion).toBe(true);
    expect(decision.wagerAsset).toBe("dat");
  });

  it("waits until two players are seated", () => {
    expect(resolveHybridPlay({ seated: 0, maxSeats: 2, format: "cash" }).mode).toBe("waiting");
    expect(resolveHybridPlay({ seated: 1, maxSeats: 9, format: "sng" }).mode).toBe("waiting");
  });

  it("rejects impossible seat counts", () => {
    expect(() => assertSeatCount(1)).toThrow(/maxSeats/);
    expect(() => assertSeatCount(11)).toThrow(/maxSeats/);
    expect(() => resolveHybridPlay({ seated: 3, maxSeats: 2, format: "cash" })).toThrow(/outside/);
  });
});
