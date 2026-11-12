import { useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { VideoPokerTableView } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";

export function VideoPokerTable({
  view,
  busy,
  ticker,
  onDeal,
  onHold,
  onDraw,
  onLeave,
}: {
  view: VideoPokerTableView;
  busy: boolean;
  ticker?: string;
  onDeal: (coins: number) => void;
  onHold: (index: number) => void;
  onDraw: () => void;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState(1);
  const stack = BigInt(view.stackMojos);
  const coin = BigInt(view.coinMojos);
  const holding = view.phase === "holding";
  const coinsShown = holding || view.phase === "done" ? view.coins : selected;
  const bet = coin * BigInt(coinsShown);
  const canDeal = !holding && bet > 0n && bet <= stack;

  return (
    <div className="bj-wrap">
      <section className="bj-felt" aria-label="Video poker">
        <p className="bj-rule">Jacks or better · a five-coin royal pays 800 for 1</p>
        <div className="vp-layout">
          <table className="vp-pay">
            <tbody>
              {view.paytable.map((row) => {
                const perCoin = row.id === "royal_flush" && coinsShown === view.maxCoins ? view.royalMaxPerCoin : row.perCoin;
                const pays = coin * BigInt(perCoin) * BigInt(Math.max(coinsShown, 1));
                return (
                  <tr key={row.id} className={view.result === row.id ? "hit" : ""}>
                    <th>{row.label}</th>
                    <td>{formatDatMojos(pays.toString(), ticker)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="vp-hand">
            {view.cards.length === 0 ? (
              <p className="felt-wait">Place a bet</p>
            ) : (
              <div className="vp-cards">
                {view.cards.map((card, index) => {
                  const held = view.held[index];
                  return (
                    <button
                      key={`${card.rank}${card.suit}${index}`}
                      type="button"
                      className={`vp-card ${held ? "held" : ""}`}
                      disabled={busy || !holding}
                      aria-pressed={held}
                      onClick={() => onHold(index)}
                    >
                      <PlayingCard card={card} />
                      <span className="vp-held-label">{held ? "Held" : holding ? "Hold" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {view.betMojos !== "0" && <ChipStack mojos={view.betMojos} ticker={ticker} />}
            {view.phase === "done" && <p className="bj-result">{resultLine(view, ticker)}</p>}
            {holding && <p className="bj-label">{view.handName}. Hold cards, then draw.</p>}
          </div>
        </div>
        {view.commitHash && (
          <p className="deck-lock">
            {view.serverSeed
              ? `Deck revealed · ${view.serverSeed.slice(0, 8)}…`
              : `Deck locked · ${view.commitHash.slice(0, 8)}…`}
          </p>
        )}
      </section>
      <div className="actions-dock">
        <p>
          Stack <strong>{formatDatMojos(view.stackMojos, ticker)}</strong>
        </p>
        {holding ? (
          <div className="actions">
            <button type="button" disabled={busy} onClick={onDraw}>
              draw
            </button>
          </div>
        ) : (
          <div className="actions">
            {Array.from({ length: view.maxCoins }, (_, index) => index + 1).map((coins) => (
              <button
                key={coins}
                type="button"
                className={selected === coins ? "primary-bet" : "secondary"}
                disabled={busy || coin * BigInt(coins) > stack}
                onClick={() => setSelected(coins)}
              >
                {coins} {coins === 1 ? "coin" : "coins"}
              </button>
            ))}
            <button type="button" disabled={busy || !canDeal} onClick={() => onDeal(selected)}>
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

function resultLine(view: VideoPokerTableView, ticker?: string): string {
  const paid = view.payoutMojos ? formatDatMojos(view.payoutMojos, ticker) : "";
  if (view.result === "jacks_or_better") {
    const name = view.handName ? view.handName[0].toUpperCase() + view.handName.slice(1) : "Jacks or better";
    return `${name} · your bet back`;
  }
  if (view.result && view.result !== "nothing") {
    const label = view.paytable.find((row) => row.id === view.result)?.label ?? "Winner";
    return `${label} pays ${paid}`;
  }
  const name = view.handName ? view.handName[0].toUpperCase() + view.handName.slice(1) : "No pair";
  return `${name} · no win`;
}
