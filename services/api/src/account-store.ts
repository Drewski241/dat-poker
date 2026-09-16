import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { utcDateKey } from "@dat-poker/shared";

const balances = new Map<string, bigint>();
const redeemedUtcDay = new Map<string, string>();
let loaded = false;

function ledgerPath(): string | null {
  const raw = process.env.DAT_LEDGER_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(process.cwd(), "data/ledger.json");
}

function persist(): void {
  const path = ledgerPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(
    {
      balances: [...balances.entries()].map(([playerId, mojos]) => ({
        playerId,
        balanceMojos: mojos.toString(),
      })),
      redeemed: [...redeemedUtcDay.entries()].map(([playerId, utcDay]) => ({
        playerId,
        utcDay,
      })),
    },
    null,
    2,
  );
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

export function loadLedger(): void {
  if (loaded) return;
  loaded = true;
  const path = ledgerPath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      balances?: { playerId?: string; balanceMojos?: string }[];
      redeemed?: { playerId?: string; utcDay?: string }[];
    };
    for (const row of parsed.balances ?? []) {
      if (!row.playerId) continue;
      try {
        balances.set(row.playerId, BigInt(row.balanceMojos ?? "0"));
      } catch {
        /* skip bad row */
      }
    }
    for (const row of parsed.redeemed ?? []) {
      if (row.playerId && row.utcDay) {
        redeemedUtcDay.set(row.playerId, row.utcDay);
      }
    }
  } catch {
    /* first run — file is created on credit */
  }
}

export function getAccountBalance(address: string): bigint {
  loadLedger();
  return balances.get(address) ?? 0n;
}

export function creditAccount(address: string, amount: bigint): bigint {
  loadLedger();
  if (amount < 0n) {
    throw new Error("credit must be non-negative");
  }
  const next = getAccountBalance(address) + amount;
  balances.set(address, next);
  persist();
  return next;
}

export function debitAccount(address: string, amount: bigint): bigint {
  loadLedger();
  const current = getAccountBalance(address);
  if (amount > current) {
    throw new Error("Insufficient account DAT");
  }
  const next = current - amount;
  balances.set(address, next);
  persist();
  return next;
}

export function redeemKey(address: string, now = new Date()): string {
  return `${address}:${utcDateKey(now)}`;
}

export function hasRedeemedToday(address: string, now = new Date()): boolean {
  loadLedger();
  return redeemedUtcDay.get(address) === utcDateKey(now);
}

export function tryRedeemDaily(
  address: string,
  amount: bigint,
  now = new Date(),
): { credited: boolean; balance: bigint; alreadyRedeemed: boolean } {
  loadLedger();
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
  loaded = true;
}

/** Test helper — drop memory and read the current DAT_LEDGER_PATH file again. */
export function reloadLedgerFromDiskForTests(): void {
  balances.clear();
  redeemedUtcDay.clear();
  loaded = false;
  loadLedger();
}
