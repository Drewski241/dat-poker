import { randomUUID } from "node:crypto";
import {
  SLOTS_DEFAULT_BET_PER_LINE_MOJOS,
  SLOTS_STARTING_BANKROLL_MOJOS,
  cryptoSpinRng,
  isAllowedBetPerLine,
  spinSlots,
  type SlotSpin,
  type SpinRng,
} from "@dat-poker/game-engine";

export interface SlotsAccount {
  playerId: string;
  displayName: string;
  bankrollMojos: bigint;
}

export type SlotsFailure = { ok: false; status: number; error: string };

const accounts = new Map<string, SlotsAccount>();

export function resetSlotsAccounts(): void {
  accounts.clear();
}

export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return null;
  if (!/^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(name)) return null;
  return name;
}

export function getSlotsAccount(playerId: string): SlotsAccount | undefined {
  return accounts.get(playerId);
}

export function loginSlots(
  raw: unknown,
  startingBankroll = SLOTS_STARTING_BANKROLL_MOJOS,
): { ok: true; account: SlotsAccount } | SlotsFailure {
  const name = typeof raw === "string" ? normalizeDisplayName(raw) : null;
  if (!name) {
    return {
      ok: false,
      status: 400,
      error: "Enter a player name using 2–20 letters or numbers.",
    };
  }
  if (startingBankroll < 0n) {
    return { ok: false, status: 400, error: "Starting bankroll cannot be negative." };
  }
  const account: SlotsAccount = {
    playerId: `slots_${randomUUID()}`,
    displayName: name,
    bankrollMojos: startingBankroll,
  };
  accounts.set(account.playerId, account);
  return { ok: true, account };
}

export function spinSlotsAccount(
  playerId: string,
  betPerLineMojos: bigint,
  rng: SpinRng = cryptoSpinRng(),
): { ok: true; account: SlotsAccount; spin: SlotSpin } | SlotsFailure {
  const account = accounts.get(playerId);
  if (!account) {
    return { ok: false, status: 404, error: "Log in before you spin." };
  }
  if (!isAllowedBetPerLine(betPerLineMojos)) {
    return { ok: false, status: 400, error: "Pick one of the listed bets." };
  }
  const spin = spinSlots(betPerLineMojos, rng);
  if (account.bankrollMojos < spin.totalBetMojos) {
    return { ok: false, status: 400, error: "Demo bankroll is too low for that spin." };
  }
  account.bankrollMojos = account.bankrollMojos - spin.totalBetMojos + spin.payoutMojos;
  return { ok: true, account, spin };
}

export { SLOTS_DEFAULT_BET_PER_LINE_MOJOS };
