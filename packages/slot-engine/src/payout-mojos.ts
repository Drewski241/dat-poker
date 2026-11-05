/**
 * Convert a line-stake payout into CAT mojos.
 *
 * `units` is often an integer line multiplier (Hold'em-style slots). Spirit
 * Stampede instead stores an integer numerator and a denominator (7, or 14
 * when the expanding-wild respin pays half). Mine Mojo cascade steps can
 * still be fractional (1.15×, 1.3×, …). BigInt rejects those floats —
 * `BigInt(60/7)` throws "The number 8.571428571428571 cannot be converted
 * to a BigInt because it is not an integer" — so non-integers are rounded
 * to thousandths of a line stake before the mojo multiply.
 */
export function payoutUnitsToMojos(units: number, lineBetMojos: bigint, denominator = 1): bigint {
  if (!Number.isFinite(units) || units <= 0 || lineBetMojos <= 0n) return 0n;
  const den =
    typeof denominator === "number" && Number.isInteger(denominator) && denominator > 0
      ? denominator
      : 1;
  if (Number.isSafeInteger(units)) {
    return (BigInt(units) * lineBetMojos) / BigInt(den);
  }
  const milli = Math.round((units / den) * 1000);
  if (!Number.isSafeInteger(milli) || milli <= 0) return 0n;
  return (BigInt(milli) * lineBetMojos) / 1000n;
}

/** Denominator stashed on a spin when the engine paid with integer numerators. */
export function payoutDenominatorOf(meta: Record<string, unknown> | undefined): number {
  const value = meta?.payoutDenominator;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return 1;
}
