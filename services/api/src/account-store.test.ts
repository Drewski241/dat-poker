import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  creditAccount,
  debitAccount,
  getAccountBalance,
  hasRedeemedToday,
  reloadLedgerFromDiskForTests,
  resetAccountsForTests,
  tryRedeemDaily,
} from "./account-store.js";

describe("account-store", () => {
  beforeEach(() => {
    process.env.DAT_LEDGER_PATH = "memory";
    resetAccountsForTests();
  });

  it("credits and debits table-account DAT", () => {
    creditAccount("xch1a", 5_000_000n);
    expect(getAccountBalance("xch1a")).toBe(5_000_000n);
    debitAccount("xch1a", 1_000_000n);
    expect(getAccountBalance("xch1a")).toBe(4_000_000n);
  });

  it("allows one 5000 DAT redeem per UTC day", () => {
    const noon = new Date("2026-09-16T12:00:00.000Z");
    const first = tryRedeemDaily("xch1a", 5_000_000n, noon);
    expect(first.credited).toBe(true);
    expect(first.balance).toBe(5_000_000n);
    expect(hasRedeemedToday("xch1a", noon)).toBe(true);

    const again = tryRedeemDaily("xch1a", 5_000_000n, noon);
    expect(again.credited).toBe(false);
    expect(again.alreadyRedeemed).toBe(true);
    expect(again.balance).toBe(5_000_000n);

    const nextDay = tryRedeemDaily("xch1a", 5_000_000n, new Date("2026-09-17T00:00:00.000Z"));
    expect(nextDay.credited).toBe(true);
    expect(nextDay.balance).toBe(10_000_000n);
  });

  it("reloads DAT balances and daily redeem from disk", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dat-ledger-")), "ledger.json");
    process.env.DAT_LEDGER_PATH = file;
    resetAccountsForTests();
    const noon = new Date("2026-09-16T12:00:00.000Z");
    tryRedeemDaily("user_persist", 5_000_000n, noon);
    expect(JSON.parse(readFileSync(file, "utf8")).balances[0].balanceMojos).toBe("5000000");
    reloadLedgerFromDiskForTests();
    expect(getAccountBalance("user_persist")).toBe(5_000_000n);
    expect(hasRedeemedToday("user_persist", noon)).toBe(true);
  });
});

