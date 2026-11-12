import { useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { BlackjackTableView } from "../api.js";
import { ChipStack } from "./ChipStack.js";
import { PlayingCard } from "./PlayingCard.js";
import { SessionReminder } from "./SessionReminder.js";

const CHIP_MOJOS = [10_000n, 25_000n, 50_000n, 100_000n];

export function BlackjackTable({
  view,
  busy,
  ticker,
  onBet,
  onAction,
  onSetLimit,
  onLeave,
}: {
  view: BlackjackTableView;
  busy: boolean;
  ticker?: string;
  onBet: (amountMojos: string) => void;
  onAction: (action: "hit" | "stand" | "double" | "split") => void;
  onSetLimit: (lossLimitMojos: string | null) => void;
  onLeave: () => void;
}) {
  const [selected, setSelected] = useState(10_000n);
  const stack = BigInt(view.stackMojos);
  const maxBet = BigInt(view.maxBetMojos);
  const room = view.lossRoomMojos === null ? null : BigInt(view.lossRoomMojos);
  const betting = view.phase !== "acting";
  const blocked = view.limitReached;
  const result = view.phase === "done" ? resultLine(view, ticker) : null;

  return (
    <div className="bj-wrap">
      <section className="bj-felt" aria-label="Blackjack table">
        <p className="bj-rule">Blackjack pays 3 to 2 · dealer stands on 17</p>
        <div className="bj-spot">
          <p className="bj-label">Dealer{view.dealerTotal ? ` · ${view.dealerTotal}` : ""}</p>
          <div className="hole-cards">
            {view.dealerCards.map((card, index) => (
              <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} delayMs={index * 80} />
            ))}
            {view.phase === "acting" && <PlayingCard faceDown delayMs={80} />}
          </div>
        </div>
        <div className="bj-hands">
          {view.hands.map((hand, index) => (
            <div key={index} className={`bj-spot ${hand.active ? "acting" : ""}`}>
              <p className="bj-label">
                {view.hands.length > 1 ? `Hand ${index + 1}` : view.displayName} · {hand.total}
              </p>
              <div className="hole-cards">
                {hand.cards.map((card, cardIndex) => (
                  <PlayingCard key={`${card.rank}${card.suit}${cardIndex}`} card={card} delayMs={cardIndex * 80} />
                ))}
              </div>
              <ChipStack mojos={hand.betMojos} ticker={ticker} />
            </div>
          ))}
          {view.hands.length === 0 && <p className="felt-wait">Place a bet</p>}
        </div>
        {result && <p className="bj-result">{result}</p>}
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
          canEdit={betting}
          busy={busy}
          ticker={ticker}
          onSetLimit={onSetLimit}
        />
        <p>
          Stack <strong>{formatDatMojos(view.stackMojos, ticker)}</strong>
        </p>
        {betting ? (
          <div className="actions">
            {CHIP_MOJOS.map((chip) => (
              <button
                key={chip.toString()}
                type="button"
                className={selected === chip ? "primary-bet" : "secondary"}
                disabled={busy || blocked || chip > stack || chip > maxBet || (room !== null && chip > room)}
                onClick={() => setSelected(chip)}
              >
                {formatDatMojos(chip, ticker)}
              </button>
            ))}
            <button
              type="button"
              disabled={busy || blocked || selected > stack || (room !== null && selected > room)}
              onClick={() => onBet(selected.toString())}
            >
              {view.phase === "done" ? "Deal again" : "Deal"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={onLeave}>
              Leave table
            </button>
          </div>
        ) : (
          <div className="actions">
            {view.actions.hit && (
              <button type="button" disabled={busy} onClick={() => onAction("hit")}>
                hit
              </button>
            )}
            {view.actions.stand && (
              <button type="button" disabled={busy} onClick={() => onAction("stand")}>
                stand
              </button>
            )}
            {view.actions.double && (
              <button type="button" className="primary-bet" disabled={busy} onClick={() => onAction("double")}>
                double
              </button>
            )}
            {view.actions.split && (
              <button type="button" disabled={busy} onClick={() => onAction("split")}>
                split
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function resultLine(view: BlackjackTableView, ticker?: string): string {
  return view.hands
    .map((hand, index) => {
      const name = view.hands.length > 1 ? `Hand ${index + 1} ` : "";
      const won = formatDatMojos(hand.profitMojos.startsWith("-") ? hand.profitMojos.slice(1) : hand.profitMojos, ticker);
      if (hand.outcome === "blackjack") return `${name}blackjack pays ${won}`;
      if (hand.outcome === "win") return `${name}you win ${won}`;
      if (hand.outcome === "push") return `${name}push`;
      if (hand.outcome === "bust") return `${name}bust`;
      return `${name}dealer wins`;
    })
    .join(" · ");
}
