import { describe, expect, it } from "vitest";
import {
  nextHandBlindSeats,
  occupiedSeatIndexes,
  seatAngleRadians,
  seatsClockwiseFromDealer,
  seatsInTableOrder,
} from "./next-hand-blinds.js";

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

describe("seatsInTableOrder", () => {
  it("keeps ascending seat order so players do not rotate with the button", () => {
    expect(seatsInTableOrder([4, 0, 2, 1])).toEqual([0, 1, 2, 4]);
  });
});

describe("seatAngleRadians", () => {
  it("places seat 0 at the top and walks clockwise by seat index", () => {
    expect(seatAngleRadians(0, 6)).toBeCloseTo(-Math.PI / 2);
    expect(seatAngleRadians(3, 6)).toBeCloseTo(Math.PI / 2);
  });

  it("is stable for a seat when the dealer button moves", () => {
    const a = seatAngleRadians(2, 9);
    const b = seatAngleRadians(2, 9);
    expect(a).toBe(b);
  });
});

describe("seatsClockwiseFromDealer", () => {
  it("starts at the dealer and walks ascending seat numbers around the ring", () => {
    expect(seatsClockwiseFromDealer([0, 1, 2, 4], 1)).toEqual([1, 2, 4, 0]);
  });

  it("heads-up starts at dealer then the other seat", () => {
    expect(seatsClockwiseFromDealer([0, 3], 3)).toEqual([3, 0]);
  });
});
