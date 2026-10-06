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

/** True when more than one player received a positive pot award (split pot). */
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
