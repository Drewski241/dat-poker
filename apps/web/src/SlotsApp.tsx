import { useEffect, useState } from "react";
import type { SlotGameId } from "@dat-poker/shared";
import { SLOT_GAMES } from "@dat-poker/shared";
import { formatDatMojos } from "@dat-poker/shared";
import { api, restoreApiAuthToken } from "./api.js";
import { AltSlotMachine } from "./games/slot/AltSlotMachine.js";
import { SlotMachine } from "./games/slot/SlotMachine.js";
import { PlaySessionProvider } from "./play/PlaySessionContext.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";
import "./games/slot/slot.css";

export function slotsPathToGameId(pathname: string): SlotGameId | "lobby" {
  const parts = pathname.replace(/\/+$/, "").split("/");
  const slug = parts[2];
  if (!slug || slug === "") return "lobby";
  if (slug in SLOT_GAMES) return slug as SlotGameId;
  return "lobby";
}

export function slotGameHref(gameId: SlotGameId): string {
  return `/slots/${gameId}`;
}

export function SlotsApp({
  onNavigate,
  pathname,
}: {
  onNavigate: (next: SitePage) => void;
  pathname: string;
}) {
  const view = slotsPathToGameId(pathname);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [ticker, setTicker] = useState("DAT");
  const [catalog, setCatalog] = useState<
    { id: string; title: string; tagline: string; emoji: string; progressiveJackpotMojos: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      restoreApiAuthToken();
      try {
        const [dat, cat] = await Promise.all([api.datToken(), api.getSlotsCatalog()]);
        setTicker(dat.ticker ?? "DAT");
        setCatalog(cat.games);
        if (restoreApiAuthToken()) {
          const me = await api.me();
          setPlayerId(me.playerId);
          setUsername(me.username);
        }
      } catch {
        /* offline */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const goLobby = () => {
    window.history.pushState({}, "", "/slots");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <PlaySessionProvider playerId={playerId}>
      <div className="app app-shell-wide">
        <SiteNav page="slots" onNavigate={onNavigate} />
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !playerId ? (
          <section className="panel">
            <h2>Sign in to play DAT slots</h2>
            <p className="muted">Five machines · five separate progressive jackpots · one account balance.</p>
            <a href="/play" className="cta" onClick={(e) => { e.preventDefault(); onNavigate("play"); }}>
              Go to login &amp; Play
            </a>
          </section>
        ) : view === "lobby" ? (
          <>
            <p className="muted small">
              Signed in as <strong>{username ?? playerId}</strong>
            </p>
            <h1 className="slot-lobby-title">DAT Slot Floor</h1>
            <p className="muted">Each game feeds its own progressive pot.</p>
            <div className="slot-lobby-grid">
              {(catalog.length > 0
                ? catalog
                : (Object.keys(SLOT_GAMES) as SlotGameId[]).map((id) => ({
                    ...SLOT_GAMES[id],
                    progressiveJackpotMojos: "100000",
                  }))
              ).map((g) => {
                const id = g.id as SlotGameId;
                const meta = SLOT_GAMES[id];
                const pot = g.progressiveJackpotMojos;
                return (
                  <a
                    key={id}
                    href={slotGameHref(id)}
                    className="slot-lobby-card panel"
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, "", slotGameHref(id));
                      window.dispatchEvent(new PopStateEvent("popstate"));
                    }}
                  >
                    <span className="slot-lobby-emoji">{meta.emoji}</span>
                    <h2>{meta.title}</h2>
                    <p className="muted small">{meta.tagline}</p>
                    <p className="slot-lobby-pot">
                      Progressive: <strong>{formatDatMojos(pot, ticker)}</strong>
                    </p>
                  </a>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="slot-back">
              <button type="button" className="slot-paytable-link" onClick={goLobby}>
                ← All slot games
              </button>
            </p>
            {view === "spirit" ? (
              <SlotMachine ticker={ticker} playerId={playerId} />
            ) : (
              <AltSlotMachine gameId={view} ticker={ticker} playerId={playerId} />
            )}
          </>
        )}
      </div>
    </PlaySessionProvider>
  );
}
