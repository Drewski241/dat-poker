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
let fallbackBook: HouseTreasuryBook | null = null;
let remoteLocksMissing = false;

/** Stand-in ceiling when the payout host has no `/locks` route and no bankroll is set. 100,000 DAT. */
const FALLBACK_LOCK_BANKROLL_MOJOS = 100_000_000n;

export function resetHouseTreasuryForTests(): void {
  book = null;
  fallbackBook = null;
  remoteLocksMissing = false;
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

class TreasuryRouteMissingError extends Error {
  constructor(url: string) {
    super(`Treasury has no lock route (${url})`);
    this.name = "TreasuryRouteMissingError";
  }
}

function fallbackLockMojos(): bigint {
  const raw = process.env.DAT_TREASURY_LOCK_FALLBACK_MOJOS?.trim();
  if (raw) return BigInt(raw);
  return FALLBACK_LOCK_BANKROLL_MOJOS;
}

/** The beta payout host often predates `/locks`. Reserve on this API instead of failing the join. */
function ensureFallbackBook(): HouseTreasuryBook {
  remoteLocksMissing = true;
  if (!fallbackBook) {
    const amount = bankrollMojos() ?? fallbackLockMojos();
    fallbackBook = new HouseTreasuryBook(amount);
    console.warn(
      `Treasury payout URL has no /locks route. Locking house buy-ins on this API (ceiling ${amount.toString()} mojos). Set DAT_TREASURY_BANKROLL_MOJOS to the treasury DAT balance.`,
    );
  }
  return fallbackBook;
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
  if (res.status === 404) {
    throw new TreasuryRouteMissingError(url);
  }
  let body: T & { error?: string; message?: string };
  try {
    body = (await res.json()) as T & { error?: string; message?: string };
  } catch {
    throw new Error(`Treasury lock failed (${res.status})`);
  }
  if (!res.ok) {
    const detail = body.error && body.message && body.error !== body.message
      ? `${body.error}: ${body.message}`
      : body.error;
    throw new Error(detail ?? `Treasury lock failed (${res.status})`);
  }
  return body;
}

export async function houseLockView(tableId?: string): Promise<HouseLockView> {
  const local = localBook();
  if (local) return toView(local.snapshot(tableId), tableId);
  if (remoteLocksMissing) return toView(ensureFallbackBook().snapshot(tableId), tableId);
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    const query = tableId ? `?tableId=${encodeURIComponent(tableId)}` : "";
    try {
      const body = await remoteJson<HouseLockView>(`${remote}/locks${query}`);
      return { ...body, configured: true };
    } catch (e) {
      if (e instanceof TreasuryRouteMissingError) {
        return toView(ensureFallbackBook().snapshot(tableId), tableId);
      }
      throw e;
    }
  }
  return toView(null);
}

/** Reserve the house buy-in. Returns null when dev mode has no treasury configured. */
export async function lockHouseBuyIn(tableId: string, amount: bigint): Promise<HouseLockSnapshot | null> {
  const local = localBook();
  if (local) return local.lock(tableId, amount);
  if (remoteLocksMissing) return ensureFallbackBook().lock(tableId, amount);
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    try {
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
    } catch (e) {
      if (e instanceof TreasuryRouteMissingError) {
        return ensureFallbackBook().lock(tableId, amount);
      }
      throw e;
    }
  }

  if (process.env.DAT_ALLOW_DEV_BUYIN === "true") return null;
  throw new Error(
    "House buy-in cannot be locked. Set DAT_TREASURY_BANKROLL_MOJOS or DAT_TREASURY_PAYOUT_URL to the DAT treasury.",
  );
}

/** Drop the table reservation. `spentMojos` already left the treasury as a tester payout. */
export async function settleHouseTable(tableId: string, spentMojos: bigint): Promise<void> {
  const local = localBook();
  if (local) {
    const existing = local.snapshot(tableId).tableLockedMojos;
    if (existing == null && spentMojos === 0n) return;
    local.consume(tableId, spentMojos, false);
    local.release(tableId);
    return;
  }
  if (remoteLocksMissing) {
    const current = ensureFallbackBook();
    const existing = current.snapshot(tableId).tableLockedMojos;
    if (existing == null && spentMojos === 0n) return;
    current.consume(tableId, spentMojos, false);
    current.release(tableId);
    return;
  }
  const remote = treasuryServiceBaseUrl();
  if (remote) {
    try {
      await remoteJson(`${remote}/locks/settle`, {
        method: "POST",
        body: JSON.stringify({ tableId, spentMojos: spentMojos.toString() }),
      });
    } catch (e) {
      if (e instanceof TreasuryRouteMissingError) {
        const current = ensureFallbackBook();
        const existing = current.snapshot(tableId).tableLockedMojos;
        if (existing == null && spentMojos === 0n) return;
        current.consume(tableId, spentMojos, false);
        current.release(tableId);
        return;
      }
      throw e;
    }
    return;
  }
}

export { InsufficientHouseBankrollError };
