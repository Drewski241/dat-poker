import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBuyInPlaythrough,
  creditAccount,
  debitAccount,
  getAccountBalance,
  getPlaythrough,
  hasRedeemedToday,
  reloadLedgerFromDiskForTests,
  resetAccountsForTests,
  setPlaythroughHands,
  tryRedeemDaily,
} from "./account-store.js";
import { playthroughUnlockedMojos } from "@dat-poker/shared";

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

  it("keeps play-through unlocks across a ledger reload", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dat-playthrough-")), "ledger.json");
    process.env.DAT_LEDGER_PATH = file;
    resetAccountsForTests();
    creditAccount("user_pt", 5_000_000n);
    applyBuyInPlaythrough("user_pt", 1_000_000n, true);
    debitAccount("user_pt", 1_000_000n);
    setPlaythroughHands("user_pt", 50);
    const saved = JSON.parse(readFileSync(file, "utf8")).playthrough[0];
    expect(saved.poolMojos).toBe("1000000");
    expect(saved.handsPlayed).toBe(50);

    reloadLedgerFromDiskForTests();
    const pt = getPlaythrough("user_pt");
    expect(pt.poolMojos).toBe(1_000_000n);
    expect(pt.handsPlayed).toBe(50);
    expect(playthroughUnlockedMojos(pt.handsPlayed, pt.poolMojos)).toBe(50_000n);

    const returning = applyBuyInPlaythrough("user_pt", 1_000_000n, true);
    expect(returning.addedFreshMojos).toBe(0n);
    expect(getPlaythrough("user_pt").handsPlayed).toBe(50);
  });
});

