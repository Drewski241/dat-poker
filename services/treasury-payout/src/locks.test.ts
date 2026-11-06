import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InsufficientHouseBankrollError } from "@dat-poker/chia-bridge";
import { lockTreasuryHouseBuyIn, resetTreasuryLocksForTests, settleTreasuryHouseTable } from "./locks.js";

const BUY_IN = 1_000_000n;

describe("treasury house locks", () => {
  const previous = process.env.DAT_TREASURY_BANKROLL_MOJOS;

  beforeEach(() => {
    process.env.DAT_TREASURY_BANKROLL_MOJOS = (BUY_IN * 2n).toString();
    resetTreasuryLocksForTests();
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.DAT_TREASURY_BANKROLL_MOJOS;
    else process.env.DAT_TREASURY_BANKROLL_MOJOS = previous;
    resetTreasuryLocksForTests();
  });

  it("holds two house buy-ins and frees one when that table settles", () => {
    lockTreasuryHouseBuyIn("table-a", BUY_IN);
    const both = lockTreasuryHouseBuyIn("table-b", BUY_IN);
    expect(both.availableMojos).toBe(0n);
    expect(() => lockTreasuryHouseBuyIn("table-c", BUY_IN)).toThrow(InsufficientHouseBankrollError);

    const freed = settleTreasuryHouseTable("table-a", 0n);
    expect(freed.availableMojos).toBe(BUY_IN);
    expect(freed.tableLockedMojos).toBeNull();
  });
});
