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
          public casino. Open tables reset on restart; your account DAT and
          play-through progress are kept.
        </div>
      )}
      <header className="hero">
        <SiteNav page="landing" onNavigate={onNavigate} />
        <p className="eyebrow">No-limit hold&apos;em · DAT · accounts</p>
        <h1>DAT Poker{isBeta ? " beta" : ""}</h1>
        <p className="lede">
          A website you open in the browser. Create an account, redeem funded DAT,
          and sit at a 6-max table. Connect Sage only if you want DAT in your wallet.
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
            Click <strong>Play poker now!</strong> and <strong>Create account</strong> (or sign in).
            Add an email if you want to reset a forgotten password. You do not need Sage to play.
          </li>
          <li>
            <strong>Redeem 5000 DAT</strong> once per UTC day. That is in-game table
            credit we fund, not an on-chain CAT send.
          </li>
          <li>
            <strong>Buy in &amp; join 6-max</strong>, then deal when two seats are filled.
            Fold, check, call, bet, or raise on your turn.
          </li>
          <li>
            Connect <strong>Sage</strong> later only if you want to withdraw DAT to your
            wallet. Pairing signs a message and cannot send coins.
          </li>
        </ol>
      </section>

      <section className="panel">
        <h2>What testers should know</h2>
        <ul className="notes">
          <li>Share this site only with people you invited. It is not a worldwide launch.</li>
          <li>
            Default buy-in is 1000 DAT. Each completed hand unlocks 1 DAT to withdraw.
            Progress is kept across redeploys. Sage is optional until you withdraw DAT to a wallet.
          </li>
          <li>
            Server restarts wipe open tables, but your account DAT (redeemed
            credits and cashed-out stacks) and play-through unlocks are kept on the host.
          </li>
          <li>DAT stays in Sage until on-chain escrow is wired. This host does not hold treasury keys.</li>
          <li>
            Pairing only asks Sage to <strong>sign messages</strong>. The site cannot send DAT or XCH
            from your wallet.
          </li>
        </ul>
      </section>

      <footer>
        <p>
          DAT Governance Token on Chia.{" "}
          <a href="/play" onClick={(event) => { event.preventDefault(); onNavigate("play"); }}>
            Open the table
          </a>
          {" · "}
          <a href="/feedback" onClick={(event) => { event.preventDefault(); onNavigate("feedback"); }}>
            Send feedback
          </a>
          {" · "}
          <a href="/privacy" onClick={(event) => { event.preventDefault(); onNavigate("privacy"); }}>
            Privacy
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
