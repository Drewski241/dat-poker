import { useEffect, useRef, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import type { DatTokenInfo, HandResult } from "../api.js";
import {
  formatHandCategory,
  runoutHoldMs,
  runoutStreets,
  runoutVisibleCount,
  type RunoutStreet,
} from "../all-in-runout.js";
import { CardRow, PlayingCard } from "./PlayingCard.js";

type Props = {
  result: HandResult;
  fromBoardLen: number;
  datToken: DatTokenInfo | null;
  playerId: string;
  playerLabel: (id: string, youId: string | null, display?: string) => string;
  seatDisplay: (id: string) => string | undefined;
  onFinished: () => void;
};

export function AllInRunout({
  result,
  fromBoardLen,
  datToken,
  playerId,
  playerLabel,
  seatDisplay,
  onFinished,
}: Props) {
  const streets = runoutStreets(fromBoardLen);
  const [index, setIndex] = useState(0);
  const street: RunoutStreet = streets[Math.min(index, streets.length - 1)] ?? "hands";
  const visible = (result.board ?? []).slice(0, runoutVisibleCount(street, fromBoardLen));
  const revealHands = street === "hands";
  const lost = result.winnerId !== playerId;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const finishedRef = useRef(false);

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinishedRef.current();
  };

  useEffect(() => {
    if (index >= streets.length - 1) {
      const done = window.setTimeout(finish, runoutHoldMs("hands", lost));
      return () => window.clearTimeout(done);
    }
    const wait = window.setTimeout(() => setIndex((n) => n + 1), runoutHoldMs(street, lost));
    return () => window.clearTimeout(wait);
  }, [index, street, streets.length, lost]);

  return (
    <div
      className={`all-in-runout all-in-runout-${street}${lost ? " all-in-runout-lost" : " all-in-runout-won"}`}
      role="img"
      aria-label={lost ? "All-in runout — you lost" : "All-in runout — you won"}
    >
      <ActionSticker kind={street === "hands" ? "allin" : street} />
      <p className="all-in-runout-banner">
        {street === "allin" ? "ALL IN" : street === "hands" ? "Showdown" : street.toUpperCase()}
        {street !== "hands" ? <span> · all-in</span> : null}
      </p>
      <div className="all-in-runout-board">
        {Array.from({ length: 5 }, (_, i) => {
          const card = visible[i];
          return card ? (
            <span key={`${card.rank}${card.suit}-${i}`} className="all-in-runout-card-in">
              <PlayingCard card={card} size="md" />
            </span>
          ) : (
            <span key={`slot-${i}`} className="playing-card playing-card-md playing-card-slot" aria-hidden="true" />
          );
        })}
      </div>
      {revealHands && (result.shown?.length ?? 0) > 0 && (
        <div className="table-room-showdown-strip all-in-runout-hands">
          {result.shown!.map((shown) => (
            <div
              key={shown.playerId}
              className={`table-room-showdown-entry ${shown.playerId === result.winnerId ? "is-winner" : "is-loser"}`}
            >
              <span className="table-room-showdown-name">
                {playerLabel(shown.playerId, playerId, seatDisplay(shown.playerId))}
                {shown.playerId === result.winnerId ? " ★" : shown.playerId === playerId ? " (you)" : ""}
              </span>
              <CardRow cards={shown.holeCards} size="sm" />
              <span className="all-in-runout-cat">{formatHandCategory(shown.category)}</span>
            </div>
          ))}
        </div>
      )}
      {revealHands && (
        <p className="all-in-runout-winner">
          {lost ? "You lost · " : ""}
          {playerLabel(result.winnerId, playerId, seatDisplay(result.winnerId))}
          {result.winnerId === playerId ? " win " : " wins "}
          {formatDatMojos(result.potMojos, datToken?.ticker)}
        </p>
      )}
      <button type="button" className="all-in-runout-skip" onClick={finish}>
        Skip
      </button>
    </div>
  );
}

function ActionSticker({ kind }: { kind: RunoutStreet }) {
  if (kind === "flop") {
    return (
      <div className="action-gif action-gif-flop" aria-hidden="true">
        <span className="action-gif-burst" />
        <span className="action-gif-burst action-gif-burst-2" />
        <strong>FLOP</strong>
      </div>
    );
  }
  if (kind === "turn") {
    return (
      <div className="action-gif action-gif-turn" aria-hidden="true">
        <span className="action-gif-chip" />
        <span className="action-gif-chip action-gif-chip-2" />
        <strong>TURN</strong>
      </div>
    );
  }
  if (kind === "river") {
    return (
      <div className="action-gif action-gif-river" aria-hidden="true">
        <span className="action-gif-bolt" />
        <span className="action-gif-bolt action-gif-bolt-2" />
        <strong>RIVER</strong>
      </div>
    );
  }
  return (
    <div className="action-gif action-gif-allin" aria-hidden="true">
      <span className="action-gif-fire" />
      <span className="action-gif-fire action-gif-fire-2" />
      <strong>ALL IN</strong>
    </div>
  );
}
