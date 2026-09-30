/** Occupied seats for the next deal (stack > 0 preferred; fall back to all seated). */
export function occupiedSeatIndexes(
  seats: Array<{ seatIndex: number; stackMojos?: string }>,
): number[] {
  const withChips = seats.filter((s) => {
    try {
      return BigInt(s.stackMojos ?? "0") > 0n;
    } catch {
      return true;
    }
  });
  const source = withChips.length >= 2 ? withChips : seats;
  return [...new Set(source.map((s) => s.seatIndex))].sort((a, b) => a - b);
}

function nextOccupiedClockwise(seats: number[], fromSeat: number, maxSeats: number): number {
  let seat = fromSeat;
  for (let step = 0; step < maxSeats; step++) {
    seat = (seat + 1) % maxSeats;
    if (seats.includes(seat)) return seat;
  }
  return fromSeat;
}

export type NextHandBlindSeats = {
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
};

/**
 * Mirror engine postBlinds: HU dealer posts SB; multiway SB/BB are clockwise of D.
 */
export function nextHandBlindSeats(params: {
  dealerButtonSeat: number | null;
  occupiedSeats: number[];
  maxSeats: number;
}): NextHandBlindSeats | null {
  const { dealerButtonSeat, occupiedSeats, maxSeats } = params;
  if (dealerButtonSeat == null || occupiedSeats.length < 2 || maxSeats < 2) return null;

  const seats = [...occupiedSeats].sort((a, b) => a - b);
  const dealerSeat = seats.includes(dealerButtonSeat)
    ? dealerButtonSeat
    : nextOccupiedClockwise(seats, dealerButtonSeat, maxSeats);

  let smallBlindSeat: number;
  let bigBlindSeat: number;
  if (seats.length === 2) {
    smallBlindSeat = dealerSeat;
    bigBlindSeat = nextOccupiedClockwise(seats, dealerSeat, maxSeats);
  } else {
    smallBlindSeat = nextOccupiedClockwise(seats, dealerSeat, maxSeats);
    bigBlindSeat = nextOccupiedClockwise(seats, smallBlindSeat, maxSeats);
  }

  return { dealerSeat, smallBlindSeat, bigBlindSeat };
}
