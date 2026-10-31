import { useEffect, useState } from "react";
import { SlotMachine } from "./games/slot/SlotMachine.js";
import { PokerApp } from "./PokerApp.js";
import { PlaySessionProvider } from "./play/PlaySessionContext.js";

export type SiteView = "poker" | "slots";

function viewFromPath(): SiteView {
  if (typeof window === "undefined") return "poker";
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/slots" || path.startsWith("/slots/")) return "slots";
  return "poker";
}

export function App() {
  const [view, setView] = useState<SiteView>(viewFromPath);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const go = (next: SiteView) => {
    setView(next);
    const path = next === "slots" ? "/slots" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({ view: next }, "", path);
    }
  };

  useEffect(() => {
    const onPop = () => setView(viewFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <PlaySessionProvider playerId={playerId}>
    <div className={`app app-shell-wide${view === "poker" ? " poker-view" : ""}`}>
      <nav className="site-nav" aria-label="Games">
        <button
          type="button"
          className={`nav-tab${view === "poker" ? " active" : ""}`}
          onClick={() => go("poker")}
        >
          Poker
        </button>
        <button
          type="button"
          className={`nav-tab${view === "slots" ? " active" : ""}`}
          onClick={() => go("slots")}
        >
          Spirit Slots
        </button>
      </nav>
      {view === "slots" ? (
        <SlotMachine ticker="DAT" playerId={playerId} />
      ) : (
        <PokerApp onPlayerIdChange={setPlayerId} />
      )}
    </div>
    </PlaySessionProvider>
  );
}
