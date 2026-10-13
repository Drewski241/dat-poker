import { useEffect, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { api, type SharedHandView } from "./api.js";
import { CardRow } from "./components/PlayingCard.js";
import { formatHandOutcomeLine } from "./hand-outcome-line.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

function shortPlayer(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function SharedHand({
  handId,
  onNavigate,
}: {
  handId: string;
  onNavigate: (page: SitePage) => void;
}) {
  const [hand, setHand] = useState<SharedHandView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setHand(null);
    void api
      .getSharedHand(handId)
      .then((view) => {
        if (!cancelled) setHand(view);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message || "Hand not found");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handId]);

  return (
    <div className="app landing">
      <header>
        <SiteNav page="sharedHand" onNavigate={onNavigate} />
        <h1>Shared hand</h1>
        <p className="tagline">Public fairness proof — no login required</p>
      </header>

      <section className="panel shared-hand-panel">
        {busy && <p className="muted">Loading hand…</p>}
        {!busy && error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {!busy && hand && (
          <>
            <p className="shared-hand-summary">
              <strong>
                {formatHandOutcomeLine({
                  hand,
                  playerId: "",
                  winnerLabel: shortPlayer(hand.winnerId),
                })}
              </strong>
            </p>
            <p className="mono small muted">
              {hand.handId} · table {hand.tableId.slice(0, 8)}…
            </p>
            <ul className="hand-history-contribs muted small">
              {hand.participants.map((p) => (
                <li key={p.playerId}>
                  {shortPlayer(p.playerId)}: in pot {formatDatMojos(p.totalBetHandMojos)}
                  {BigInt(p.awardedMojos) > 0n
                    ? ` · awarded ${formatDatMojos(p.awardedMojos)}`
                    : ""}
                </li>
              ))}
            </ul>
            {hand.reason === "showdown" && (hand.board?.length ?? 0) > 0 && (
              <CardRow cards={hand.board!} size="sm" label="Board" />
            )}
            {hand.reason === "showdown" && (hand.shown?.length ?? 0) > 0 && (
              <div className="table-room-showdown-strip">
                {hand.shown!.map((shown) => (
                  <div
                    key={shown.playerId}
                    className={`table-room-showdown-entry ${
                      shown.playerId === hand.winnerId ? "is-winner" : "is-loser"
                    }`}
                  >
                    <span className="table-room-showdown-name">
                      {shortPlayer(shown.playerId)}
                      {shown.playerId === hand.winnerId ? " ★" : ""}
                    </span>
                    <CardRow cards={shown.holeCards} size="sm" />
                  </div>
                ))}
              </div>
            )}
            {hand.fairness ? (
              <div className="hand-history-fairness shared-hand-fairness">
                <p>
                  Fairness{" "}
                  <span className={hand.fairness.verified ? "fairness-ok" : "fairness-bad"}>
                    {hand.fairness.verified ? "verified ✓" : "verify failed"}
                  </span>
                </p>
                <p className="muted small">
                  Commit was published before deal; seeds are revealed after the hand so anyone with
                  this link can check the shuffle was fixed.
                </p>
                <p className="mono small fairness-line">commit {hand.fairness.commitHash}</p>
                <p className="mono small fairness-line">server {hand.fairness.serverSeed}</p>
                {Object.entries(hand.fairness.playerSeeds).map(([pid, seed]) => (
                  <p key={pid} className="mono small fairness-line">
                    player {shortPlayer(pid)} {seed}
                  </p>
                ))}
                {hand.fairness.deckPrefix && hand.fairness.deckPrefix.length > 0 && (
                  <p className="mono small fairness-line">
                    deck {hand.fairness.deckPrefix.join(" ")}
                  </p>
                )}
              </div>
            ) : (
              <p className="muted small">No fairness material recorded for this hand.</p>
            )}
            <p className="row">
              <button type="button" className="secondary" onClick={() => onNavigate("play")}>
                Play DAT Poker
              </button>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
