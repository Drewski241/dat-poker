import { useEffect, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { CalpokerTableView } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";
import { SessionReminder } from "./SessionReminder.js";

const ANTES = [10_000n, 25_000n, 50_000n, 100_000n];

export function CalpokerTable({
  view,
  busy,
  ticker,
  onDeal,
  onSwap,
  onSetLimit,
  onLeave,
}: {
  view: CalpokerTableView;
  busy: boolean;
  ticker?: string;
  onDeal: (amountMojos: string) => void;
  onSwap: (indexes: number[]) => void;
  onSetLimit: (lossLimitMojos: string | null) => void;
  onLeave: () => void;
}) {
  const [ante, setAnte] = useState(10_000n);
  const [selected, setSelected] = useState<number[]>([]);
  const selecting = view.phase === "selecting";
  const stack = BigInt(view.stackMojos);
  const room = view.lossRoomMojos === null ? null : BigInt(view.lossRoomMojos);
  const maxAnte = BigInt(view.maxAnteMojos);

  useEffect(() => {
    if (!selecting) setSelected([]);
  }, [selecting, view.tableId]);

  const toggle = (index: number) => {
    setSelected((current) => {
      if (current.includes(index)) return current.filter((item) => item !== index);
      if (current.length >= 4) return current;
      return [...current, index];
    });
  };

  return (
    <div className="bj-wrap">
      <section className="bj-felt" aria-label="California poker">
        <p className="bj-rule">Eight cards each · give four away · best five win</p>
        <div className="cp-side">
          <p className="bj-label">House{view.houseHand ? ` · ${view.houseHand}` : ""}</p>
          <div className="cp-cards">
            {view.houseCards.map((card, index) => (
              <div key={`h${card.rank}${card.suit}${index}`} className={view.phase === "done" && !card.played ? "cp-idle" : ""}>
                <PlayingCard card={card} size="sm" />
              </div>
            ))}
          </div>
        </div>
        {view.phase === "done" && <p className="bj-result">{resultLine(view)}</p>}
        {selecting && <p className="bj-label">Choose four cards to give the house · {selected.length} of 4</p>}
        <div className="cp-side">
          <p className="bj-label">{view.displayName}{view.playerHand ? ` · ${view.playerHand}` : ""}</p>
          <div className="cp-cards">
            {view.playerCards.map((card, index) => {
              const on = selected.includes(index);
              return (
                <button
                  key={`p${card.rank}${card.suit}${index}`}
                  type="button"
                  className={`cp-card ${on ? "selected" : ""} ${view.phase === "done" && !card.played ? "cp-idle" : ""}`}
                  disabled={busy || !selecting}
                  aria-pressed={on}
                  onClick={() => toggle(index)}
                >
                  <PlayingCard card={card} size="sm" />
                  <span className="vp-held-label">{on ? "Swap" : ""}</span>
                </button>
              );
            })}
          </div>
          {view.playerCards.length === 0 && <p className="felt-wait">Place an ante</p>}
        </div>
        {view.anteMojos !== "0" && <ChipStack mojos={view.anteMojos} ticker={ticker} />}
        {view.commitHash && (
          <p className="deck-lock">
            {view.serverSeed
              ? `Deck revealed · ${view.serverSeed.slice(0, 8)}…`
              : `Deck locked · ${view.commitHash.slice(0, 8)}…`}
          </p>
        )}
      </section>
      <div className="actions-dock">
        <SessionReminder
          resultMojos={view.sessionResultMojos}
          lossLimitMojos={view.lossLimitMojos}
          limitReached={view.limitReached}
          canEdit={!selecting}
          busy={busy}
          ticker={ticker}
          onSetLimit={onSetLimit}
        />
        <p>
          Stack <strong>{formatDatMojos(view.stackMojos, ticker)}</strong>
        </p>
        {selecting ? (
          <div className="actions">
            <button type="button" disabled={busy || selected.length !== 4} onClick={() => onSwap(selected)}>
              swap
            </button>
          </div>
        ) : (
          <div className="actions">
            {ANTES.map((amount) => (
              <button
                key={amount.toString()}
                type="button"
                className={ante === amount ? "primary-bet" : "secondary"}
                disabled={busy || view.limitReached || amount > stack || amount > maxAnte || (room !== null && amount > room)}
                onClick={() => setAnte(amount)}
              >
                {formatDatMojos(amount, ticker)}
              </button>
            ))}
            <button
              type="button"
              disabled={busy || view.limitReached || ante > stack || (room !== null && ante > room)}
              onClick={() => onDeal(ante.toString())}
            >
              {view.phase === "done" ? "Deal again" : "Deal"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={onLeave}>
              Leave table
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function resultLine(view: CalpokerTableView): string {
  if (view.winner === "player") return `You win with ${view.playerHand}`;
  if (view.winner === "house") return `House wins with ${view.houseHand}`;
  return `Tie · ${view.playerHand}`;
}
