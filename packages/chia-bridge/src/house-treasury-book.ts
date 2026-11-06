/** Not enough unreserved DAT in the treasury to cover another house buy-in. */
export class InsufficientHouseBankrollError extends Error {
  readonly availableMojos: bigint;
  readonly requestedMojos: bigint;

  constructor(availableMojos: bigint, requestedMojos: bigint) {
    super(
      `Treasury does not have enough free DAT to lock the house buy-in (need ${requestedMojos.toString()} mojos, ${availableMojos.toString()} available).`,
    );
    this.name = "InsufficientHouseBankrollError";
    this.availableMojos = availableMojos;
    this.requestedMojos = requestedMojos;
  }
}

export interface HouseLockSnapshot {
  spendableMojos: bigint;
  lockedMojos: bigint;
  availableMojos: bigint;
  tableLockedMojos: bigint | null;
}

/**
 * Reservations against the DAT treasury bankroll.
 * Each heads-up house seat holds its buy-in until that table ends, so concurrent
 * testers cannot all play against the same coins.
 */
export class HouseTreasuryBook {
  private locks = new Map<string, bigint>();

  constructor(private spendableMojos: bigint) {
    if (spendableMojos < 0n) {
      throw new Error("Treasury spendable cannot be negative");
    }
  }

  setSpendable(amount: bigint): void {
    if (amount < 0n) {
      throw new Error("Treasury spendable cannot be negative");
    }
    this.spendableMojos = amount;
  }

  lockedTotal(): bigint {
    let total = 0n;
    for (const amount of this.locks.values()) total += amount;
    return total;
  }

  available(): bigint {
    const locked = this.lockedTotal();
    return this.spendableMojos > locked ? this.spendableMojos - locked : 0n;
  }

  snapshot(tableId?: string): HouseLockSnapshot {
    return {
      spendableMojos: this.spendableMojos,
      lockedMojos: this.lockedTotal(),
      availableMojos: this.available(),
      tableLockedMojos: tableId === undefined ? null : (this.locks.get(tableId) ?? null),
    };
  }

  lock(tableId: string, amount: bigint): HouseLockSnapshot {
    if (!tableId) throw new Error("tableId required");
    if (amount <= 0n) throw new Error("House buy-in must be positive");
    const existing = this.locks.get(tableId);
    if (existing !== undefined) {
      if (existing !== amount) {
        throw new Error("House buy-in is already locked for this table at a different amount");
      }
      return this.snapshot(tableId);
    }
    if (amount > this.available()) {
      throw new InsufficientHouseBankrollError(this.available(), amount);
    }
    this.locks.set(tableId, amount);
    return this.snapshot(tableId);
  }

  /**
   * DAT paid out to a tester leaves the treasury.
   * When `balanceAlreadyReflectsSpend` is false, the book balance drops by the same amount.
   */
  consume(tableId: string, spent: bigint, balanceAlreadyReflectsSpend = false): void {
    if (spent < 0n) throw new Error("spent cannot be negative");
    if (spent === 0n) return;
    const lock = this.locks.get(tableId);
    if (lock !== undefined) {
      const next = spent >= lock ? 0n : lock - spent;
      if (next === 0n) this.locks.delete(tableId);
      else this.locks.set(tableId, next);
    }
    if (!balanceAlreadyReflectsSpend) {
      this.spendableMojos = this.spendableMojos > spent ? this.spendableMojos - spent : 0n;
    }
  }

  release(tableId: string): HouseLockSnapshot {
    this.locks.delete(tableId);
    return this.snapshot(tableId);
  }
}
