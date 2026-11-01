import { useEffect } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import {
  PAYLINE_COUNT,
  PAYLINE_NAMES,
  PAYTABLE,
  PAYLINES,
  SCATTER_PAY_ANYWHERE,
  SLOT_SYMBOLS,
  type SymbolId,
} from "@dat-poker/slot-engine";

const PAYTABLE_SYMBOL_ORDER: SymbolId[] = [
  "cherry",
  "lemon",
  "bell",
  "chip",
  "ace",
  "king",
  "seven",
];

function lineBetMojos(totalBetMojos: bigint): bigint {
  return totalBetMojos / BigInt(PAYLINES.length);
}

function payoutForMultiplier(multiplier: number, totalBetMojos: bigint, ticker: string): string {
  const mojos = BigInt(multiplier) * lineBetMojos(totalBetMojos);
  return formatDatMojos(mojos.toString(), ticker);
}

export function SlotPaytableModal({
  open,
  onClose,
  totalBetMojos,
  ticker = "DAT",
  progressiveJackpotMojos,
}: {
  open: boolean;
  onClose: () => void;
  totalBetMojos: bigint;
  ticker?: string;
  progressiveJackpotMojos: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const scatterEntries = Object.entries(SCATTER_PAY_ANYWHERE)
    .map(([count, mult]) => ({
      count: Number(count),
      mult,
    }))
    .sort((a, b) => a.count - b.count);

  return (
    <div
      className="slot-paytable-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="slot-paytable-modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-paytable-title"
      >
        <header className="slot-paytable-header">
          <h2 id="slot-paytable-title">Paytable &amp; rules</h2>
          <button type="button" className="secondary slot-paytable-close" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="slot-paytable-lede muted small">
          Your wager <strong>{formatDatMojos(totalBetMojos.toString(), ticker)}</strong> covers all{" "}
          {PAYLINE_COUNT} lines (~{formatDatMojos(lineBetMojos(totalBetMojos).toString(), ticker)}{" "}
          per line). Prizes below scale with the bet you select before each spin.
        </p>

        <h3>Line wins (left → right, wild ✨ substitutes)</h3>
        <div className="slot-paytable-scroll">
          <table className="slot-paytable">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">3 in a row</th>
                <th scope="col">4 in a row</th>
                <th scope="col">5 in a row</th>
              </tr>
            </thead>
            <tbody>
              {PAYTABLE_SYMBOL_ORDER.map((id) => {
                const row = PAYTABLE[id];
                const sym = SLOT_SYMBOLS[id];
                if (!row) return null;
                return (
                  <tr key={id}>
                    <td>
                      <span className="slot-paytable-sym" aria-hidden>
                        {sym.emoji}
                      </span>{" "}
                      {sym.label}
                    </td>
                    {row.map((mult, i) => (
                      <td key={i}>
                        <span className="slot-paytable-mult">{mult}×</span>
                        <span className="slot-paytable-amt">
                          {payoutForMultiplier(mult, totalBetMojos, ticker)}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3>Scatter wins (💎 anywhere on the grid)</h3>
        <ul className="slot-paytable-scatter">
          {scatterEntries.map(({ count, mult }) => (
            <li key={count}>
              {count} scatters — <strong>{mult}×</strong> line stake (
              {payoutForMultiplier(mult, totalBetMojos, ticker)})
            </li>
          ))}
        </ul>

        <h3>Progressive jackpot</h3>
        <p className="muted small">
          Five <strong>7️⃣ Lucky 7</strong> on the <strong>center row</strong> (Line 1) pays the
          progressive pot: currently{" "}
          <strong>{formatDatMojos(progressiveJackpotMojos, ticker)}</strong>. 5% of each spin feeds
          the pot.
        </p>

        <h3>Paylines ({PAYLINE_COUNT})</h3>
        <ol className="slot-paytable-lines muted small">
          {PAYLINE_NAMES.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ol>
        <p className="muted small">
          Toggle <strong>Show all 9 paylines</strong> on the machine to see paths on the reels.
          Multiple lines can win on one spin.
        </p>
      </div>
    </div>
  );
}
