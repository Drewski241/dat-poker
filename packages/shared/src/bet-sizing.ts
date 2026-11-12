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

export interface PotLimitBetRange extends NlheBetRange {
  /** Minimum full raise before a short stack pulls it down. */
  fullMinRaiseTo: bigint;
}

/**
 * Pot-limit raise-to range.
 * An opening bet is at least a big blind and at most the pot.
 * A raise calls first, then adds at most the pot that call creates.
 */
export function computePotLimitBetRange(params: {
  bigBlindMojos: bigint;
  potMojos: bigint;
  currentBetMojos: bigint;
  myBetThisStreetMojos: bigint;
  myStackMojos: bigint;
  raiseIncrementMojos: bigint;
}): PotLimitBetRange {
  const {
    bigBlindMojos,
    potMojos,
    currentBetMojos,
    myBetThisStreetMojos,
    myStackMojos,
    raiseIncrementMojos,
  } = params;
  const stackTo = myBetThisStreetMojos + myStackMojos;
  const opening = currentBetMojos === 0n;
  const increment = raiseIncrementMojos > 0n ? raiseIncrementMojos : bigBlindMojos;
  const toCall = currentBetMojos > myBetThisStreetMojos ? currentBetMojos - myBetThisStreetMojos : 0n;

  let fullMin = opening ? bigBlindMojos : currentBetMojos + increment;
  let fullMax = opening ? (potMojos > bigBlindMojos ? potMojos : bigBlindMojos) : currentBetMojos + potMojos + toCall;
  if (fullMax < fullMin) fullMax = fullMin;

  if (myStackMojos <= 0n || stackTo <= currentBetMojos) {
    return {
      minRaiseTo: 0n,
      maxRaiseTo: 0n,
      fullMinRaiseTo: fullMin,
      isOpeningBet: opening,
      canBetOrRaise: false,
    };
  }

  const maxRaiseTo = fullMax > stackTo ? stackTo : fullMax;
  const minRaiseTo = fullMin > stackTo ? stackTo : fullMin;
  return {
    minRaiseTo,
    maxRaiseTo,
    fullMinRaiseTo: fullMin,
    isOpeningBet: opening,
    canBetOrRaise: stackTo >= fullMin && maxRaiseTo > currentBetMojos && maxRaiseTo >= fullMin,
  };
}

/** Snap a raise-to amount to big-blind steps within [min, max]. */
export function snapRaiseTo(raw: bigint, min: bigint, max: bigint, step: bigint): bigint {
  if (raw <= min) return min;
  if (raw >= max) return max;
  const steps = (raw - min) / step;
  return min + steps * step;
}
