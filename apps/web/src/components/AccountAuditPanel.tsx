import { formatDatMojos } from "@dat-poker/shared";
import type { LedgerEvent } from "../api.js";

type Props = {
  events: LedgerEvent[];
  ticker?: string;
  busy?: boolean;
  onRefresh: () => void;
};

const LABELS: Record<string, string> = {
  redeem: "Daily redeem",
  buy_in: "Buy-in",
  buy_in_refund: "Buy-in refund",
  cash_out: "Cash out to account",
  withdraw_sage: "Withdraw to Sage",
  prize: "Tournament prize",
  table_return: "Returned from table",
  credit: "Credit",
  debit: "Debit",
};

function labelFor(type: string): string {
  return LABELS[type] ?? type;
}

export function AccountAuditPanel({ events, ticker, busy, onRefresh }: Props) {
  return (
    <section className="panel lobby-account-audit">
      <div className="lobby-account-audit-head">
        <h2>Account activity</h2>
        <button type="button" className="secondary" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <p className="muted small">
        Redeem, buy-in, cash-out, and prizes on this host. Table pot wins stay in your stack until
        you cash out.
      </p>
      {events.length === 0 ? (
        <p className="muted small">No ledger events yet this session.</p>
      ) : (
        <ul className="lobby-account-audit-list">
          {events.map((event) => {
            const delta = BigInt(event.deltaMojos);
            const sign = delta > 0n ? "+" : "";
            return (
              <li key={event.id}>
                <span className="lobby-audit-type">{labelFor(event.type)}</span>
                <span className={`lobby-audit-delta ${delta >= 0n ? "pos" : "neg"}`}>
                  {sign}
                  {formatDatMojos(event.deltaMojos, ticker)}
                </span>
                <span className="muted small mono">
                  bal {formatDatMojos(event.balanceAfterMojos, ticker)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
