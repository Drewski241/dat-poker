export type WithdrawPayoutMode = "net" | "full";

export interface TreasuryPayoutConfig {
  payoutMode: WithdrawPayoutMode;
  treasuryPayoutUrl: string | null;
  withdrawFeeMojos: bigint;
}

export function readTreasuryPayoutConfig(): TreasuryPayoutConfig {
  const payoutMode = process.env.DAT_WITHDRAW_PAYOUT_MODE === "full" ? "full" : "net";
  const treasuryPayoutUrl = process.env.DAT_TREASURY_PAYOUT_URL?.trim() || null;
  const withdrawFeeMojos = BigInt(process.env.DAT_WITHDRAW_FEE_MOJOS ?? "0");
  return { payoutMode, treasuryPayoutUrl, withdrawFeeMojos };
}

/**
 * Host → player Sage payouts use a treasury offer the player imports in Sage.
 * WalletConnect takeOffer stays disabled. Default on when a treasury URL is set;
 * set DAT_ENABLE_ONCHAIN_WITHDRAW=false to force ledger-only.
 */
export function onChainSageWithdrawEnabled(): boolean {
  const raw = process.env.DAT_ENABLE_ONCHAIN_WITHDRAW?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  return Boolean(process.env.DAT_TREASURY_PAYOUT_URL?.trim());
}

export function treasuryPayoutHealthUrl(payoutUrl: string): string {
  return payoutUrl.replace(/\/payout\/?$/i, "/health");
}

export async function pingTreasuryPayout(payoutUrl: string): Promise<boolean> {
  try {
    const res = await fetch(treasuryPayoutHealthUrl(payoutUrl), {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function looksLikeXchAddress(value: string): boolean {
  return /^xch1[0-9a-z]{8,}$/i.test(value.trim());
}

export function treasurySelfPayoutError(address: string): string | null {
  const treasury = process.env.TREASURY_XCH_ADDRESS?.trim();
  if (treasury && treasury.toLowerCase() === address.trim().toLowerCase()) {
    return "That Sage address is the treasury wallet. Connect a separate player Sage key to receive DAT.";
  }
  return null;
}

export function sageLedgerWithdrawNote(kind: "sng" | "table"): string {
  return kind === "sng"
    ? "Unlocked DAT stays in your table account. Start the treasury payout service to send an offer to a player Sage wallet."
    : "Unlocked DAT stays in your table account. Start the treasury payout service to send an offer to a player Sage wallet.";
}

export function sageOfferWithdrawNote(): string {
  return "Treasury created a DAT offer. In your player Sage wallet (not the treasury key), open Offers → Import, paste the offer, and accept it.";
}

export function computeWithdrawPayout(
  stackMojos: bigint,
  originalBuyInMojos: bigint,
  mode: WithdrawPayoutMode,
): bigint {
  if (mode === "full") {
    return stackMojos;
  }
  const net = stackMojos - originalBuyInMojos;
  return net > 0n ? net : 0n;
}

export async function requestTreasuryOffer(params: {
  assetId: string;
  recipientAddress: string;
  amountMojos: bigint;
  treasuryPayoutUrl: string;
}): Promise<string | null> {
  if (params.amountMojos <= 0n) {
    return null;
  }

  const res = await fetch(params.treasuryPayoutUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assetId: params.assetId,
      address: params.recipientAddress,
      amountMojos: params.amountMojos.toString(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Treasury payout service failed (${res.status}): ${text || res.statusText}`);
  }

  const body = (await res.json()) as { offer?: string };
  return body.offer?.trim() || null;
}
