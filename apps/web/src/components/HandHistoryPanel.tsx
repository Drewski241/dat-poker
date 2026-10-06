import type { DatTokenInfo, HandHistoryEntry } from "../api.js";
import { formatDatMojos } from "@dat-poker/shared";
import { formatHandOutcomeLine } from "../hand-outcome-line.js";
import { participantAwardMojos } from "../hand-result-copy.js";
import { CardRow } from "./PlayingCard.js";

type Props = {
  datToken: DatTokenInfo | null;
  playerId: string;
  hands: HandHistoryEntry[];
  playerLabel: (id: string, youId: string | null, display?: string) => string;
  seatDisplayFor: (id: string) => string | undefined;
};

export function HandHistoryPanel({
  datToken,
  playerId,
  hands,
  playerLabel,
  seatDisplayFor,
}: Props) {
  if (hands.length === 0) {
    return (
      <p className="muted small hand-history-empty">
        No completed hands recorded at this table yet (history is kept until the server restarts).
      </p>
    );
  }

  return (
    <section className="hand-history" aria-label="Recent hand history">
      <ul className="hand-history-list">
        {hands.map((hand) => {
          const you = hand.participants.find((p) => p.playerId === playerId);
          const winnerLabel = playerLabel(hand.winnerId, playerId, seatDisplayFor(hand.winnerId));
          return (
            <li key={hand.handId} className="hand-history-item">
              <p className="hand-history-summary">
                <strong>
                  {formatHandOutcomeLine({
                    hand,
                    playerId,
                    winnerLabel,
                    ticker: datToken?.ticker,
                  })}
                </strong>
                <span className="mono hand-history-id"> · {hand.handId.slice(0, 8)}</span>
              </p>
              {you && (
                <p className="muted small hand-history-you">
                  You put in {formatDatMojos(you.totalBetHandMojos, datToken?.ticker)} · stack after{" "}
                  {formatDatMojos(you.stackAfterMojos, datToken?.ticker)}
                </p>
              )}
              <ul className="hand-history-contribs muted small">
                {hand.participants.map((p) => {
                  const award = participantAwardMojos(p);
                  return (
                    <li key={p.playerId}>
                      {playerLabel(p.playerId, playerId, seatDisplayFor(p.playerId))}: in pot{" "}
                      {formatDatMojos(p.totalBetHandMojos, datToken?.ticker)}
                      {award > 0n ? ` · awarded ${formatDatMojos(award.toString(), datToken?.ticker)}` : ""} →
                      stack {formatDatMojos(p.stackAfterMojos, datToken?.ticker)}
                    </li>
                  );
                })}
              </ul>
              {hand.reason === "showdown" && (hand.board?.length ?? 0) > 0 && (
                <CardRow cards={hand.board!} size="sm" />
              )}
              {hand.reason === "showdown" && (hand.shown?.length ?? 0) > 0 && (
                <div className="table-room-showdown-strip">
                  {hand.shown!.map((shown) => {
                    const part = hand.participants.find((p) => p.playerId === shown.playerId);
                    const awarded = part != null && participantAwardMojos(part) > 0n;
                    return (
                      <div
                        key={shown.playerId}
                        className={`table-room-showdown-entry ${awarded || shown.playerId === hand.winnerId ? "is-winner" : "is-loser"}`}
                      >
                        <span className="table-room-showdown-name">
                          {playerLabel(shown.playerId, playerId, seatDisplayFor(shown.playerId))}
                          {awarded ? " ★" : ""}
                        </span>
                        <CardRow cards={shown.holeCards} size="sm" />
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
