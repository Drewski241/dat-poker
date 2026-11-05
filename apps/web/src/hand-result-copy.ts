/** Award credited at showdown/fold settlement (stack after − stack before payout). */
export function participantAwardMojos(p: {
  stackBeforePayoutMojos: string;
  stackAfterMojos: string;
}): bigint {
  try {
    return BigInt(p.stackAfterMojos) - BigInt(p.stackBeforePayoutMojos);
  } catch {
    return 0n;
  }
}

/**
 * True when more than one player received chips. Side-pot hands also match —
 * do not use this alone to label a chop; prefer `HandResult.isChop` from the engine.
 */
export function isChopFromParticipants(
  participants: Array<{ stackBeforePayoutMojos: string; stackAfterMojos: string }>,
): boolean {
  let winners = 0;
  for (const p of participants) {
    if (participantAwardMojos(p) > 0n) winners += 1;
    if (winners > 1) return true;
  }
  return false;
}

export function totalPotFromParticipants(
  participants: Array<{ stackBeforePayoutMojos: string; stackAfterMojos: string }>,
): bigint {
  return participants.reduce((sum, p) => sum + participantAwardMojos(p), 0n);
}
