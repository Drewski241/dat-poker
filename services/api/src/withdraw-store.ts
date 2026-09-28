import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface WithdrawalRecord {
  withdrawalId: string;
  tableId: string;
  playerId: string;
  stackMojos: string;
  originalBuyInMojos: string;
  payoutMojos: string;
  mode: "ledger" | "offer";
  offer?: string;
  createdAt: string;
  /** Set when the client reports Sage accepted the offer (or ledger-only). */
  completedAt?: string;
}

const withdrawals = new Map<string, WithdrawalRecord>();
/** Latest open offer withdraw per player (for UI recovery after refresh). */
const pendingByPlayer = new Map<string, WithdrawalRecord>();
let loaded = false;

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultWithdrawalsPath(): string {
  return resolve(__dirname, "../../../data/withdrawals.json");
}

function withdrawalsPath(): string | null {
  const raw = process.env.DAT_WITHDRAWALS_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return defaultWithdrawalsPath();
}

function withdrawalKey(tableId: string, playerId: string): string {
  return `${tableId}:${playerId}`;
}

function persist(): void {
  const path = withdrawalsPath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(
    {
      withdrawals: [...withdrawals.values()],
      pending: [...pendingByPlayer.values()],
    },
    null,
    2,
  );
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

export function loadWithdrawals(): void {
  if (loaded) return;
  loaded = true;
  const path = withdrawalsPath();
  if (!path) return;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as {
      withdrawals?: WithdrawalRecord[];
      pending?: WithdrawalRecord[];
    };
    for (const row of parsed.withdrawals ?? []) {
      withdrawals.set(withdrawalKey(row.tableId, row.playerId), row);
    }
    for (const row of parsed.pending ?? []) {
      if (row.offer && !row.completedAt) {
        pendingByPlayer.set(row.playerId, row);
      }
    }
  } catch {
    /* first run */
  }
}

export function hasWithdrawal(tableId: string, playerId: string): boolean {
  loadWithdrawals();
  return withdrawals.has(withdrawalKey(tableId, playerId));
}

export function recordWithdrawal(record: WithdrawalRecord): void {
  loadWithdrawals();
  withdrawals.set(withdrawalKey(record.tableId, record.playerId), record);
  if (record.mode === "offer" && record.offer && !record.completedAt) {
    pendingByPlayer.set(record.playerId, record);
  }
  persist();
}

export function getWithdrawal(tableId: string, playerId: string): WithdrawalRecord | undefined {
  loadWithdrawals();
  return withdrawals.get(withdrawalKey(tableId, playerId));
}

export function getPendingWithdrawOffer(playerId: string): WithdrawalRecord | undefined {
  loadWithdrawals();
  const row = pendingByPlayer.get(playerId);
  if (!row || !row.offer || row.completedAt) return undefined;
  return row;
}

export function markWithdrawOfferCompleted(playerId: string, withdrawalId?: string): boolean {
  loadWithdrawals();
  const row = pendingByPlayer.get(playerId);
  if (!row) return false;
  if (withdrawalId && row.withdrawalId !== withdrawalId) return false;
  row.completedAt = new Date().toISOString();
  pendingByPlayer.delete(playerId);
  withdrawals.set(withdrawalKey(row.tableId, row.playerId), row);
  persist();
  return true;
}

export function resetWithdrawalsForTests(): void {
  withdrawals.clear();
  pendingByPlayer.clear();
  loaded = true;
}
