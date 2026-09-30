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

/**
 * Fixed ring order by ascending seat index (players stay put; D/SB/BB labels move).
 */
export function seatsInTableOrder(occupiedSeats: number[]): number[] {
  return [...new Set(occupiedSeats)].sort((a, b) => a - b);
}

/**
 * Angle on the between-hands ellipse for a seat index.
 * Seat 0 is at the top; higher seats walk clockwise. Positions are stable
 * across hands so only role chips move with the button.
 */
export function seatAngleRadians(seatIndex: number, maxSeats: number): number {
  const n = Math.max(1, maxSeats);
  const i = ((seatIndex % n) + n) % n;
  return (i / n) * 2 * Math.PI - Math.PI / 2;
}

/** @deprecated Prefer seatsInTableOrder — dealer-relative order moved players each hand. */
export function seatsClockwiseFromDealer(
  occupiedSeats: number[],
  dealerSeat: number | null,
): number[] {
  const seats = seatsInTableOrder(occupiedSeats);
  if (seats.length === 0) return [];
  const start =
    dealerSeat != null && seats.includes(dealerSeat) ? dealerSeat : seats[0]!;
  const idx = seats.indexOf(start);
  if (idx < 0) return seats;
  return [...seats.slice(idx), ...seats.slice(0, idx)];
}
