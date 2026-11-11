import { describe, expect, it } from "vitest";
import { nextClockwise, settlePots, type PotContestant } from "./pot-settle.js";

function player(
  playerId: string,
  seatIndex: number,
  contributed: bigint,
  handScore: number,
  folded = false,
): PotContestant {
  return { playerId, seatIndex, contributed, handScore, folded };
}

describe("settlePots", () => {
  it("gives a folded pot to the last player", () => {
    const payouts = settlePots(
      [
        player("alice", 0, 100n, 0, true),
        player("bob", 1, 100n, 1),
      ],
      0,
    );
    expect(payouts).toEqual([{ playerId: "bob", amountMojos: 200n }]);
  });

  it("awards the showdown to the best hand", () => {
    const payouts = settlePots(
      [
        player("alice", 0, 100n, 2),
        player("bob", 1, 100n, 5),
        player("cara", 2, 100n, 3),
      ],
      0,
    );
    expect(payouts).toEqual([{ playerId: "bob", amountMojos: 300n }]);
  });

  it("splits a tie and gives the odd chip to the seat left of the button", () => {
    const payouts = settlePots(
      [
        player("alice", 1, 5n, 4),
        player("bob", 3, 5n, 4),
        player("cara", 4, 1n, 9, true),
      ],
      0,
    );
    const byId = Object.fromEntries(payouts.map((payout) => [payout.playerId, payout.amountMojos]));
    expect(byId.alice).toBe(6n);
    expect(byId.bob).toBe(5n);
    expect((byId.alice ?? 0n) + (byId.bob ?? 0n)).toBe(11n);
  });

  it("keeps a side pot away from the short all-in", () => {
    const payouts = settlePots(
      [
        player("short", 0, 50n, 9),
        player("big", 1, 200n, 1),
        player("other", 2, 200n, 3),
      ],
      0,
    );
    const byId = Object.fromEntries(payouts.map((payout) => [payout.playerId, payout.amountMojos]));
    expect(byId.short).toBe(150n);
    expect(byId.other).toBe(300n);
    expect(byId.big).toBeUndefined();
    expect((byId.short ?? 0n) + (byId.other ?? 0n)).toBe(450n);
  });
});

describe("nextClockwise", () => {
  it("wraps from the last seat to the first", () => {
    expect(nextClockwise([0, 2, 5], 5)).toBe(0);
    expect(nextClockwise([0, 2, 5], 0)).toBe(2);
    expect(nextClockwise([1, 4], -1)).toBe(1);
  });
});
