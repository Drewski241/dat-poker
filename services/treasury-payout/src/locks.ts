import { HouseTreasuryBook, type HouseLockSnapshot } from "@dat-poker/chia-bridge";

let book: HouseTreasuryBook | null = null;

export function resetTreasuryLocksForTests(): void {
  book = null;
}

export function treasuryLockBook(): HouseTreasuryBook {
  if (!book) {
    const raw = process.env.DAT_TREASURY_BANKROLL_MOJOS?.trim();
    if (!raw) {
      throw new Error(
        "DAT_TREASURY_BANKROLL_MOJOS is required so heads-up house buy-ins can be locked against the treasury",
      );
    }
    book = new HouseTreasuryBook(BigInt(raw));
  }
  return book;
}

export function snapshotLocks(tableId?: string): HouseLockSnapshot {
  return treasuryLockBook().snapshot(tableId);
}

export function lockTreasuryHouseBuyIn(tableId: string, amountMojos: bigint): HouseLockSnapshot {
  return treasuryLockBook().lock(tableId, amountMojos);
}

export function settleTreasuryHouseTable(tableId: string, spentMojos: bigint): HouseLockSnapshot {
  const current = treasuryLockBook();
  current.consume(tableId, spentMojos, false);
  return current.release(tableId);
}
