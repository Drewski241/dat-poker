import { describe, expect, it } from "vitest";
import { nextHandBlindSeats, occupiedSeatIndexes } from "./next-hand-blinds.js";

describe("nextHandBlindSeats", () => {
  it("heads-up: dealer is SB, other seat is BB", () => {
    expect(
      nextHandBlindSeats({
        dealerButtonSeat: 0,
        occupiedSeats: [0, 1],
        maxSeats: 6,
      }),
    ).toEqual({ dealerSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1 });
  });

  it("multiway: SB and BB sit clockwise of the dealer", () => {
    expect(
      nextHandBlindSeats({
        dealerButtonSeat: 1,
        occupiedSeats: [0, 1, 2, 4],
        maxSeats: 6,
      }),
    ).toEqual({ dealerSeat: 1, smallBlindSeat: 2, bigBlindSeat: 4 });
  });

  it("skips empty seats when walking clockwise", () => {
    expect(
      nextHandBlindSeats({
        dealerButtonSeat: 0,
        occupiedSeats: [0, 3, 5],
        maxSeats: 6,
      }),
    ).toEqual({ dealerSeat: 0, smallBlindSeat: 3, bigBlindSeat: 5 });
  });
});

describe("occupiedSeatIndexes", () => {
  it("prefers seats with chips when at least two remain", () => {
    expect(
      occupiedSeatIndexes([
        { seatIndex: 0, stackMojos: "1000" },
        { seatIndex: 1, stackMojos: "0" },
        { seatIndex: 2, stackMojos: "500" },
      ]),
    ).toEqual([0, 2]);
  });
});
