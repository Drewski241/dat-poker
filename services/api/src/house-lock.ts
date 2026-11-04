import {
  HouseTreasuryBook,
  InsufficientHouseBankrollError,
  type HouseLockSnapshot,
} from "@dat-poker/chia-bridge";

export interface HouseLockView {
  configured: boolean;
  spendableMojos: string;
  lockedMojos: string;
  availableMojos: string;
  tableLockedMojos: string | null;
}

let book: HouseTreasuryBook | null = null;

export function resetHouseTreasuryForTests(): void {
  book = null;
}

export function treasuryServiceBaseUrl(): string | null {
  const payout = process.env.DAT_TREASURY_PAYOUT_URL?.trim();
  if (!payout) return null;
  return payout.replace(/\/payout\/?$/, "");
}

function bankrollMojos(): bigint | null {
  const raw = process.env.DAT_TREASURY_BANKROLL_MOJOS?.trim();
  if (!raw) return null;
  return BigInt(raw);
}

function localBook(): HouseTreasuryBook | null {
  const bankroll = bankrollMojos();
  if (bankroll == null) return null;
  if (!book) book = new HouseTreasuryBook(bankroll);
  return book;
}

export function houseLockConfigured(): boolean {
  return Boolean(treasuryServiceBaseUrl() || bankrollMojos());
}

function toView(snapshot: HouseLockSnapshot | null, tableId?: string): HouseLockView {
  if (!snapshot) {
    return {
      configured: false,
      spendableMojos: "0",
      lockedMojos: "0",
      availableMojos: "0",
      tableLockedMojos: null,
    };
  }
  return {
    configured: true,
    spendableMojos: snapshot.spendableMojos.toString(),
    lockedMojos: snapshot.lockedMojos.toString(),
    availableMojos: snapshot.availableMojos.toString(),
    tableLockedMojos:
      tableId === undefined || snapshot.tableLockedMojos == null
        ? null
        : snapshot.tableLockedMojos.toString(),
  };
}

async function remoteJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(
      `DAT treasury is unreachable, so the house buy-in cannot be locked (${(e as Error).message}).`,
    );
  }
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Treasury lock failed (${res.status})`);
  }
  return body;
}

export async function houseLockView(tableId?: string): Promise<HouseLockView> {
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    const query = tableId ? `?tableId=${encodeURIComponent(tableId)}` : "";
    const body = await remoteJson<HouseLockView>(`${remote}/locks${query}`);
    return { ...body, configured: true };
  }
  const local = localBook();
  if (!local) return toView(null);
  return toView(local.snapshot(tableId), tableId);
}

/** Reserve the house buy-in. Returns null when dev mode has no treasury configured. */
export async function lockHouseBuyIn(tableId: string, amount: bigint): Promise<HouseLockSnapshot | null> {
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    const body = await remoteJson<{
      spendableMojos: string;
      lockedMojos: string;
      availableMojos: string;
      tableLockedMojos: string | null;
    }>(`${remote}/locks`, {
      method: "POST",
      body: JSON.stringify({ tableId, amountMojos: amount.toString() }),
    });
    return {
      spendableMojos: BigInt(body.spendableMojos),
      lockedMojos: BigInt(body.lockedMojos),
      availableMojos: BigInt(body.availableMojos),
      tableLockedMojos: body.tableLockedMojos == null ? null : BigInt(body.tableLockedMojos),
    };
  }

  const local = localBook();
  if (!local) {
    if (process.env.DAT_ALLOW_DEV_BUYIN === "true") return null;
    throw new Error(
      "House buy-in cannot be locked. Set DAT_TREASURY_BANKROLL_MOJOS or DAT_TREASURY_PAYOUT_URL to the DAT treasury.",
    );
  }
  return local.lock(tableId, amount);
}

/** Drop the table reservation. `spentMojos` already left the treasury as a tester payout. */
export async function settleHouseTable(tableId: string, spentMojos: bigint): Promise<void> {
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    await remoteJson(`${remote}/locks/settle`, {
      method: "POST",
      body: JSON.stringify({ tableId, spentMojos: spentMojos.toString() }),
    });
    return;
  }
  const local = localBook();
  if (!local) return;
  const existing = local.snapshot(tableId).tableLockedMojos;
  if (existing == null && spentMojos === 0n) return;
  local.consume(tableId, spentMojos, false);
  local.release(tableId);
}

export { InsufficientHouseBankrollError };
