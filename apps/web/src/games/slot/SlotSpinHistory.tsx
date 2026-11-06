import { useEffect, useState } from "react";
import { formatDatMojos, type SlotGameId } from "@dat-poker/shared";
import { api } from "../../api.js";
import { formatSlotHistoryEntry, type SlotHistoryEntry } from "./slot-history.js";

export function SlotSpinHistory({
  gameId,
  playerId,
  ticker,
  revision,
}: {
  gameId: SlotGameId;
  playerId: string | null;
  ticker: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [spins, setSpins] = useState<SlotHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !playerId) return;
    let cancelled = false;
    void api.getSlotHistory(gameId).then(
      (body) => {
        if (!cancelled) {
          setSpins(body.spins);
          setError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, playerId, gameId, revision]);

  if (!playerId) return null;

  return (
    <section className="slot-history panel" aria-label="Spin history">
      <button
        type="button"
        className="slot-paytable-link"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "Hide spin history" : "Spin history"}
      </button>
      {open && error && <p className="banner error">{error}</p>}
      {open && !error && spins.length === 0 && (
        <p className="muted small">No spins on this game yet.</p>
      )}
      {open && spins.length > 0 && (
        <ol className="slot-history-list">
          {spins.map((spin) => {
            const when = new Date(spin.at);
            const time = Number.isNaN(when.getTime())
              ? spin.at
              : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return (
              <li key={spin.id}>
                <p className="slot-history-meta">
                  <time dateTime={spin.at}>{time}</time>
                  <span> · {formatDatMojos(spin.betMojos, ticker)} wager</span>
                </p>
                <p>{formatSlotHistoryEntry(spin, ticker)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
