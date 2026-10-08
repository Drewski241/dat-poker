import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyBuyInPlaythrough,
  consumePlaythroughWithdraw,
  creditAccount,
  debitAccount,
  getAccountBalance,
  getPlaythrough,
  hasRedeemedToday,
  reloadLedgerFromDiskForTests,
  resetAccountsForTests,
  setPlaythroughHands,
  syncPlaythroughHeld,
  tryRedeemDaily,
} from "./account-store.js";
import { playthroughHandsRequired, playthroughUnlockedMojos } from "@dat-poker/shared";

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

  it("allows one 5000 DAT redeem per 24-hour window", () => {
    const noon = new Date("2026-09-16T12:00:00.000Z");
    const first = tryRedeemDaily("xch1a", 5_000_000n, noon);
    expect(first.credited).toBe(true);
    expect(first.balance).toBe(5_000_000n);
    expect(hasRedeemedToday("xch1a", noon)).toBe(true);

    const again = tryRedeemDaily("xch1a", 5_000_000n, noon);
    expect(again.credited).toBe(false);
    expect(again.alreadyRedeemed).toBe(true);
    expect(again.balance).toBe(5_000_000n);

    const beforeCooldown = new Date("2026-09-17T00:00:00.000Z");
    expect(hasRedeemedToday("xch1a", beforeCooldown)).toBe(true);
    const blocked = tryRedeemDaily("xch1a", 5_000_000n, beforeCooldown);
    expect(blocked.credited).toBe(false);

    const afterCooldown = new Date("2026-09-17T12:00:01.000Z");
    const second = tryRedeemDaily("xch1a", 5_000_000n, afterCooldown);
    expect(second.credited).toBe(true);
    expect(second.balance).toBe(10_000_000n);
  });

  it("locks 5000 hands on redeem and adds another 5000 the next day", () => {
    const noon = new Date("2026-09-16T12:00:00.000Z");
    tryRedeemDaily("xch1pt", 5_000_000n, noon);
    expect(getPlaythrough("xch1pt")).toEqual({ poolMojos: 5_000_000n, handsPlayed: 0 });
    expect(playthroughUnlockedMojos(0, 5_000_000n)).toBe(0n);

    setPlaythroughHands("xch1pt", 12);
    expect(getPlaythrough("xch1pt").handsPlayed).toBe(12);

    const nextDay = new Date("2026-09-17T12:00:01.000Z");
    const second = tryRedeemDaily("xch1pt", 5_000_000n, nextDay);
    expect(second.credited).toBe(true);
    expect(getPlaythrough("xch1pt")).toEqual({ poolMojos: 10_000_000n, handsPlayed: 12 });
  });

  it("does not shrink play-through when chips are lost", () => {
    tryRedeemDaily("xch1hold", 5_000_000n);
    syncPlaythroughHeld("xch1hold", 0n);
    expect(getPlaythrough("xch1hold").poolMojos).toBe(5_000_000n);
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
    expect(JSON.parse(readFileSync(file, "utf8")).redeemed[0].lastRedeemAt).toBe(noon.toISOString());
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

  it("restores a wiped redeem lock so lobby play-through is 5000, then 10000", () => {
    const file = join(mkdtempSync(join(tmpdir(), "dat-pt-wipe-")), "ledger.json");
    process.env.DAT_LEDGER_PATH = file;
    resetAccountsForTests();
    const noon = new Date("2026-09-16T12:00:00.000Z");
    tryRedeemDaily("user_wiped", 5_000_000n, noon);
    setPlaythroughHands("user_wiped", 17);
    writeFileSync(
      file,
      JSON.stringify({
        balances: [{ playerId: "user_wiped", balanceMojos: "5000000" }],
        redeemed: [{ playerId: "user_wiped", lastRedeemAt: noon.toISOString() }],
        playthrough: [],
      }),
      "utf8",
    );
    reloadLedgerFromDiskForTests();
    const restored = getPlaythrough("user_wiped");
    expect(restored.poolMojos).toBe(5_000_000n);
    expect(playthroughHandsRequired(restored.poolMojos)).toBe(5000);

    const nextDay = new Date("2026-09-17T12:00:01.000Z");
    expect(tryRedeemDaily("user_wiped", 5_000_000n, nextDay).credited).toBe(true);
    expect(getPlaythrough("user_wiped").poolMojos).toBe(10_000_000n);
    expect(playthroughHandsRequired(getPlaythrough("user_wiped").poolMojos)).toBe(10000);
  });

  it("does not rewind hands when a new table reports zero", () => {
    tryRedeemDaily("user_hands", 5_000_000n);
    setPlaythroughHands("user_hands", 40);
    setPlaythroughHands("user_hands", 0);
    expect(getPlaythrough("user_hands").handsPlayed).toBe(40);
  });

  it("does not restore play-through after a Sage withdraw", () => {
    tryRedeemDaily("user_sage", 5_000_000n);
    setPlaythroughHands("user_sage", 20);
    consumePlaythroughWithdraw("user_sage", 5_000_000n);
    expect(getPlaythrough("user_sage")).toEqual({ poolMojos: 0n, handsPlayed: 0 });
  });
});

