export interface NlheBetRange {
  minRaiseTo: bigint;
  maxRaiseTo: bigint;
  isOpeningBet: boolean;
  canBetOrRaise: boolean;
}

export type BettingStructure = "no-limit" | "pot-limit" | "fixed-limit";

/**
 * Pot-limit max raise-to: after calling the current bet, you may raise by at most
 * the size of the pot (including that call). Equals `pot + currentBet + toCall`.
 */
export function potLimitMaxRaiseTo(params: {
  potMojos: bigint;
  currentBetMojos: bigint;
  myBetThisStreetMojos: bigint;
}): bigint {
  const toCall =
    params.currentBetMojos > params.myBetThisStreetMojos
      ? params.currentBetMojos - params.myBetThisStreetMojos
      : 0n;
  return params.potMojos + params.currentBetMojos + toCall;
}

/** NLHE raise-to range for a slider (min legal bet/raise through all-in). */
export function computeNlheBetRange(params: {
  bigBlindMojos: bigint;
  currentBetMojos: bigint;
  myBetThisStreetMojos: bigint;
  myStackMojos: bigint;
  /** Last bet/raise increment on this street; defaults to BB. */
  lastRaiseIncrementMojos?: bigint;
  /** Included chips already in the pot (for pot-limit caps). */
  potMojos?: bigint;
  bettingStructure?: BettingStructure;
}): NlheBetRange {
  const { bigBlindMojos, currentBetMojos, myBetThisStreetMojos, myStackMojos } = params;
  const lastRaiseIncrementMojos = params.lastRaiseIncrementMojos ?? bigBlindMojos;
  let maxRaiseTo = myBetThisStreetMojos + myStackMojos;

  if (
    params.bettingStructure === "pot-limit" &&
    params.potMojos != null &&
    params.potMojos >= 0n
  ) {
    const potMax = potLimitMaxRaiseTo({
      potMojos: params.potMojos,
      currentBetMojos,
      myBetThisStreetMojos,
    });
    if (potMax < maxRaiseTo) maxRaiseTo = potMax;
  }

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

  const minRaiseToRaw = currentBetMojos + lastRaiseIncrementMojos;
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

/** Quick bet chips: 1×–4× BB, clipped to the legal raise-to range. */
export function betSizePresets(
  bigBlindMojos: bigint,
  minRaiseTo: bigint,
  maxRaiseTo: bigint,
): bigint[] {
  if (bigBlindMojos <= 0n) return [];
  const presets: bigint[] = [];
  for (const n of [1n, 2n, 3n, 4n]) {
    const amount = bigBlindMojos * n;
    if (amount >= minRaiseTo && amount <= maxRaiseTo) {
      presets.push(amount);
    }
  }
  return presets;
}
