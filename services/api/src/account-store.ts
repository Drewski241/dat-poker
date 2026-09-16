import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CAT_MOJOS_PER_TOKEN, playthroughHandsRequired, utcDateKey } from "@dat-poker/shared";

const balances = new Map<string, bigint>();
const redeemedUtcDay = new Map<string, string>();
const playthrough = new Map<string, { poolMojos: bigint; handsPlayed: number }>();
let loaded = false;

export interface PlaythroughState {
  poolMojos: bigint;
  handsPlayed: number;
}

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
      playthrough: [...playthrough.entries()].map(([playerId, row]) => ({
        playerId,
        poolMojos: row.poolMojos.toString(),
        handsPlayed: row.handsPlayed,
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
      playthrough?: { playerId?: string; poolMojos?: string; handsPlayed?: number }[];
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
    for (const row of parsed.playthrough ?? []) {
      if (!row.playerId) continue;
      try {
        const poolMojos = BigInt(row.poolMojos ?? "0");
        const handsPlayed = Math.max(0, Math.floor(Number(row.handsPlayed ?? 0)));
        if (poolMojos > 0n) {
          playthrough.set(row.playerId, { poolMojos, handsPlayed });
        }
      } catch {
        /* skip bad row */
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

export function getPlaythrough(playerId: string): PlaythroughState {
  loadLedger();
  return playthrough.get(playerId) ?? { poolMojos: 0n, handsPlayed: 0 };
}

function writePlaythrough(playerId: string, poolMojos: bigint, handsPlayed: number): void {
  if (poolMojos <= 0n) {
    playthrough.delete(playerId);
    persist();
    return;
  }
  const required = playthroughHandsRequired(poolMojos);
  const hands = Math.max(0, Math.min(Math.floor(handsPlayed), required || Math.floor(handsPlayed)));
  playthrough.set(playerId, { poolMojos, handsPlayed: hands });
  persist();
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Buy-in from the in-game account reuses DAT that is already in the play-through
 * pool (so a redeploy + rejoin does not add a second 1000-hand lock). Fresh DAT
 * (faucet or wallet) is added to the pool.
 */
export function applyBuyInPlaythrough(
  playerId: string,
  buyInMojos: bigint,
  fromAccount: boolean,
): { addedFreshMojos: bigint } {
  loadLedger();
  if (buyInMojos <= 0n) {
    return { addedFreshMojos: 0n };
  }
  let fresh = buyInMojos;
  if (fromAccount) {
    const pt = getPlaythrough(playerId);
    const returning = minBig(buyInMojos, minBig(getAccountBalance(playerId), pt.poolMojos));
    fresh = buyInMojos - returning;
  }
  if (fresh > 0n) {
    const pt = getPlaythrough(playerId);
    writePlaythrough(playerId, pt.poolMojos + fresh, pt.handsPlayed);
  }
  return { addedFreshMojos: fresh };
}

export function reducePlaythroughPool(playerId: string, amount: bigint): void {
  loadLedger();
  if (amount <= 0n) return;
  const pt = getPlaythrough(playerId);
  const nextPool = pt.poolMojos > amount ? pt.poolMojos - amount : 0n;
  writePlaythrough(playerId, nextPool, pt.handsPlayed);
}

export function setPlaythroughHands(playerId: string, handsPlayed: number): void {
  loadLedger();
  const pt = getPlaythrough(playerId);
  writePlaythrough(playerId, pt.poolMojos, handsPlayed);
}

/** Drop obligation that exceeds chips the player still holds (lost pots). */
export function syncPlaythroughHeld(playerId: string, heldMojos: bigint): void {
  loadLedger();
  const pt = getPlaythrough(playerId);
  if (pt.poolMojos <= heldMojos) return;
  writePlaythrough(playerId, heldMojos < 0n ? 0n : heldMojos, pt.handsPlayed);
}

/** Spend unlocked DAT that left the in-game ledger (Sage withdraw). */
export function consumePlaythroughWithdraw(playerId: string, withdrawMojos: bigint): void {
  loadLedger();
  if (withdrawMojos <= 0n) return;
  const pt = getPlaythrough(playerId);
  if (withdrawMojos > pt.poolMojos) {
    throw new Error("Withdraw exceeds play-through pool");
  }
  const consumedHands = Number(withdrawMojos / CAT_MOJOS_PER_TOKEN);
  writePlaythrough(playerId, pt.poolMojos - withdrawMojos, pt.handsPlayed - consumedHands);
}

export function clearPlaythrough(playerId: string): void {
  loadLedger();
  playthrough.delete(playerId);
  persist();
}

/** Test helper — not used in production routes. */
export function resetAccountsForTests(): void {
  balances.clear();
  redeemedUtcDay.clear();
  playthrough.clear();
  loaded = true;
}

/** Test helper — drop memory and read the current DAT_LEDGER_PATH file again. */
export function reloadLedgerFromDiskForTests(): void {
  balances.clear();
  redeemedUtcDay.clear();
  playthrough.clear();
  loaded = false;
  loadLedger();
}
