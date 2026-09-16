import { useEffect } from "react";
import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

export function Landing({ onNavigate }: { onNavigate: (next: SitePage) => void }) {
  const isBeta = import.meta.env.VITE_APP_STAGE === "beta";

  useEffect(() => {
    document.title = isBeta ? "DAT Poker beta" : "DAT Poker";
  }, [isBeta]);

  return (
    <div className="app landing">
      {isBeta && (
        <div className="beta-banner" role="status">
          Closed beta — invited testers only. Software under development, not a
          public casino. Tables live in memory and reset when the server restarts.
        </div>
      )}
      <header className="hero">
        <SiteNav page="landing" onNavigate={onNavigate} />
        <p className="eyebrow">No-limit hold&apos;em · DAT · Sage</p>
        <h1>DAT Poker{isBeta ? " beta" : ""}</h1>
        <p className="lede">
          A website you open in the browser, connect Sage, and sit at a 6-max table.
          Play the house when you are alone, or another tester when a seat is open.
        </p>
        <p>
          <a
            className="cta"
            href="/play"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("play");
            }}
          >
            Play poker now!
          </a>
        </p>
      </header>

      <section className="panel">
        <h2>How to play</h2>
        <ol className="how-to">
          <li>
            Install <strong>Sage</strong> (Chia wallet) on your phone or desktop if you
            do not already have it.
          </li>
          <li>
            Click <strong>Play poker now!</strong> Stay on this HTTPS site — WalletConnect
            will not pair over a raw <code>http://</code> IP.
          </li>
          <li>
            Connect Sage, then <strong>Load wallet</strong>. Scan the QR (or paste the
            URI in Sage desktop).
          </li>
          <li>
            <strong>Redeem 5000 DAT</strong> once per UTC day. That is in-game table
            credit, not an on-chain CAT send.
          </li>
          <li>
            <strong>Buy in &amp; join 6-max</strong>, then deal when two seats are filled.
            Fold, check, call, bet, or raise on your turn.
          </li>
        </ol>
      </section>

      <section className="panel">
        <h2>What testers should know</h2>
        <ul className="notes">
          <li>Share this site only with people you invited. It is not a worldwide launch.</li>
          <li>
            Default buy-in is 1000 DAT. Withdraw back to Sage stays locked until you
            complete one hand per DAT token of that buy-in.
          </li>
          <li>
            Server restarts wipe tables and in-game balances. Keep the stakes at test
            size.
          </li>
          <li>DAT stays in Sage until on-chain escrow is wired. This host does not hold treasury keys.</li>
        </ul>
      </section>

      <footer>
        <p>
          DAT Governance Token on Chia.{" "}
          <a href="/play" onClick={(event) => { event.preventDefault(); onNavigate("play"); }}>
            Open the table
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
