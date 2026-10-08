/** Players who can actually be dealt in (not sitting out, stack > 0). */
export function countActiveDealSeats(
  seats: { sittingOut?: boolean; stackMojos: string }[],
): number {
  return seats.filter((s) => {
    if (s.sittingOut) return false;
    try {
      return BigInt(s.stackMojos) > 0n;
    } catch {
      return false;
    }
  }).length;
}

export function shouldAutoDealNextHand(input: {
  atTableRoom: boolean;
  tableFormat: string | null | undefined;
  sngStatus: string | null | undefined;
  seated: boolean;
  /** Active players eligible for the next deal (not raw seat count). */
  occupiedSeats: number;
  handLive: boolean;
  busy: boolean;
  stackIsZero: boolean;
  runoutPlaying: boolean;
  celebrationPlaying?: boolean;
  eliminated: boolean;
  pauseDeals?: boolean;
  /** Cash: player chose Sit out — leave the table seated but stop dealing. */
  sittingOut?: boolean;
}): boolean {
  if (
    !input.atTableRoom ||
    !input.seated ||
    input.occupiedSeats < 2 ||
    input.handLive ||
    input.busy ||
    input.stackIsZero ||
    input.runoutPlaying ||
    input.celebrationPlaying
  ) {
    return false;
  }

  if (input.tableFormat === "cash") {
    if (input.sittingOut) return false;
    return true;
  }

  return Boolean(
    (input.tableFormat === "sng" || input.tableFormat === "mtt") &&
      input.sngStatus === "running" &&
      !input.eliminated &&
      !input.pauseDeals,
  );
}

/** @deprecated Use shouldAutoDealNextHand */
export function sngShouldAutoDeal(
  input: Parameters<typeof shouldAutoDealNextHand>[0] & { occupiedSeats?: number },
): boolean {
  return shouldAutoDealNextHand({
    ...input,
    occupiedSeats: input.occupiedSeats ?? 2,
  });
}
