import { useState } from "react";
import type { Mtt16NftPromo, Mtt16NftReward } from "../api.js";
import { takeOffer, type WcSession } from "../wallet/chia-wallet.js";
import { sessionCanTakeOffer } from "../wallet/constants.js";

type Props = {
  promo: Mtt16NftPromo | null;
  reward: Mtt16NftReward | null;
  heading: string;
  description: string;
  imageAlt: string;
  playerId: string | null;
  playerLabel: (id: string, viewerId: string | null) => string;
  busy: boolean;
  session: WcSession | null;
  wcConfig: { projectId: string; chainId: string } | null;
  run: (status: string, fn: () => Promise<void>) => void;
  setStatus: (msg: string) => void;
  setError: (msg: string) => void;
  onRetryReward: () => Promise<Mtt16NftReward & { retry?: { retried: boolean; reason?: string } }>;
  onRefreshPromo: () => Promise<Mtt16NftPromo>;
  onRewardUpdated: (reward: Mtt16NftReward) => void;
  onPromoUpdated: (promo: Mtt16NftPromo) => void;
};

export function NftChallengePromoCard({
  promo,
  reward,
  heading,
  description,
  imageAlt,
  playerId,
  playerLabel,
  busy,
  session,
  wcConfig,
  run,
  setStatus,
  setError,
  onRetryReward,
  onRefreshPromo,
  onRewardUpdated,
  onPromoUpdated,
}: Props) {
  const [offerCopied, setOfferCopied] = useState(false);

  if (!promo?.enabled) return null;

  return (
    <div className="nft-promo">
      {promo.imageUrl ? (
        <img className="nft-promo-image" src={promo.imageUrl} alt={imageAlt} />
      ) : null}
      <div className="nft-promo-copy">
        <h3>{heading}</h3>
        <p className="muted small">{description}</p>
        {promo.description ? <p className="nft-promo-desc">{promo.description}</p> : null}
        {promo.edition ? <p className="muted small">Edition {promo.edition}</p> : null}
        {promo.awarded ? (
          <p className="nft-promo-status">
            Claimed by {playerLabel(promo.winnerPlayerId ?? "", playerId)}
          </p>
        ) : playerId ? (
          <p className="nft-promo-status">
            Your wins: {promo.yourWins} / {promo.winsRequired}
            {promo.winsToGo > 0 ? ` · ${promo.winsToGo} to go` : " · eligible for treasury NFT offer"}
          </p>
        ) : (
          <p className="muted small">Sign in to track your win count.</p>
        )}
        {promo.leader && !promo.awarded ? (
          <p className="muted small">
            Leader: {playerLabel(promo.leader.playerId, playerId)} ({promo.leader.wins} win
            {promo.leader.wins === 1 ? "" : "s"})
          </p>
        ) : null}
        <p className="muted small nft-promo-id">{promo.nftId}</p>
        {reward?.eligible ? (
          <div className="nft-promo-claim">
            {reward.offer ? (
              <>
                <p className="nft-promo-status">
                  Your treasury NFT offer is ready
                  {reward.feeMojos && BigInt(reward.feeMojos) > 0n
                    ? ` (includes ${(Number(reward.feeMojos) / 1e12).toFixed(6)} XCH tx fee)`
                    : ""}
                  .
                </p>
                <p className="muted small">
                  This <code>offer1…</code> string is <strong>not</strong> the WalletConnect
                  <code>wc:…</code> link. Claim on desktop: <strong>Copy offer1</strong> → Sage →{" "}
                  <strong>Offers → Import</strong> → paste → Accept. That import <em>is</em> the accept step
                  (no second WC popup). Optional: <strong>Accept via WalletConnect</strong> only if this
                  browser’s Sage pairing included takeOffer (Disconnect + Connect again after the latest
                  deploy).
                </p>
                <div className="nft-promo-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(reward.offer!);
                          setOfferCopied(true);
                          setStatus("Copied offer1…. In Sage desktop: Offers → Import → paste → Accept.");
                          window.setTimeout(() => setOfferCopied(false), 4000);
                        } catch {
                          setError("Could not copy — select the offer1… text below and copy manually.");
                        }
                      })();
                    }}
                  >
                    {offerCopied ? "Copied — Sage Offers → Import" : "Copy offer1 for Sage Import"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !session || !wcConfig}
                    title="Asks the paired desktop Sage (same WC session) to takeOffer"
                    onClick={() => {
                      if (!session || !wcConfig) {
                        setError("Connect Sage in this browser first (paste the wc: URI into Sage).");
                        return;
                      }
                      if (!sessionCanTakeOffer(session)) {
                        setError(
                          "This Sage pairing has no takeOffer permission. Use Copy offer1 → Offers → Import, or Disconnect Sage and Connect again after redeploy so takeOffer is granted.",
                        );
                        return;
                      }
                      run("Waiting for desktop Sage to approve takeOffer…", async () => {
                        await takeOffer(
                          session,
                          wcConfig.projectId,
                          wcConfig.chainId,
                          reward.offer!,
                          BigInt(reward.feeMojos ?? "0"),
                        );
                        setStatus("Sage accepted the NFT offer — check your wallet NFTs.");
                      });
                    }}
                  >
                    Accept via WalletConnect
                  </button>
                </div>
                <textarea
                  className="nft-offer-text"
                  readOnly
                  rows={3}
                  value={reward.offer}
                  aria-label="Treasury NFT offer string"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </>
            ) : (
              <>
                <p className="muted small">
                  You won the challenge. Click the button below to build the treasury <code>offer1…</code>{" "}
                  string. Then it will appear in this same NFT card so you can copy it into Sage → Offers →
                  Import.
                </p>
                {reward.offerError ? <p className="error small">{reward.offerError}</p> : null}
                <div className="nft-promo-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      run("Requesting NFT offer…", async () => {
                        const nextReward = await onRetryReward();
                        onRewardUpdated(nextReward);
                        onPromoUpdated(await onRefreshPromo());
                        if (nextReward.offer) {
                          setStatus(
                            "NFT offer ready in this card — copy offer1… then Sage → Offers → Import.",
                          );
                        } else {
                          throw new Error(
                            nextReward.offerError ||
                              nextReward.retry?.reason ||
                              "Treasury did not return an NFT offer yet",
                          );
                        }
                      });
                    }}
                  >
                    {reward.offerError ? "Retry NFT offer" : "Get NFT offer"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
