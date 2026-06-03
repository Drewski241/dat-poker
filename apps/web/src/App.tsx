import { useCallback, useEffect, useState } from "react";
import { api, type HandState, type PlayerAction } from "./api.js";

const BUY_IN = "5000000000000";
const PLAYERS = [
  { id: "alice", seat: 0 },
  { id: "bob", seat: 1 },
] as const;

function cardLabel(card: { rank: string; suit: string }): string {
  const suit = { c: "♣", d: "♦", h: "♥", s: "♠" }[card.suit] ?? card.suit;
  return `${card.rank}${suit}`;
}

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [hand, setHand] = useState<HandState | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false));
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }, []);

  const refreshTable = useCallback(async (id: string) => {
    const t = await api.getTable(id);
    setHand(t.hand);
  }, []);

  const createAndSeat = () =>
    run("Creating table…", async () => {
      const { tableId: id } = await api.createTable();
      for (const p of PLAYERS) {
        await api.seatPlayer(id, p.id, p.seat, BUY_IN);
      }
      setTableId(id);
      await refreshTable(id);
    });

  const startHandFlow = () => {
    if (!tableId) return;
    run("Starting hand…", async () => {
      await api.startHand(tableId);
      for (const p of PLAYERS) {
        await api.submitSeed(tableId, p.id);
      }
      const { hand: dealt } = await api.deal(tableId);
      setHand(dealt);
    });
  };

  const sendAction = (playerId: string, action: PlayerAction) => {
    if (!tableId) return;
    run(`${playerId} ${action}`, async () => {
      const { hand: next } = await api.action(tableId, playerId, action);
      setHand(next);
      if (!next) await refreshTable(tableId);
    });
  };

  const actionSeatPlayer =
    hand?.actionSeat != null
      ? hand.players.find((p) => p.seatIndex === hand.actionSeat && !p.folded)
      : null;

  return (
    <div className="app">
      <header>
        <h1>DAT Poker</h1>
        <p className="tagline">NLHE dev table — REST API client (Phase 1 MVP)</p>
        <p className={`api-status ${apiOk ? "ok" : apiOk === false ? "err" : ""}`}>
          API: {apiOk === null ? "checking…" : apiOk ? "connected" : "offline (run pnpm dev:api)"}
        </p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {status && <div className="banner info">{status}</div>}

      <section className="panel">
        <h2>Table</h2>
        {!tableId ? (
          <button type="button" disabled={busy || !apiOk} onClick={createAndSeat}>
            Create table &amp; seat Alice / Bob
          </button>
        ) : (
          <p className="mono">Table ID: {tableId}</p>
        )}
      </section>

      {tableId && (
        <section className="panel">
          <h2>Hand</h2>
          {!hand ? (
            <button type="button" disabled={busy} onClick={startHandFlow}>
              Start hand (commit-reveal deal)
            </button>
          ) : (
            <>
              <p>
                Street: <strong>{hand.street}</strong> · Pot: <strong>{hand.potMojos}</strong> mojos
              </p>
              {hand.board.length > 0 && (
                <p>Board: {hand.board.map(cardLabel).join(" ")}</p>
              )}
              <ul className="players">
                {hand.players.map((p) => (
                  <li key={p.playerId}>
                    <strong>{p.playerId}</strong> (seat {p.seatIndex})
                    {p.folded ? " — folded" : ""}
                    {p.holeCards.length > 0 && (
                      <span className="cards"> {p.holeCards.map(cardLabel).join(" ")}</span>
                    )}
                    <span className="stack"> stack {p.stackMojos}</span>
                  </li>
                ))}
              </ul>
              {actionSeatPlayer && (
                <div className="actions">
                  <span>Action: {actionSeatPlayer.playerId}</span>
                  {(["fold", "check", "call"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={busy}
                      onClick={() => sendAction(actionSeatPlayer.playerId, a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}
              {!actionSeatPlayer && hand && (
                <button type="button" disabled={busy} onClick={startHandFlow}>
                  New hand
                </button>
              )}
            </>
          )}
        </section>
      )}

      <footer>
        <p>
          Run <code>pnpm dev:api</code> and <code>pnpm dev:web</code>. Vite proxies API routes in dev.
        </p>
      </footer>
    </div>
  );
}
