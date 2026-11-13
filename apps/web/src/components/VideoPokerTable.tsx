import { useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { VideoPokerTableView } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";
import { SessionReminder } from "./SessionReminder.js";

export function VideoPokerTable({
  view,
  busy,
  ticker,
  onDeal,
  onHold,
  onDraw,
  onSetLimit,
  onLeave,
}: {
  view: VideoPokerTableView;
  busy: boolean;
  ticker?: string;
  onDeal: (coins: number) => void;
  onHold: (index: number) => void;
  onDraw: () => void;
  onSetLimit: (lossLimitMojos: string | null) => void;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState(1);
  const stack = BigInt(view.stackMojos);
  const coin = BigInt(view.coinMojos);
  const room = view.lossRoomMojos === null ? null : BigInt(view.lossRoomMojos);
  const holding = view.phase === "holding";
  const coinsShown = holding || view.phase === "done" ? view.coins : selected;
  const dealBet = coin * BigInt(selected);
  const canDeal = !holding && !view.limitReached && dealBet > 0n && dealBet <= stack && (room === null || dealBet <= room);
  const tone = view.phase === "done" ? resultTone(view) : null;

  return (
    <div className="bj-wrap">
      <section className="vp-machine" aria-label="Video poker">
        <div className="vp-marquee">
          <span className="vp-bulbs" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
          <div className="vp-marquee-title">
            <strong>Jacks or Better</strong>
            <span>Five-coin royal pays 800 for 1</span>
          </div>
        </div>
        <div className="vp-cabinet">
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
          <div className="vp-screen">
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
            <div className="vp-lamps" aria-hidden="true">
              {Array.from({ length: view.maxCoins }, (_, index) => (
                <span key={index} className={index < coinsShown ? "vp-lamp on" : "vp-lamp"} />
              ))}
            </div>
            {view.betMojos !== "0" && <ChipStack mojos={view.betMojos} ticker={ticker} />}
            {view.phase === "done" && <p className={`felt-banner ${tone}`}>{resultLine(view, ticker)}</p>}
            {holding && <p className="bj-label">{view.handName}. Hold cards, then draw.</p>}
          </div>
        </div>
        {view.commitHash && (
          <p className="deck-plaque">
            {view.serverSeed ? `Deck revealed · ${view.serverSeed.slice(0, 8)}…` : `Deck locked · ${view.commitHash.slice(0, 8)}…`}
          </p>
        )}
      </section>
      <div className="actions-dock">
        <SessionReminder
          resultMojos={view.sessionResultMojos}
          lossLimitMojos={view.lossLimitMojos}
          limitReached={view.limitReached}
          canEdit={!holding}
          busy={busy}
          ticker={ticker}
          onSetLimit={onSetLimit}
        />
        <p>
          Stack <strong>{formatDatMojos(view.stackMojos, ticker)}</strong>
        </p>
        {holding ? (
          <div className="actions">
            <button type="button" className="action-draw" disabled={busy} onClick={onDraw}>
              Draw
            </button>
          </div>
        ) : (
          <div className="actions">
            {Array.from({ length: view.maxCoins }, (_, index) => index + 1).map((coins) => (
              <button
                key={coins}
                type="button"
                className={selected === coins ? "primary-bet" : "secondary"}
                disabled={busy || view.limitReached || coin * BigInt(coins) > stack || (room !== null && coin * BigInt(coins) > room)}
                onClick={() => setSelected(coins)}
              >
                {coins} {coins === 1 ? "coin" : "coins"}
              </button>
            ))}
            <button type="button" className="action-deal" disabled={busy || !canDeal} onClick={() => onDeal(selected)}>
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

function resultTone(view: VideoPokerTableView): string {
  if (!view.result || view.result === "nothing") return "lose";
  if (view.result === "jacks_or_better") return "push";
  return "win";
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
