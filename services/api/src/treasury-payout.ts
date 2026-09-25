import { resolveSageTakeOfferFeeMojos } from "@dat-poker/shared";

export type WithdrawPayoutMode = "net" | "full";

export interface TreasuryPayoutConfig {
  payoutMode: WithdrawPayoutMode;
  treasuryPayoutUrl: string | null;
  withdrawFeeMojos: bigint;
}

export function readTreasuryPayoutConfig(): TreasuryPayoutConfig {
  const payoutMode = process.env.DAT_WITHDRAW_PAYOUT_MODE === "full" ? "full" : "net";
  const treasuryPayoutUrl = process.env.DAT_TREASURY_PAYOUT_URL?.trim() || null;
  const withdrawFeeMojos = resolveSageTakeOfferFeeMojos(process.env.DAT_WITHDRAW_FEE_MOJOS);
  return { payoutMode, treasuryPayoutUrl, withdrawFeeMojos };
}

/**
 * Host → player Sage payouts use a treasury offer. The site then calls
 * chia_takeOffer so Sage shows Accept. Treasury pays TREASURY_PAYOUT_FEE_MOJOS
 * XCH on make_offer — Sage Accept has no fee box.
 * Set DAT_ENABLE_ONCHAIN_WITHDRAW=false to force ledger-only.
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
  walletRpcReachable: boolean | null;
  walletConfigured: boolean | null;
  offerMode: string | null;
};

const emptyWalletHealth = {
  walletRpcReachable: null as boolean | null,
  walletConfigured: null as boolean | null,
  offerMode: null as string | null,
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
        let walletRpcReachable: boolean | null = null;
        let walletConfigured: boolean | null = null;
        let offerMode: string | null = null;
        let walletError: string | null = null;
        try {
          const body = (await res.json()) as {
            walletRpcReachable?: boolean | null;
            walletConfigured?: boolean | null;
            walletError?: string | null;
            offerMode?: string | null;
          };
          if (typeof body.walletRpcReachable === "boolean") {
            walletRpcReachable = body.walletRpcReachable;
          }
          if (typeof body.walletConfigured === "boolean") {
            walletConfigured = body.walletConfigured;
          }
          if (typeof body.offerMode === "string") {
            offerMode = body.offerMode;
          }
          if (typeof body.walletError === "string" && body.walletError.trim()) {
            walletError = body.walletError.trim();
          }
        } catch {
          /* health may be a bare 200 */
        }
        const missingCerts = offerMode === "rpc" && walletConfigured === false;
        const notLoggedIn = offerMode === "rpc" && walletRpcReachable === false;
        return {
          reachable: true,
          healthUrl: url,
          host,
          error: missingCerts
            ? (walletError ?? "Sage RPC certs missing on the treasury host")
            : notLoggedIn
              ? (walletError ?? "Sage RPC is not logged in on the treasury host")
              : walletError,
          walletRpcReachable,
          walletConfigured,
          offerMode,
        };
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
  return { reachable: false, healthUrl, host, error, ...emptyWalletHealth };
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
  return "Treasury created a DAT offer and already attached the XCH network fee. Approve Accept in player Sage (not the treasury key). Sage has no fee box — tap Accept once. If you already tapped Accept, wait and do not Accept the old offer again. If no popup appears, Offers → Import and paste the offer.";
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

  let res: Response;
  try {
    res = await fetch(params.treasuryPayoutUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: params.assetId,
        address: params.recipientAddress,
        amountMojos: params.amountMojos.toString(),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const raw = (e as Error).message || "request failed";
    if (/timeout|aborted/i.test(raw) || (e as { name?: string }).name === "TimeoutError") {
      throw new Error(
        "Treasury Sage did not finish the offer in 20s. On the AWS host, confirm Sage RPC :9257 is logged in, then try again.",
      );
    }
    throw e;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Treasury payout service failed (${res.status}): ${text || res.statusText}`);
  }

  const body = (await res.json()) as { offer?: string };
  return body.offer?.trim() || null;
}
