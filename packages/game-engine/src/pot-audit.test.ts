import { describe, expect, it } from "vitest";
import type { HandResult } from "./nlhe-table.js";
import { auditHandResult, auditHistoryStacks } from "./pot-audit.js";

function result(partial: Partial<HandResult> & Pick<HandResult, "participants">): HandResult {
  return {
    handId: "h1",
    winnerId: "a",
    potMojos: 100n,
    totalPotMojos: 100n,
    isChop: false,
    reason: "showdown",
    board: [],
    shown: [],
    allInPlayerIds: [],
    runoutFromBoardLen: null,
    ...partial,
  };
}

describe("pot audit", () => {
  it("accepts a clean sole-win hand", () => {
    expect(
      auditHandResult(
        result({
          participants: [
            {
              playerId: "a",
              totalBetHandMojos: 50n,
              stackBeforePayoutMojos: 0n,
              awardedMojos: 100n,
            },
            {
              playerId: "b",
              totalBetHandMojos: 50n,
              stackBeforePayoutMojos: 50n,
              awardedMojos: 0n,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("flags award sum mismatches", () => {
    const issues = auditHandResult(
      result({
        totalPotMojos: 100n,
        potMojos: 60n,
        participants: [
          {
            playerId: "a",
            totalBetHandMojos: 50n,
            stackBeforePayoutMojos: 0n,
            awardedMojos: 60n,
          },
          {
            playerId: "b",
            totalBetHandMojos: 50n,
            stackBeforePayoutMojos: 0n,
            awardedMojos: 30n,
          },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "award_sum_mismatch")).toBe(true);
  });

  it("accepts side-pot multi-winners that are not chops", () => {
    expect(
      auditHandResult(
        result({
          winnerId: "short",
          potMojos: 3_000n,
          totalPotMojos: 7_000n,
          isChop: false,
          participants: [
            {
              playerId: "short",
              totalBetHandMojos: 1_000n,
              stackBeforePayoutMojos: 0n,
              awardedMojos: 3_000n,
            },
            {
              playerId: "mid",
              totalBetHandMojos: 3_000n,
              stackBeforePayoutMojos: 0n,
              awardedMojos: 4_000n,
            },
            {
              playerId: "deep",
              totalBetHandMojos: 3_000n,
              stackBeforePayoutMojos: 0n,
              awardedMojos: 0n,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("audits history stack deltas", () => {
    const issues = auditHistoryStacks({
      totalPotMojos: 9_840n,
      potMojos: 4_920n,
      winnerId: "you",
      isChop: true,
      participants: [
        { playerId: "you", stackBeforePayoutMojos: 0n, stackAfterMojos: 4_920n },
        { playerId: "house", stackBeforePayoutMojos: 4_160n, stackAfterMojos: 9_080n },
      ],
    });
    expect(issues).toEqual([]);
  });
});
