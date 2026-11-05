import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LedgerEventType =
  | "redeem"
  | "buy_in"
  | "buy_in_refund"
  | "cash_out"
  | "withdraw_sage"
  | "prize"
  | "table_return"
  | "credit"
  | "debit";

export interface LedgerEvent {
  id: string;
  atMs: number;
  playerId: string;
  type: LedgerEventType;
  deltaMojos: string;
  balanceAfterMojos: string;
  ref?: string;
}

export interface LedgerEventMeta {
  type: LedgerEventType;
  ref?: string;
}

const MAX_EVENTS = 500;
const events: LedgerEvent[] = [];
let seq = 0;

function journalPath(): string | null {
  const raw = process.env.DAT_LEDGER_JOURNAL_PATH?.trim();
  if (!raw || raw === "off" || raw === "memory") return null;
  return resolve(raw);
}

async function appendJournalLog(event: LedgerEvent): Promise<void> {
  const path = journalPath();
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error("[ledger-journal] failed to append", err);
  }
}

export function recordLedgerEvent(
  playerId: string,
  deltaMojos: bigint,
  balanceAfterMojos: bigint,
  meta: LedgerEventMeta,
): LedgerEvent {
  seq += 1;
  const event: LedgerEvent = {
    id: `le_${Date.now().toString(36)}_${seq}`,
    atMs: Date.now(),
    playerId,
    type: meta.type,
    deltaMojos: deltaMojos.toString(),
    balanceAfterMojos: balanceAfterMojos.toString(),
    ...(meta.ref ? { ref: meta.ref } : {}),
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  void appendJournalLog(event);
  return event;
}

export function getLedgerEventsForPlayer(playerId: string, limit = 40): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const event of events) {
    if (event.playerId !== playerId) continue;
    out.push(event);
    if (out.length >= limit) break;
  }
  return out;
}

export function resetLedgerJournalForTests(): void {
  events.length = 0;
  seq = 0;
}
