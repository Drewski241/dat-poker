/** Chips still on the table count as the player's until the hand settles. */
export function sessionResultMojos(sessionStartMojos: bigint, stackMojos: bigint, outstandingMojos: bigint): bigint {
  return stackMojos + outstandingMojos - sessionStartMojos;
}

/** How much more can be wagered before the next loss would pass the limit. Null means no limit. */
export function lossRoomMojos(
  sessionStartMojos: bigint,
  stackMojos: bigint,
  outstandingMojos: bigint,
  lossLimitMojos: bigint | null,
): bigint | null {
  if (lossLimitMojos == null) return null;
  const committed = stackMojos + outstandingMojos;
  const down = sessionStartMojos > committed ? sessionStartMojos - committed : 0n;
  const room = lossLimitMojos - down - outstandingMojos;
  return room > 0n ? room : 0n;
}

export function sessionLimitReached(sessionStartMojos: bigint, stackMojos: bigint, lossLimitMojos: bigint | null): boolean {
  if (lossLimitMojos == null) return false;
  const down = sessionStartMojos > stackMojos ? sessionStartMojos - stackMojos : 0n;
  return down >= lossLimitMojos;
}

export function assertSessionWager(params: {
  sessionStartMojos: bigint;
  stackMojos: bigint;
  outstandingMojos: bigint;
  wagerMojos: bigint;
  lossLimitMojos: bigint | null;
}): void {
  const room = lossRoomMojos(
    params.sessionStartMojos,
    params.stackMojos,
    params.outstandingMojos,
    params.lossLimitMojos,
  );
  if (room == null) return;
  if (params.outstandingMojos === 0n && room === 0n) {
    throw new Error("Session limit reached");
  }
  if (params.wagerMojos > room) {
    throw new Error("That bet would pass your session limit");
  }
}
