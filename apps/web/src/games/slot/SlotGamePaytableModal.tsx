import { useEffect } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { SlotGameId } from "@dat-poker/shared";
import { SLOT_GAMES } from "@dat-poker/shared";
import {
  HOUSE_LINE_PAYTABLE,
  HOUSE_SYMBOLS,
  MINE_LINE_PAYTABLE,
  MINE_SYMBOLS,
  PAYLINE_COUNT,
  PAYLINE_NAMES,
  POKER_HAND_PAYTABLE,
  STAMPEDE_SYMBOLS,
  STAMPEDE_WAYS_PAYTABLE,
  type HouseSymbolId,
  type MineSymbolId,
  type StampedeSymbolId,
} from "@dat-poker/slot-engine";

function lineBetMojos(totalBetMojos: bigint): bigint {
  return totalBetMojos / BigInt(PAYLINE_COUNT);
}

function payoutForMultiplier(multiplier: number, totalBetMojos: bigint, ticker: string): string {
  const mojos = BigInt(multiplier) * lineBetMojos(totalBetMojos);
  return formatDatMojos(mojos.toString(), ticker);
}

export function SlotGamePaytableModal({
  gameId,
  open,
  onClose,
  totalBetMojos,
  ticker = "DAT",
  progressiveJackpotMojos,
}: {
  gameId: Exclude<SlotGameId, "spirit">;
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

  const meta = SLOT_GAMES[gameId];
  const lineBet = lineBetMojos(totalBetMojos);

  return (
    <div
      className="slot-paytable-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="slot-paytable-modal panel" role="dialog" aria-modal="true">
        <header className="slot-paytable-header">
          <h2>
            {meta.emoji} {meta.title} — paytable
          </h2>
          <button type="button" className="secondary slot-paytable-close" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="slot-paytable-lede muted small">
          Wager <strong>{formatDatMojos(totalBetMojos.toString(), ticker)}</strong>
          {gameId === "spirit-stampede" ? (
            <> · line stake ~{formatDatMojos(lineBet.toString(), ticker)} (÷ {PAYLINE_COUNT} for ways math)</>
          ) : (
            <>
              {" "}
              · ~{formatDatMojos(lineBet.toString(), ticker)} per line ({PAYLINE_COUNT} lines)
            </>
          )}
        </p>

        {gameId === "mine-mojo" && (
          <>
            <h3>Cascading line wins</h3>
            <p className="muted small">
              Wins explode and new symbols fall. Each cascade step increases the multiplier (up to 6×).
              Pickaxe ⛏️ is wild. Dynamite 🧨 is scatter (3+ anywhere).
            </p>
            <PaylineTable
              rows={(Object.keys(MINE_LINE_PAYTABLE) as MineSymbolId[]).map((id) => ({
                emoji: MINE_SYMBOLS[id].emoji,
                label: MINE_SYMBOLS[id].label,
                mults: MINE_LINE_PAYTABLE[id]!,
              }))}
              totalBetMojos={totalBetMojos}
              ticker={ticker}
            />
            <h3>Progressive</h3>
            <p className="muted small">
              Five 💎 Mother Lode on the center row wins{" "}
              <strong>{formatDatMojos(progressiveJackpotMojos, ticker)}</strong>.
            </p>
          </>
        )}

        {gameId === "poker-hands" && (
          <>
            <h3>Payline = 5-card poker hand</h3>
            <p className="muted small">
              Each of the 9 lines uses the five symbols on that path as a poker hand. After many spins you
              may get a free <strong>hold &amp; draw</strong> (hold up to 2 reels, redraw the rest).
            </p>
            <table className="slot-paytable">
              <thead>
                <tr>
                  <th>Hand</th>
                  <th>Multiplier × line stake</th>
                  <th>At your bet</th>
                </tr>
              </thead>
              <tbody>
                {POKER_HAND_PAYTABLE.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{row.multiplier}×</td>
                    <td>{payoutForMultiplier(row.multiplier, totalBetMojos, ticker)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Progressive</h3>
            <p className="muted small">
              Royal flush on the center row pays the pot:{" "}
              <strong>{formatDatMojos(progressiveJackpotMojos, ticker)}</strong>.
            </p>
          </>
        )}

        {gameId === "spirit-stampede" && (
          <>
            <h3>243 ways (left → right)</h3>
            <p className="muted small">
              Match symbols on consecutive reels starting from reel 1. Ways = product of matching rows per
              reel. 🌪️ Dust wild substitutes. 🌙 Moon scatter ×3+ pays 10× line stake. Expanding dust on reel
              3 respins reels 1, 2, 4, 5.
            </p>
            <table className="slot-paytable">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>3 reels</th>
                  <th>4 reels</th>
                  <th>5 reels</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(STAMPEDE_WAYS_PAYTABLE) as StampedeSymbolId[]).map((id) => {
                  const row = STAMPEDE_WAYS_PAYTABLE[id]!;
                  const sym = STAMPEDE_SYMBOLS[id];
                  return (
                    <tr key={id}>
                      <td>
                        {sym.emoji} {sym.label}
                      </td>
                      {[2, 3, 4].map((i) => (
                        <td key={i}>
                          <span className="slot-paytable-mult">{row[i]!}×</span>
                          <span className="slot-paytable-amt">
                            {payoutForMultiplier(row[i]!, totalBetMojos, ticker)} per way
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Total win = base × ways (e.g. 2 matching rows on reel 1 and 1 on reel 2 ⇒ 2 ways).
            </p>
            <h3>Progressive</h3>
            <p className="muted small">
              🌪️ Dust wild on <strong>every reel</strong> in one spin wins{" "}
              <strong>{formatDatMojos(progressiveJackpotMojos, ticker)}</strong>.
            </p>
          </>
        )}

        {gameId === "house-edge" && (
          <>
            <h3>Line wins (left → right)</h3>
            <p className="muted small">
              ✨ Wild substitutes. 💀 Skull scatter 3+ pays 8× (16× during boss bonus). Drain the boss HP bar
              for 5 free spins at 2× line pays.
            </p>
            <PaylineTable
              rows={(Object.keys(HOUSE_LINE_PAYTABLE) as HouseSymbolId[]).map((id) => ({
                emoji: HOUSE_SYMBOLS[id].emoji,
                label: HOUSE_SYMBOLS[id].label,
                mults: HOUSE_LINE_PAYTABLE[id]!,
              }))}
              totalBetMojos={totalBetMojos}
              ticker={ticker}
            />
            <h3>Progressive</h3>
            <p className="muted small">
              During boss bonus only: five 🎩 The House on the center row wins{" "}
              <strong>{formatDatMojos(progressiveJackpotMojos, ticker)}</strong>.
            </p>
          </>
        )}

        {gameId !== "spirit-stampede" && (
          <>
            <h3>Paylines ({PAYLINE_COUNT})</h3>
            <ol className="slot-paytable-lines muted small">
              {PAYLINE_NAMES.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ol>
          </>
        )}

        <p className="muted small">5% of each paid spin feeds this game&apos;s progressive only.</p>
      </div>
    </div>
  );
}

function PaylineTable({
  rows,
  totalBetMojos,
  ticker,
}: {
  rows: { emoji: string; label: string; mults: [number, number, number] }[];
  totalBetMojos: bigint;
  ticker: string;
}) {
  return (
    <div className="slot-paytable-scroll">
      <table className="slot-paytable">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>3 in a row</th>
            <th>4 in a row</th>
            <th>5 in a row</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>
                {row.emoji} {row.label}
              </td>
              {row.mults.map((mult, i) => (
                <td key={i}>
                  <span className="slot-paytable-mult">{mult}×</span>
                  <span className="slot-paytable-amt">
                    {payoutForMultiplier(mult, totalBetMojos, ticker)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
