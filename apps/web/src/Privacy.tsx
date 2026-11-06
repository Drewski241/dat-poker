import { SiteNav } from "./SiteNav.js";
import type { SitePage } from "./site-route.js";

export function Privacy({ onNavigate }: { onNavigate: (page: SitePage) => void }) {
  return (
    <div className="app landing">
      <header>
        <SiteNav page="privacy" onNavigate={onNavigate} />
        <h1>Privacy</h1>
        <p className="tagline">DAT Poker beta — how we handle account data</p>
      </header>

      <section className="panel legal-doc">
        <p className="muted small">Last updated: September 2026. Closed beta at datspiritpoker.com.</p>

        <h2>Who operates this service</h2>
        <p>
          DAT Poker beta is operated for closed testing of an online poker platform. Contact the operator via{" "}
          <a href="/feedback" onClick={(e) => { e.preventDefault(); onNavigate("feedback"); }}>
            beta feedback
          </a>
          .
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account:</strong> username, email address, password (stored as a one-way scrypt hash, not
            plaintext).
          </li>
          <li>
            <strong>Security:</strong> email verification and password-reset data (hashed codes with expiry),
            optional play-eligibility country attestation, terms acceptance record.
          </li>
          <li>
            <strong>Gameplay:</strong> in-game ledger balances and play-through progress on the game server.
          </li>
          <li>
            <strong>Optional wallet:</strong> if you connect Sage, wallet address and signatures used for
            withdraw/link flows — not for marketing.
          </li>
          <li>
            <strong>Feedback:</strong> comments, optional contact text, and screenshots you submit on /feedback.
          </li>
        </ul>

        <h2>Email</h2>
        <p>
          We send <strong>transactional email only</strong>: verification codes when you register or add an email,
          and password reset codes when you request a reset. We do not send promotional newsletters. You opt in by
          providing your address during account setup; entering the verification code confirms you control that
          inbox.
        </p>

        <h2>Where data is stored</h2>
        <p>
          Beta data is stored on the game application host (Amazon EC2 in the operator&apos;s AWS region): account
          records, ledger, feedback uploads, and terms acceptance logs. Files are not sold to third parties or used
          to build marketing lists.
        </p>

        <h2>Retention</h2>
        <p>
          Account and ledger data persist for the beta period so balances and progress are not lost on redeploy.
          Verification codes expire within hours. Terms acceptance is retained for the period stated at sign-in.
        </p>

        <h2>Your choices</h2>
        <p>
          Do not create an account if you do not want us to store the data above. For beta account removal, contact
          the operator via feedback.
        </p>

        <h2>Changes</h2>
        <p>We may update this page; material changes will be reflected here with an updated date.</p>
      </section>
    </div>
  );
}
