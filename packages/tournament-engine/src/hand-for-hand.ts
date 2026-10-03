/**
 * Hand-for-hand barrier: when the field approaches the bubble / final table,
 * tables that finish a hand wait until every live table finishes before the
 * next deal — so eliminations resolve in a fair order.
 */

export type HandForHandReason = "bubble" | "final_table" | "manual" | null;

export interface HandForHandState {
  active: boolean;
  reason: HandForHandReason;
  /** Tables that still need to finish the current synchronized hand. */
  waitingOn: string[];
  /** Tables that reported hand complete for this sync wave. */
  completed: string[];
  wave: number;
}

export class HandForHandController {
  private active = false;
  private reason: HandForHandReason = null;
  private waitingOn = new Set<string>();
  private completed = new Set<string>();
  private wave = 0;

  isActive(): boolean {
    return this.active;
  }

  getReason(): HandForHandReason {
    return this.reason;
  }

  getState(): HandForHandState {
    return {
      active: this.active,
      reason: this.reason,
      waitingOn: [...this.waitingOn].sort(),
      completed: [...this.completed].sort(),
      wave: this.wave,
    };
  }

  /**
   * Enable hand-for-hand across the given open table ids.
   * Idempotent if already active with the same set.
   */
  enable(tableIds: readonly string[], reason: Exclude<HandForHandReason, null>): void {
    if (tableIds.length === 0) {
      this.disable();
      return;
    }
    if (!this.active || this.reason !== reason) {
      this.active = true;
      this.reason = reason;
      this.wave += 1;
      this.waitingOn = new Set(tableIds);
      this.completed = new Set();
      return;
    }
    // Refresh membership for new/closed tables mid-bubble
    for (const id of tableIds) {
      if (!this.completed.has(id) && !this.waitingOn.has(id)) {
        this.waitingOn.add(id);
      }
    }
    for (const id of [...this.waitingOn]) {
      if (!tableIds.includes(id)) this.waitingOn.delete(id);
    }
    for (const id of [...this.completed]) {
      if (!tableIds.includes(id)) this.completed.delete(id);
    }
  }

  disable(): void {
    this.active = false;
    this.reason = null;
    this.waitingOn.clear();
    this.completed.clear();
  }

  /** Whether this table may deal the next hand. */
  canDeal(tableId: string): boolean {
    if (!this.active) return true;
    return this.waitingOn.has(tableId) && !this.completed.has(tableId);
  }

  /**
   * Mark a table's hand finished. When all waiting tables report in,
   * starts a new wave so everyone can deal again.
   */
  reportHandComplete(tableId: string): {
    waveComplete: boolean;
    state: HandForHandState;
  } {
    if (!this.active) {
      return { waveComplete: false, state: this.getState() };
    }
    if (!this.waitingOn.has(tableId) && !this.completed.has(tableId)) {
      // Table joined mid-wave — treat as already done for this wave
      this.completed.add(tableId);
    } else {
      this.waitingOn.delete(tableId);
      this.completed.add(tableId);
    }

    if (this.waitingOn.size === 0) {
      // New wave: everyone who completed becomes waiting again
      this.wave += 1;
      this.waitingOn = new Set(this.completed);
      this.completed = new Set();
      return { waveComplete: true, state: this.getState() };
    }

    return { waveComplete: false, state: this.getState() };
  }
}

/** Classic bubble: one more elimination than places paid. */
export function shouldHandForHand(input: {
  activeCount: number;
  paidPlaces: number;
  tableCount: number;
  finalTableSeats: number;
}): HandForHandReason {
  if (input.activeCount <= 1) return null;

  // Still multi-table and one elimination from the money → bubble sync
  if (
    input.tableCount > 1 &&
    input.activeCount > input.finalTableSeats &&
    input.paidPlaces > 0 &&
    input.activeCount === input.paidPlaces + 1
  ) {
    return "bubble";
  }

  // Everyone fits on one table (or already there)
  if (input.activeCount <= input.finalTableSeats) {
    return "final_table";
  }

  return null;
}
