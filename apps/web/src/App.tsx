import { useEffect, useState } from "react";
import { SlotMachine } from "./games/slot/SlotMachine.js";
import { PokerApp } from "./PokerApp.js";
import { PlaySessionProvider } from "./play/PlaySessionContext.js";
import { pageToPath, pathToPage, type SitePage } from "./site-route.js";

function viewFromPath(): SitePage {
  if (typeof window === "undefined") return "play";
  return pathToPage(window.location.pathname);
}

export function App() {
  const [view, setView] = useState<SitePage>(viewFromPath);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const go = (next: SitePage) => {
    if (next === "feedback" || next === "privacy" || next === "landing") {
      next = "play";
    }
    setView(next);
    const path = pageToPath(next);
    if (window.location.pathname !== path) {
      window.history.pushState({ view: next }, "", path);
    }
  };

  useEffect(() => {
    const onPop = () => setView(viewFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const isSlots = view === "slots";
  const isPlay = view === "play";

  return (
    <PlaySessionProvider playerId={playerId}>
      <div className={`app app-shell-wide${isPlay ? " poker-view" : ""}`}>
        <nav className="site-nav" aria-label="Games">
          <button
            type="button"
            className={`nav-tab${isPlay ? " active" : ""}`}
            onClick={() => go("play")}
          >
            Poker
          </button>
          <button
            type="button"
            className={`nav-tab slot-tab${isSlots ? " active" : ""}`}
            onClick={() => go("slots")}
          >
            ✨ Spirit Slots
          </button>
        </nav>
        {isSlots ? (
          <SlotMachine ticker="DAT" playerId={playerId} />
        ) : (
          <PokerApp onPlayerIdChange={setPlayerId} />
        )}
      </div>
    </PlaySessionProvider>
  );
}
