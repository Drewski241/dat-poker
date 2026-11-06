import { describe, expect, it } from "vitest";
import { HouseTreasuryBook, InsufficientHouseBankrollError } from "./house-treasury-book.js";

describe("HouseTreasuryBook", () => {
  it("locks each heads-up buy-in and refuses to oversubscribe the treasury", () => {
    const book = new HouseTreasuryBook(1_500_000n);
    expect(book.lock("t1", 1_000_000n).availableMojos).toBe(500_000n);
    expect(() => book.lock("t2", 1_000_000n)).toThrow(InsufficientHouseBankrollError);
    expect(book.available()).toBe(500_000n);
  });

  it("is idempotent for the same table and amount", () => {
    const book = new HouseTreasuryBook(2_000_000n);
    book.lock("t1", 1_000_000n);
    expect(book.lock("t1", 1_000_000n).lockedMojos).toBe(1_000_000n);
  });

  it("returns only the unspent remainder when a tester is paid", () => {
    const book = new HouseTreasuryBook(5_000_000n);
    book.lock("t1", 1_000_000n);
    book.consume("t1", 50_000n);
    const after = book.release("t1");
    expect(after.lockedMojos).toBe(0n);
    expect(after.spendableMojos).toBe(4_950_000n);
    expect(after.availableMojos).toBe(4_950_000n);
  });

  it("releases the full buy-in when the house is not paid out", () => {
    const book = new HouseTreasuryBook(2_000_000n);
    book.lock("t1", 1_000_000n);
    const after = book.release("t1");
    expect(after.availableMojos).toBe(2_000_000n);
    expect(book.lock("t2", 2_000_000n).availableMojos).toBe(0n);
  });
});
