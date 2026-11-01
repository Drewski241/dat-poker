import { useEffect, useState } from "react";
import { api, restoreApiAuthToken, type DatTokenInfo } from "./api.js";
import { SlotMachine } from "./games/slot/SlotMachine.js";
import { PlaySessionProvider } from "./play/PlaySessionContext.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

export function SpiritSlotsApp({ onNavigate }: { onNavigate: (next: SitePage) => void }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [datToken, setDatToken] = useState<DatTokenInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      restoreApiAuthToken();
      try {
        const dat = await api.datToken();
        setDatToken(dat);
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

  return (
    <PlaySessionProvider playerId={playerId}>
      <div className="app app-shell-wide">
        <SiteNav page="slots" onNavigate={onNavigate} />
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !playerId ? (
          <section className="panel">
            <h2>Sign in to play Spirit Slots</h2>
            <p className="muted">
              Create an account or sign in on the Play page first. Poker and slots share the same
              daily redeem and table stack.
            </p>
            <p>
              <a
                href="/play"
                className="cta"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate("play");
                }}
              >
                Go to login &amp; Play
              </a>
            </p>
          </section>
        ) : (
          <>
            <p className="muted small">
              Signed in as <strong>{username ?? playerId}</strong> · spins use your table account DAT
            </p>
            <SlotMachine ticker={datToken?.ticker ?? "DAT"} playerId={playerId} />
          </>
        )}
      </div>
    </PlaySessionProvider>
  );
}
