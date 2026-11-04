import type { HybridSnapshot } from "../api.js";

const TITLES: Record<HybridSnapshot["mode"], string> = {
  waiting: "Waiting for players",
  "chia-gaming-heads-up": "Chia Gaming heads-up",
  "dat-table-vault": "DAT table vault",
};

export function HybridStatus({ hybrid }: { hybrid: HybridSnapshot }) {
  return (
    <div className="hybrid">
      <p>
        <strong>{TITLES[hybrid.mode]}</strong>
        {" · "}
        wager {hybrid.wagerAsset.toUpperCase()}
        {" · "}
        XCH stake {hybrid.xchWagerMojos}
      </p>
      <p className="muted small">{hybrid.reason}</p>
      {hybrid.session && (
        <p className="mono small">
          {hybrid.session.rules} · {hybrid.session.gameRelayUrl}
        </p>
      )}
      {hybrid.vault && (
        <p className="small">
          Vault {hybrid.vault.status === "open" ? "open" : "frozen for heads-up"}
          {hybrid.vault.pendingConsent
            ? ` · co-signed ${hybrid.vault.pendingConsent.signedBy.length} of ${hybrid.vault.seats.length}`
            : ""}
          {hybrid.vault.lastCoSigned ? " · last hand co-signed" : ""}
        </p>
      )}
    </div>
  );
}
