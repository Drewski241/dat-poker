import type { DatTokenInfo, HandHistoryEntry } from "../api.js";
import { formatDatMojos } from "@dat-poker/shared";
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
          return (
            <li key={hand.handId} className="hand-history-item">
              <p className="hand-history-summary">
                <strong>
                  {playerLabel(hand.winnerId, playerId, seatDisplayFor(hand.winnerId))}
                </strong>
                {hand.winnerId === playerId ? " won " : " won "}
                {formatDatMojos(hand.potMojos, datToken?.ticker)}
                {hand.reason === "showdown" ? " · showdown" : " · fold"}
                <span className="mono hand-history-id"> · {hand.handId.slice(0, 8)}</span>
              </p>
              {you && (
                <p className="muted small hand-history-you">
                  You put in {formatDatMojos(you.totalBetHandMojos, datToken?.ticker)} · stack after{" "}
                  {formatDatMojos(you.stackAfterMojos, datToken?.ticker)}
                </p>
              )}
              <ul className="hand-history-contribs muted small">
                {hand.participants.map((p) => (
                  <li key={p.playerId}>
                    {playerLabel(p.playerId, playerId, seatDisplayFor(p.playerId))}: in pot{" "}
                    {formatDatMojos(p.totalBetHandMojos, datToken?.ticker)} → stack{" "}
                    {formatDatMojos(p.stackAfterMojos, datToken?.ticker)}
                  </li>
                ))}
              </ul>
              {hand.reason === "showdown" && (hand.board?.length ?? 0) > 0 && (
                <CardRow cards={hand.board!} size="sm" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
