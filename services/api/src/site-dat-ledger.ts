const balances = new Map<string, bigint>();
const redeemed = new Map<string, bigint>();
const usedNonces = new Set<string>();

export function resetSiteDatLedger(): void {
  balances.clear();
  redeemed.clear();
  usedNonces.clear();
}

export function getSiteDatBalance(address: string): bigint {
  return balances.get(address) ?? 0n;
}

export function getSiteDatRedeemed(address: string): bigint {
  return redeemed.get(address) ?? 0n;
}

export function creditSiteDat(address: string, amount: bigint): bigint {
  if (amount <= 0n) throw new Error("Credit must be positive");
  const next = getSiteDatBalance(address) + amount;
  balances.set(address, next);
  return next;
}

export function debitSiteDat(address: string, amount: bigint): bigint {
  if (amount <= 0n) throw new Error("Debit must be positive");
  const current = getSiteDatBalance(address);
  if (current < amount) {
    throw new Error("Insufficient site DAT balance");
  }
  const next = current - amount;
  if (next === 0n) balances.delete(address);
  else balances.set(address, next);
  return next;
}

export function assertRedeemAllowed(params: {
  address: string;
  amount: bigint;
  nonce: string;
  maxMojos: bigint;
  capMojos: bigint;
}): void {
  if (params.amount <= 0n) throw new Error("Redeem amount must be positive");
  if (params.amount > params.maxMojos) {
    throw new Error(`Redeem exceeds the per-call maximum of ${params.maxMojos.toString()} mojos`);
  }
  const key = `${params.address}:${params.nonce}`;
  if (usedNonces.has(key)) throw new Error("Redeem nonce already used");
  const total = getSiteDatRedeemed(params.address) + params.amount;
  if (total > params.capMojos) {
    throw new Error(`Redeem exceeds the address cap of ${params.capMojos.toString()} mojos`);
  }
}

export function commitRedeem(address: string, amount: bigint, nonce: string): bigint {
  usedNonces.add(`${address}:${nonce}`);
  redeemed.set(address, getSiteDatRedeemed(address) + amount);
  return creditSiteDat(address, amount);
}
