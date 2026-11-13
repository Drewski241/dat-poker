import { useEffect, useState } from "react";
import { CASINO_MIN_BUY_IN_MOJOS, formatDatMojos } from "@dat-poker/shared";
import { api, restoreApiAuthToken } from "./api.js";
import type { BlackjackTableView, CalpokerTableView, VideoPokerTableView } from "./api.js";
import { BlackjackTable } from "./components/BlackjackTable.js";
import { CalpokerTable } from "./components/CalpokerTable.js";
import { VideoPokerTable } from "./components/VideoPokerTable.js";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";
import "./casino.css";

type CasinoGame = "blackjack" | "video" | "calpoker";

const TABLE_KEY: Record<CasinoGame, string> = {
  blackjack: "dat-poker-casino-blackjack",
  video: "dat-poker-casino-video",
  calpoker: "dat-poker-casino-calpoker",
};

const BUY_INS = [100_000n, 500_000n, 1_000_000n];

export function CasinoApp({ onNavigate }: { onNavigate: (next: SitePage) => void }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [ticker, setTicker] = useState("DAT");
  const [balance, setBalance] = useState<string | null>(null);
  const [buyIn, setBuyIn] = useState(CASINO_MIN_BUY_IN_MOJOS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<CasinoGame | null>(null);
  const [blackjack, setBlackjack] = useState<BlackjackTableView | null>(null);
  const [video, setVideo] = useState<VideoPokerTableView | null>(null);
  const [calpoker, setCalpoker] = useState<CalpokerTableView | null>(null);

  const refreshBalance = async (id: string) => {
    const account = await api.account(id);
    setBalance(account.balanceMojos);
  };

  useEffect(() => {
    void (async () => {
      restoreApiAuthToken();
      try {
        const dat = await api.datToken();
        setTicker(dat.ticker ?? "DAT");
        if (restoreApiAuthToken()) {
          const me = await api.me();
          setPlayerId(me.playerId);
          setUsername(me.username);
          await refreshBalance(me.playerId);
          await restoreOpenTables();
        }
      } catch {
        /* offline or signed out */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const remember = (next: CasinoGame, tableId: string | null) => {
    try {
      if (tableId) sessionStorage.setItem(TABLE_KEY[next], tableId);
      else sessionStorage.removeItem(TABLE_KEY[next]);
    } catch {
      /* private browsing */
    }
  };

  function storedId(next: CasinoGame): string | null {
    try {
      return sessionStorage.getItem(TABLE_KEY[next]);
    } catch {
      return null;
    }
  }

  async function restoreOpenTables() {
    const blackjackId = storedId("blackjack");
    const videoId = storedId("video");
    const calpokerId = storedId("calpoker");
    if (blackjackId) {
      try {
        setBlackjack(await api.getBlackjack(blackjackId));
        setGame("blackjack");
      } catch {
        remember("blackjack", null);
      }
    }
    if (videoId) {
      try {
        setVideo(await api.getVideoPoker(videoId));
      } catch {
        remember("video", null);
      }
    }
    if (calpokerId) {
      try {
        setCalpoker(await api.getCalpoker(calpokerId));
      } catch {
        remember("calpoker", null);
      }
    }
    if (!blackjackId && videoId) setGame("video");
    if (!blackjackId && !videoId && calpokerId) setGame("calpoker");
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const open = (next: CasinoGame) => {
    if (!playerId) return;
    void run(async () => {
      if (next === "blackjack") {
        const id = storedId("blackjack");
        const current = blackjack ?? (id ? await api.getBlackjack(id).catch(() => null) : null);
        if (current) {
          setBlackjack(current);
          remember("blackjack", current.tableId);
        } else {
          const view = await api.openBlackjack(buyIn.toString());
          setBalance(view.accountBalanceMojos);
          setBlackjack(view);
          remember("blackjack", view.tableId);
        }
      } else if (next === "video") {
        const id = storedId("video");
        const current = video ?? (id ? await api.getVideoPoker(id).catch(() => null) : null);
        if (current) {
          setVideo(current);
          remember("video", current.tableId);
        } else {
          const view = await api.openVideoPoker(buyIn.toString());
          setBalance(view.accountBalanceMojos);
          setVideo(view);
          remember("video", view.tableId);
        }
      } else {
        const id = storedId("calpoker");
        const current = calpoker ?? (id ? await api.getCalpoker(id).catch(() => null) : null);
        if (current) {
          setCalpoker(current);
          remember("calpoker", current.tableId);
        } else {
          const view = await api.openCalpoker(buyIn.toString());
          setBalance(view.accountBalanceMojos);
          setCalpoker(view);
          remember("calpoker", view.tableId);
        }
      }
      setGame(next);
    });
  };

  return (
    <div className="app app-shell-wide">
      <SiteNav page="casino" onNavigate={onNavigate} />
      <header className="casino-head">
        <h1>Casino</h1>
        <p className="muted">
          Blackjack, jacks or better, and a California poker duel. Chips come out of your account and go back when you leave.
        </p>
        {username && balance !== null && (
          <p>
            {username} · account <strong>{formatDatMojos(balance, ticker)}</strong>
          </p>
        )}
      </header>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : !playerId ? (
        <section className="panel">
          <h2>Sign in to play</h2>
          <p className="muted">These tables use the same DAT account as poker and Spirit Slots.</p>
          <a
            href="/play"
            className="cta"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("play");
            }}
          >
            Go to login &amp; Play
          </a>
        </section>
      ) : (
        <>
          {error && <p className="error">{error}</p>}
          <section className="panel">
            <h2>Choose a table</h2>
            <p className="muted small">Buy-in moves DAT from your account onto the table. Leave credits the stack back.</p>
            <div className="row casino-buyins">
              {BUY_INS.map((amount) => (
                <button
                  key={amount.toString()}
                  type="button"
                  className={buyIn === amount ? "primary-bet" : "secondary"}
                  disabled={busy}
                  onClick={() => setBuyIn(amount)}
                >
                  {formatDatMojos(amount, ticker)}
                </button>
              ))}
            </div>
            <div className="casino-shelf">
              <button type="button" className="game-poster poster-bj" disabled={busy} onClick={() => open("blackjack")}>
                <span className="poster-art" aria-hidden="true">
                  <span className="mini-card">
                    A<span>♠</span>
                  </span>
                  <span className="mini-card red">
                    K<span>♥</span>
                  </span>
                </span>
                <span className="poster-copy">
                  <strong>Blackjack</strong>
                  <em>Pays 3 to 2</em>
                  <span>{blackjack ? "Back to the table" : "Take a seat"}</span>
                </span>
              </button>
              <button type="button" className="game-poster poster-vp" disabled={busy} onClick={() => open("video")}>
                <span className="poster-art poster-fan" aria-hidden="true">
                  <span className="mini-card">
                    10<span>♠</span>
                  </span>
                  <span className="mini-card red">
                    J<span>♥</span>
                  </span>
                  <span className="mini-card red">
                    Q<span>♦</span>
                  </span>
                  <span className="mini-card">
                    K<span>♣</span>
                  </span>
                  <span className="mini-card red">
                    A<span>♥</span>
                  </span>
                </span>
                <span className="poster-copy">
                  <strong>Video poker</strong>
                  <em>Jacks or better</em>
                  <span>{video ? "Back to the machine" : "Take a seat"}</span>
                </span>
              </button>
              <button type="button" className="game-poster poster-cp" disabled={busy} onClick={() => open("calpoker")}>
                <span className="poster-art" aria-hidden="true">
                  <span className="mini-card red">
                    A<span>♦</span>
                  </span>
                  <span className="mini-card">
                    K<span>♠</span>
                  </span>
                  <span className="mini-card red">
                    Q<span>♥</span>
                  </span>
                  <span className="mini-card">
                    J<span>♣</span>
                  </span>
                </span>
                <span className="poster-copy">
                  <strong>California poker</strong>
                  <em>Give four, keep the best five</em>
                  <span>{calpoker ? "Back to the duel" : "Take a seat"}</span>
                </span>
              </button>
            </div>
          </section>
          {game === "blackjack" && blackjack && (
            <BlackjackTable
              view={blackjack}
              busy={busy}
              ticker={ticker}
              onBet={(amountMojos) => {
                void run(async () => setBlackjack(await api.betBlackjack(blackjack.tableId, amountMojos)));
              }}
              onAction={(action) => {
                void run(async () => setBlackjack(await api.actBlackjack(blackjack.tableId, action)));
              }}
              onSetLimit={(lossLimitMojos) => {
                void run(async () => setBlackjack(await api.limitBlackjack(blackjack.tableId, lossLimitMojos)));
              }}
              onLeave={() => {
                void run(async () => {
                  const left = await api.leaveBlackjack(blackjack.tableId);
                  setBalance(left.accountBalanceMojos);
                  setBlackjack(null);
                  setGame(null);
                  remember("blackjack", null);
                });
              }}
            />
          )}
          {game === "video" && video && (
            <VideoPokerTable
              view={video}
              busy={busy}
              ticker={ticker}
              onDeal={(coins) => {
                void run(async () => setVideo(await api.dealVideoPoker(video.tableId, coins)));
              }}
              onHold={(index) => {
                void run(async () => setVideo(await api.holdVideoPoker(video.tableId, index)));
              }}
              onDraw={() => {
                void run(async () => setVideo(await api.drawVideoPoker(video.tableId)));
              }}
              onSetLimit={(lossLimitMojos) => {
                void run(async () => setVideo(await api.limitVideoPoker(video.tableId, lossLimitMojos)));
              }}
              onLeave={() => {
                void run(async () => {
                  const left = await api.leaveVideoPoker(video.tableId);
                  setBalance(left.accountBalanceMojos);
                  setVideo(null);
                  setGame(null);
                  remember("video", null);
                });
              }}
            />
          )}
          {game === "calpoker" && calpoker && (
            <CalpokerTable
              view={calpoker}
              busy={busy}
              ticker={ticker}
              onDeal={(amountMojos) => {
                void run(async () => setCalpoker(await api.dealCalpoker(calpoker.tableId, amountMojos)));
              }}
              onSwap={(indexes) => {
                void run(async () => setCalpoker(await api.swapCalpoker(calpoker.tableId, indexes)));
              }}
              onSetLimit={(lossLimitMojos) => {
                void run(async () => setCalpoker(await api.limitCalpoker(calpoker.tableId, lossLimitMojos)));
              }}
              onLeave={() => {
                void run(async () => {
                  const left = await api.leaveCalpoker(calpoker.tableId);
                  setBalance(left.accountBalanceMojos);
                  setCalpoker(null);
                  setGame(null);
                  remember("calpoker", null);
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
