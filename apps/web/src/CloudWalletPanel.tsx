import { useEffect, useState } from "react";
import { formatDatMojos } from "@dat-poker/shared";
import { api, type WithdrawResult } from "./api.js";

const REGISTER_REDIRECT = "https://datspiritpoker.com/v1/wallet/cloud/callback";

type CloudStatus = {
  configured: boolean;
  connected: boolean;
  walletName: string | null;
  address: string | null;
};

export function CloudWalletPanel({
  playerId,
  unlockedMojos,
  ticker,
  busy,
  run,
  onWithdrawn,
  onAccountRefresh,
}: {
  playerId: string;
  unlockedMojos: bigint;
  ticker?: string;
  busy: boolean;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  onWithdrawn: (result: WithdrawResult) => void;
  onAccountRefresh: (playerId: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [offer, setOffer] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cloud = params.get("cloud");
    if (cloud === "connected") setBanner("Chia Cloud Wallet connected.");
    if (cloud === "error") setBanner(params.get("message") || "Cloud Wallet connect failed.");
    if (cloud) {
      params.delete("cloud");
      params.delete("message");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .cloudWalletStatus()
      .then((row) => {
        if (!cancelled) setStatus(row);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const refresh = async () => {
    setStatus(await api.cloudWalletStatus());
  };

  return (
    <section className="panel">
      <h2>Withdraw DAT (Chia Cloud Wallet)</h2>
      <p className="muted small">
        Treasury Sage still builds the DAT offer. Cloud Wallet is only where that offer is delivered.
        Connect stays off until this site’s OAuth app is registered and approved.
      </p>
      {banner && (
        <p className={banner.includes("connected") && !banner.includes("did not") ? "ok-text" : "banner error"}>
          {banner}
        </p>
      )}
      {status && !status.configured && (
        <>
          <p>
            Register an OAuth app in Chia Cloud Wallet under <strong>Settings → OAuth Apps</strong>.
            New apps can stay pending until Cloud Wallet approves them. Until the client id is on this
            host, players cannot connect.
          </p>
          <p className="muted small">Redirect URI, exactly:</p>
          <p className="mono">{REGISTER_REDIRECT}</p>
          <p className="muted small">
            Scopes: wallet.read, offer.read, offer.accept, offline_access. Then set
            CHIA_CLOUD_WALLET_CLIENT_ID on the API host. Add CHIA_CLOUD_WALLET_CLIENT_SECRET only if the
            portal issued one. The secret stays on the server.
          </p>
        </>
      )}
      {status?.configured && !status.connected && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run("Opening Chia Cloud Wallet…", async () => {
              const started = await api.startCloudWallet();
              window.location.assign(started.authorizeUrl);
            });
          }}
        >
          Connect Chia Cloud Wallet
        </button>
      )}
      {status?.connected && status.address && (
        <>
          <p className="ok-text">
            {status.walletName ?? "Cloud Wallet"} connected
          </p>
          <p className="mono">Vault address: {status.address}</p>
          {unlockedMojos > 0n ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run("Sending unlocked DAT to Cloud Wallet…", async () => {
                  const result = await api.withdraw(null, playerId, {
                    fromAccount: true,
                    toCloudWallet: true,
                  });
                  setBanner(result.note);
                  setOffer(result.cloudOfferError && result.offer ? result.offer : null);
                  onWithdrawn(result);
                  await onAccountRefresh(playerId);
                });
              }}
            >
              Withdraw {formatDatMojos(unlockedMojos.toString(), ticker)} unlocked to Cloud Wallet
            </button>
          ) : (
            <p className="muted small">Play sit-n-go or cash hands to unlock DAT before withdrawing.</p>
          )}
          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                void run("Disconnecting Cloud Wallet…", async () => {
                  setStatus(await api.disconnectCloudWallet());
                  setOffer(null);
                  setBanner("Cloud Wallet disconnected on this site.");
                });
              }}
            >
              Disconnect Cloud Wallet
            </button>
          </div>
        </>
      )}
      {offer && (
        <p className="mono">
          Offer (finish once): {offer}
        </p>
      )}
      {status === null && (
        <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>
          Check Cloud Wallet
        </button>
      )}
    </section>
  );
}
