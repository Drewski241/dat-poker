export interface NlheBetRange {
  minRaiseTo: bigint;
  maxRaiseTo: bigint;
  isOpeningBet: boolean;
  canBetOrRaise: boolean;
}

/** NLHE raise-to range for a slider (min legal bet/raise through all-in). */
export function computeNlheBetRange(params: {
  bigBlindMojos: bigint;
  currentBetMojos: bigint;
  myBetThisStreetMojos: bigint;
  myStackMojos: bigint;
}): NlheBetRange {
  const { bigBlindMojos, currentBetMojos, myBetThisStreetMojos, myStackMojos } = params;
  const maxRaiseTo = myBetThisStreetMojos + myStackMojos;

  if (myStackMojos <= 0n || maxRaiseTo <= 0n) {
    return {
      minRaiseTo: 0n,
      maxRaiseTo: 0n,
      isOpeningBet: currentBetMojos === 0n,
      canBetOrRaise: false,
    };
  }

  if (currentBetMojos === 0n) {
    const minRaiseTo = bigBlindMojos > maxRaiseTo ? maxRaiseTo : bigBlindMojos;
    return {
      minRaiseTo,
      maxRaiseTo,
      isOpeningBet: true,
      canBetOrRaise: maxRaiseTo >= minRaiseTo,
    };
  }

  const minRaiseToRaw = currentBetMojos + bigBlindMojos;
  const minRaiseTo = minRaiseToRaw > maxRaiseTo ? maxRaiseTo : minRaiseToRaw;

  return {
    minRaiseTo,
    maxRaiseTo,
    isOpeningBet: false,
    canBetOrRaise: maxRaiseTo > currentBetMojos && maxRaiseTo >= minRaiseTo,
  };
}

/** Snap a raise-to amount to big-blind steps within [min, max]. */
export function snapRaiseTo(raw: bigint, min: bigint, max: bigint, step: bigint): bigint {
  if (raw <= min) return min;
  if (raw >= max) return max;
  const steps = (raw - min) / step;
  return min + steps * step;
}
