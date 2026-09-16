import { utcDateKey } from "@dat-poker/shared";

const balances = new Map<string, bigint>();
const redeemedUtcDay = new Map<string, string>();

export function getAccountBalance(address: string): bigint {
  return balances.get(address) ?? 0n;
}

export function creditAccount(address: string, amount: bigint): bigint {
  if (amount < 0n) {
    throw new Error("credit must be non-negative");
  }
  const next = getAccountBalance(address) + amount;
  balances.set(address, next);
  return next;
}

export function debitAccount(address: string, amount: bigint): bigint {
  const current = getAccountBalance(address);
  if (amount > current) {
    throw new Error("Insufficient account DAT");
  }
  const next = current - amount;
  balances.set(address, next);
  return next;
}

export function redeemKey(address: string, now = new Date()): string {
  return `${address}:${utcDateKey(now)}`;
}

export function hasRedeemedToday(address: string, now = new Date()): boolean {
  return redeemedUtcDay.get(address) === utcDateKey(now);
}

export function tryRedeemDaily(
  address: string,
  amount: bigint,
  now = new Date(),
): { credited: boolean; balance: bigint; alreadyRedeemed: boolean } {
  if (hasRedeemedToday(address, now)) {
    return { credited: false, balance: getAccountBalance(address), alreadyRedeemed: true };
  }
  redeemedUtcDay.set(address, utcDateKey(now));
  const balance = creditAccount(address, amount);
  return { credited: true, balance, alreadyRedeemed: false };
}

/** Test helper — not used in production routes. */
export function resetAccountsForTests(): void {
  balances.clear();
  redeemedUtcDay.clear();
}
