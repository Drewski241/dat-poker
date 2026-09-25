export function treasuryStatusText(config: {
  treasuryConfigured: boolean;
  treasuryReachable: boolean;
  treasuryHost: string | null;
  treasuryError: string | null;
  treasuryWalletRpcReachable: boolean | null;
}): string {
  const host = config.treasuryHost ?? (config.treasuryReachable ? "payout service" : "the payout URL");
  if (config.treasuryReachable) {
    if (config.treasuryError) return config.treasuryError;
    if (config.treasuryWalletRpcReachable === false) {
      return `HTTP is up at ${host}, but Sage RPC has no treasury key logged in. On the AWS host: sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh`;
    }
    return `active at ${host} — withdraw can send a DAT offer to your player Sage`;
  }
  if (config.treasuryConfigured) {
    const extra = config.treasuryError ? ` (${config.treasuryError})` : "";
    return `configured but not reachable at ${host}${extra}. Redeploy so dat-poker-treasury stays up with the website, then check again.`;
  }
  return "not configured. Set DAT_TREASURY_PAYOUT_URL and start treasury.";
}
