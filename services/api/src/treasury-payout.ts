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

export type TreasuryPing = {
  reachable: boolean;
  healthUrl: string;
  host: string;
  error: string | null;
};

export function treasuryPayoutHealthUrl(payoutUrl: string): string {
  const trimmed = payoutUrl.trim();
  if (/\/payout\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/payout\/?$/i, "/health");
  }
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = "/health";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return `${trimmed.replace(/\/$/, "")}/health`;
  }
}

export function describeTreasuryTarget(payoutUrl: string): { healthUrl: string; host: string } {
  const healthUrl = treasuryPayoutHealthUrl(payoutUrl);
  try {
    const parsed = new URL(healthUrl);
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return { healthUrl, host: `${parsed.hostname}:${port}` };
  } catch {
    return { healthUrl, host: payoutUrl };
  }
}

function pingCandidates(healthUrl: string): string[] {
  const urls = [healthUrl];
  if (healthUrl.includes("://localhost")) {
    urls.push(healthUrl.replace("://localhost", "://127.0.0.1"));
  }
  return [...new Set(urls)];
}

export async function inspectTreasuryPayout(payoutUrl: string): Promise<TreasuryPing> {
  const { healthUrl, host } = describeTreasuryTarget(payoutUrl);
  let error = `connection refused — nothing is listening on ${host}`;
  for (const url of pingCandidates(healthUrl)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        return { reachable: true, healthUrl: url, host, error: null };
      }
      error = `HTTP ${res.status} from ${host}`;
    } catch (e) {
      const raw = (e as Error).message || "connection failed";
      error = /fetch failed|ECONNREFUSED|ECONNRESET/i.test(raw)
        ? `connection refused — nothing is listening on ${host}`
        : /timeout|aborted/i.test(raw)
          ? `timed out reaching ${host}`
          : raw;
    }
  }
  return { reachable: false, healthUrl, host, error };
}

export async function pingTreasuryPayout(payoutUrl: string): Promise<boolean> {
  return (await inspectTreasuryPayout(payoutUrl)).reachable;
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
