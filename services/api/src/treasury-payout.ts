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
 * WalletConnect takeOffer is disabled on the game host. Creating a treasury
 * offer anyway locks DAT (worse when the player paired the treasury Sage key)
 * and never lands in the player wallet.
 */
export function onChainSageWithdrawEnabled(): boolean {
  const raw = process.env.DAT_ENABLE_ONCHAIN_WITHDRAW?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function sageLedgerWithdrawNote(kind: "sng" | "table"): string {
  return kind === "sng"
    ? "Unlocked DAT stays in your table account. On-chain Sage payout is off on this host, so it will not appear in Sage. A payout to the treasury Sage key also cannot show as a new deposit."
    : "Unlocked DAT stays in your table account. On-chain Sage payout is off on this host, so it will not appear in Sage.";
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
