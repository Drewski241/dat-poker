import { describe, expect, it, beforeEach } from "vitest";
import {
  creditAccount,
  debitAccount,
  resetAccountsForTests,
  tryRedeemDaily,
} from "./account-store.js";
import { getLedgerEventsForPlayer, resetLedgerJournalForTests } from "./ledger-journal.js";

describe("ledger journal", () => {
  beforeEach(() => {
    process.env.DAT_LEDGER_PATH = "memory";
    process.env.DAT_LEDGER_JOURNAL_PATH = "memory";
    resetAccountsForTests();
    resetLedgerJournalForTests();
  });

  it("records redeem, buy-in, and cash-out style events", () => {
    const noon = new Date("2026-10-11T12:00:00.000Z");
    expect(tryRedeemDaily("alice", 5_000_000n, noon).credited).toBe(true);
    debitAccount("alice", 1_000_000n, { type: "buy_in", ref: "table-1" });
    creditAccount("alice", 1_200_000n, { type: "cash_out", ref: "table-1" });

    const events = getLedgerEventsForPlayer("alice");
    expect(events.map((e) => e.type)).toEqual(["cash_out", "buy_in", "redeem"]);
    expect(events[0]?.deltaMojos).toBe("1200000");
    expect(events[1]?.deltaMojos).toBe("-1000000");
    expect(events[2]?.balanceAfterMojos).toBe("5000000");
  });
});
