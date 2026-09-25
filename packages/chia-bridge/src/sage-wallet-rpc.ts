import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import https from "node:https";
import { URL } from "node:url";
import { DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS, formatXchMojos } from "@dat-poker/shared";

export type TreasuryWalletBackend = "sage" | "chia";

export interface TreasuryWalletRpcConfig {
  backend: TreasuryWalletBackend;
  url: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
  sageFingerprint?: number;
}

export interface SageMakeOfferResponse {
  offer?: string;
  success?: boolean;
  error?: string;
}

export interface CreateOfferForIdsResponse {
  success: boolean;
  offer?: string;
  error?: string;
}

export function expandWalletPath(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const trimmed = path.trim();
  if (trimmed.startsWith("~/")) {
    return `${homedir()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

export function sageCertSearchDirs(): string[] {
  const homes = new Set<string>();
  homes.add(homedir());
  if (process.env.HOME) homes.add(process.env.HOME);
  if (process.env.TREASURY_SAGE_HOME) homes.add(process.env.TREASURY_SAGE_HOME);
  homes.add("/home/ec2-user");
  homes.add("/root");

  const dirs: string[] = [];
  for (const home of homes) {
    dirs.push(join(home, ".local/share/sage/ssl"));
    dirs.push(join(home, ".local/share/com.rigidnetwork.sage/ssl"));
    dirs.push(join(home, "Library/Application Support/com.rigidnetwork.sage/ssl"));
  }
  dirs.push("/opt/dat-poker/data/sage/ssl");
  dirs.push("/opt/sage/ssl");
  dirs.push("/var/lib/sage/ssl");
  return [...new Set(dirs)];
}

export function defaultSageCertPaths(): { certPath?: string; keyPath?: string } {
  for (const dir of sageCertSearchDirs()) {
    const certPath = join(dir, "wallet.crt");
    const keyPath = join(dir, "wallet.key");
    if (existsSync(certPath) && existsSync(keyPath)) {
      return { certPath, keyPath };
    }
  }
  return {};
}

export function describeMissingSageCerts(): string {
  return (
    "Sage RPC certs (wallet.crt / wallet.key) were not found for the treasury process. " +
    "Treasury HTTP is up, but it cannot talk to Sage on :9257. " +
    "On the AWS host run: sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh"
  );
}

export function describeSageLoginNeeded(fingerprintSet: boolean): string {
  if (fingerprintSet) {
    return (
      "Sage RPC certs are present but the treasury key is not logged in. " +
      "On the AWS host: sudo TREASURY_SAGE_FINGERPRINT=<id> bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh"
    );
  }
  return (
    "Sage RPC certs are present, but no treasury spend key is imported (sageFingerprint is null). " +
    "Load the dedicated treasury key with sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh " +
    "(TREASURY_SAGE_PRIVATE_KEY or TREASURY_SAGE_MNEMONIC — not TREASURY_WALLET_KEY_PATH, that is only the RPC TLS cert)."
  );
}

export function parseSageAmount(value: unknown): bigint | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return undefined;
}

export function formatDatMojos(mojos: bigint, precision = 3): string {
  const safePrecision = precision >= 0 && precision <= 12 ? precision : 3;
  const denom = 10n ** BigInt(safePrecision);
  const whole = mojos / denom;
  const frac = mojos % denom;
  if (frac === 0n) return `${whole.toString()} DAT`;
  const fracStr = frac.toString().padStart(safePrecision, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} DAT`;
}

export interface SageTreasuryFunds {
  address: string | null;
  syncedCoins: number | null;
  totalCoins: number | null;
  xchSelectableMojos: bigint | null;
  datBalanceMojos: bigint | null;
  datSelectableMojos: bigint | null;
  datSpendableCoins: number | null;
  pendingOfferCount: number | null;
  pendingTransactionCount: number | null;
  datTicker: string;
  datPrecision: number;
  assetId: string | null;
}

export interface SageOfferRecord {
  offer_id?: string;
  offerId?: string;
  status?: unknown;
}

export interface SageOfferCancelResult {
  cancelled: string[];
  mempoolConflict: string[];
  failed: string[];
  errors: string[];
  skippedRecent: string[];
}

export function emptySageTreasuryFunds(assetId?: string | null): SageTreasuryFunds {
  const normalized = assetId?.replace(/^0x/i, "").toLowerCase() ?? null;
  return {
    address: null,
    syncedCoins: null,
    totalCoins: null,
    xchSelectableMojos: null,
    datBalanceMojos: null,
    datSelectableMojos: null,
    datSpendableCoins: null,
    pendingOfferCount: null,
    pendingTransactionCount: null,
    datTicker: "DAT",
    datPrecision: 3,
    assetId: normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null,
  };
}

export function sageOfferId(offer: SageOfferRecord): string | null {
  const id = offer.offer_id ?? offer.offerId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Pending/active Sage offers reserve maker coins until taken, deleted, or cancelled. */
export function isOpenSageOfferStatus(status: unknown): boolean {
  if (typeof status === "number") return status === 0 || status === 1;
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  return normalized === "pending" || normalized === "active" || normalized === "0" || normalized === "1";
}

export function openSageOfferIds(offers: SageOfferRecord[]): string[] {
  return offers
    .filter((offer) => isOpenSageOfferStatus(offer.status))
    .map(sageOfferId)
    .filter((id): id is string => Boolean(id));
}

export function leftoverSageOffersBlockNewPayout(
  funds: SageTreasuryFunds,
  neededMojos?: bigint,
): boolean {
  if ((funds.pendingOfferCount ?? 0) <= 0) return false;
  if (neededMojos != null && sageTreasuryCanBuildPayout(funds, neededMojos)) return false;
  return true;
}

/** Leftover get_offers rows with no pending spend — GUI shows nothing to cancel. */
export function leftoverSageOffersAreGhostRecords(funds: SageTreasuryFunds): boolean {
  return (funds.pendingOfferCount ?? 0) > 0 && !sageTreasuryHasPendingSpend(funds);
}

export function sageTreasuryCanBuildPayout(funds: SageTreasuryFunds, neededMojos: bigint): boolean {
  const dat = funds.datSelectableMojos;
  return dat != null && dat >= neededMojos;
}

export function sageDatLooksLockedInOffer(funds: SageTreasuryFunds): boolean {
  return leftoverSageOffersBlockNewPayout(funds);
}

/** DAT still on the key but not selectable, and treasury has no open offer — a player take is in mempool. */
export function sageDatLooksLockedByPendingTake(funds: SageTreasuryFunds): boolean {
  if (leftoverSageOffersBlockNewPayout(funds)) return false;
  const selectable = funds.datSelectableMojos;
  const balance = funds.datBalanceMojos;
  return selectable === 0n && balance != null && balance > 0n;
}

export function sageLooksStillSyncing(funds: SageTreasuryFunds): boolean {
  if (funds.totalCoins == null || funds.syncedCoins == null) {
    return funds.datSelectableMojos == null || funds.datSelectableMojos === 0n;
  }
  return funds.totalCoins === 0 || funds.syncedCoins < funds.totalCoins;
}

export function describeSageNoSpendableCoins(
  funds: SageTreasuryFunds = emptySageTreasuryFunds(),
  neededMojos?: bigint,
): string {
  const addr = funds.address ? ` Treasury address: ${funds.address}.` : "";
  const asset = funds.assetId
    ? ` DAT asset id ${funds.assetId.slice(0, 8)}…${funds.assetId.slice(-4)}.`
    : " Set DAT_GOVERNANCE_TOKEN_ASSET_ID to the 64-hex DAT CAT id.";
  const dat = funds.datSelectableMojos;
  const xch = funds.xchSelectableMojos;
  const balance = funds.datBalanceMojos;
  const pending = funds.pendingOfferCount ?? 0;

  if (leftoverSageOffersBlockNewPayout(funds)) {
    if (leftoverSageOffersAreGhostRecords(funds)) {
      return describeSageGhostLeftoverOffers();
    }
    const held =
      balance != null && balance > 0n
        ? ` Sage still shows ${formatDatMojos(balance, funds.datPrecision)} on this key, but it is not selectable.`
        : "";
    const count =
      pending > 0 ? ` ${pending} pending Sage offer(s) are reserving those coins.` : " The last unused withdraw offer is still reserving those coins.";
    return (
      "Treasury DAT is locked in an unused Sage offer from an earlier withdraw — the coins did not leave this key." +
      held +
      count +
      addr +
      " Do not tap Accept on the old offer again. Wait 1–2 minutes, then withdraw once — leftover offers are cancelled on-chain first, and a new offer is not built in the same request. Or run: sudo bash /opt/dat-poker/deploy/aws-ec2/release-treasury-offers.sh and wait before the next withdraw."
    );
  }
  if (sageDatLooksLockedByPendingTake(funds)) {
    return describeSagePendingPlayerTake();
  }

  if (sageLooksStillSyncing(funds) && (dat == null || dat === 0n)) {
    return (
      "Treasury Sage has not finished syncing this key, so DAT on the private key is not spendable yet. " +
      `Synced ${funds.syncedCoins ?? 0}/${funds.totalCoins ?? 0} coins.` +
      addr +
      " Wait until /health datSelectableMojos is greater than 0 (50000 DAT = 50000000 mojos), then withdraw again."
    );
  }
  if (dat === 0n) {
    return (
      "Treasury Sage does not see spendable DAT on the logged-in key." +
      asset +
      (xch === 0n
        ? " XCH selectable is also 0 — send a little XCH for fees."
        : xch != null
          ? ` XCH selectable is ${xch.toString()} mojos.`
          : "") +
      addr +
      " Confirm the key, asset id, and that Sage has synced. 50000 DAT should read as 50000000 mojos."
    );
  }
  if (neededMojos != null && dat != null && dat < neededMojos) {
    return (
      `Treasury Sage has ${formatDatMojos(dat, funds.datPrecision)} selectable, but this withdraw needs ${formatDatMojos(neededMojos, funds.datPrecision)}.` +
      addr
    );
  }
  if (dat != null && dat > 0n && xch === 0n) {
    return (
      `Treasury Sage sees ${formatDatMojos(dat, funds.datPrecision)} but no XCH.` +
      addr +
      " Send a small amount of XCH to that address for offer fees, then withdraw again."
    );
  }
  if (dat != null && dat > 0n && funds.datSpendableCoins === 0) {
    return describeSagePendingPlayerTake();
  }
  return (
    "Treasury Sage has no spendable coins for this DAT offer." +
    addr +
    asset +
    " After Sage syncs, 50000 DAT should appear as 50000000 mojos. A little XCH is also required for fees."
  );
}

export function isSageCoinSelectionError(text: string): boolean {
  return /coin selection|no spendable coins/i.test(text);
}

/** Same DAT/XCH coin is already spent in mempool (old take, cancel, or remake). */
export function isSageMempoolConflict(text: string): boolean {
  return /mempool|double.?spend|double spend|conflicting (spend|transaction)|already in the mempool|known coin|pending transaction|coin is pending|has already been spent|ASSERT_ANNOUNCE/i.test(
    text,
  );
}

export function describeSagePendingPlayerTake(): string {
  return (
    "Player Sage already has a pending incoming DAT take for this withdraw. " +
    "That take is spending the treasury DAT coin in the mempool, so treasury has no open offer to cancel " +
    "and a new withdraw offer will mempool-conflict. " +
    "Do not withdraw again. Do not tap Accept again. Do not cancel from treasury. " +
    "Wait until that pending incoming DAT shows Confirmed in player Sage " +
    "(a 0-fee take can sit Pending a long time). " +
    "If it stays Pending for hours: in player Sage, remove/cancel that pending incoming take if Sage lets you, " +
    "wait until it disappears, then withdraw once so treasury can build a new fee-bearing offer. " +
    "If DAT already arrived in player Sage, you are done."
  );
}

export function describeSageGhostLeftoverOffers(): string {
  return (
    "Treasury Sage still lists leftover offer rows in RPC, but there is no pending transaction " +
    "and the GUI has nothing to cancel. Those rows are stale local records. " +
    "Payout deletes them locally and does not cancel on-chain (on-chain cancel is what caused the mempool conflicts). " +
    "Withdraw once. If DAT is not selectable yet, wait a minute for Sage to unlock the coins, then withdraw once. " +
    "If player Sage already shows Confirmed DAT, you are done."
  );
}

export function describeSagePendingTreasurySpend(): string {
  return (
    "Treasury Sage still has a pending on-chain spend (usually the leftover-offer cancel) " +
    "for the same DAT coin. A new withdraw offer mempool-conflicts immediately. " +
    "Do not withdraw again. Do not cancel from treasury. " +
    "In treasury Sage, wait until Transactions shows no pending spends, then withdraw once. " +
    "If player Sage already shows Confirmed DAT, you are done."
  );
}

export function sageTreasuryHasPendingSpend(funds: SageTreasuryFunds): boolean {
  return (funds.pendingTransactionCount ?? 0) > 0;
}

export function describeSageMempoolConflict(funds?: SageTreasuryFunds): string {
  if (funds && sageDatLooksLockedByPendingTake(funds) && !sageTreasuryHasPendingSpend(funds)) {
    return describeSagePendingPlayerTake();
  }
  return describeSagePendingTreasurySpend();
}

export function sageRpcAmount(mojos: bigint): string {
  if (mojos < 0n) {
    throw new Error("Sage amount cannot be negative");
  }
  return mojos.toString();
}

export function describeSageOfferCancelWait(
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): string {
  return (
    "A leftover treasury Sage offer is still reserving those DAT coins. " +
    `Treasury submitted an on-chain cancel with a ${formatXchMojos(feeMojos)} fee ` +
    "(same TREASURY_PAYOUT_FEE_MOJOS XCH fee as make_offer). " +
    "Wait 1–2 minutes, do not tap Accept on the old offer, then withdraw once."
  );
}

export function describeSageCancelNeedsXch(
  funds: SageTreasuryFunds,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): string {
  const addr = funds.address ? ` Treasury address: ${funds.address}.` : "";
  return (
    `On-chain cancel of the leftover Sage offer needs a ${formatXchMojos(feeMojos)} fee, ` +
    "but treasury Sage has no selectable XCH." +
    addr +
    " Send a little XCH to that address, wait for sync, then withdraw once. Do not Accept the old offer."
  );
}

export function describeSageCancelFailed(
  result: SageOfferCancelResult,
  funds: SageTreasuryFunds,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): string {
  if (funds.xchSelectableMojos === 0n) {
    return describeSageCancelNeedsXch(funds, feeMojos);
  }
  const detail = result.errors[0]?.trim();
  return (
    `Treasury could not cancel leftover Sage offer(s) on-chain. Cancel requires an XCH fee ` +
    `(${formatXchMojos(feeMojos)}, TREASURY_PAYOUT_FEE_MOJOS).` +
    (detail ? ` Sage: ${detail}` : "") +
    " Do not tap Accept on the old offer. Fix the fee/XCH, wait 1–2 minutes, then withdraw once."
  );
}

export function describeSageWalletRpcFailure(statusCode: number | undefined, body: string): string {
  const trimmed = body.trim();
  if (isSageMempoolConflict(trimmed)) {
    return describeSageMempoolConflict();
  }
  if (isSageCoinSelectionError(trimmed)) {
    return describeSageNoSpendableCoins();
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      if (isSageMempoolConflict(parsed.error)) return describeSageMempoolConflict();
      return isSageCoinSelectionError(parsed.error)
        ? describeSageNoSpendableCoins()
        : parsed.error.trim();
    }
  } catch {
    /* Sage often returns a plain Wallet error: … string */
  }
  if (trimmed) {
    return trimmed.slice(0, 300);
  }
  return `Treasury wallet RPC HTTP ${statusCode ?? "error"}`;
}

export function remapSageOfferError(
  message: string,
  funds: SageTreasuryFunds,
  neededMojos?: bigint,
): string {
  if (isSageMempoolConflict(message)) {
    return describeSageMempoolConflict(funds);
  }
  if (isSageCoinSelectionError(message)) {
    return describeSageNoSpendableCoins(funds, neededMojos);
  }
  return message.replace(/^Treasury wallet RPC invalid JSON \(\d+\):\s*/i, "");
}

function stripEnvSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.length >= 2 &&
    (trimmed.startsWith('"') || trimmed.startsWith("'")) &&
    trimmed[0] === trimmed[trimmed.length - 1]
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}

export function looksLikeSageSecretKey(value: string | undefined): boolean {
  const trimmed = stripEnvSecret(value)?.replace(/^0x/i, "");
  return Boolean(trimmed && /^[0-9a-fA-F]{64}$/.test(trimmed));
}

export function parseSageFingerprint(value: string | undefined): number | undefined {
  const trimmed = stripEnvSecret(value);
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const fingerprint = Number(trimmed);
  if (!Number.isInteger(fingerprint) || fingerprint < 0 || fingerprint > 0xffff_ffff) {
    return undefined;
  }
  return fingerprint;
}

export function readSageTreasurySecretFromEnv(): string | undefined {
  return (
    stripEnvSecret(process.env.TREASURY_SAGE_PRIVATE_KEY) ??
    stripEnvSecret(process.env.TREASURY_SAGE_SECRET_KEY) ??
    stripEnvSecret(process.env.TREASURY_SAGE_MNEMONIC) ??
    (looksLikeSageSecretKey(process.env.TREASURY_SAGE_FINGERPRINT)
      ? stripEnvSecret(process.env.TREASURY_SAGE_FINGERPRINT)
      : undefined)
  );
}

export function buildSageImportKeyRequest(key: string): {
  name: string;
  key: string;
  save_secrets: boolean;
  login: boolean;
} {
  return {
    name: "treasury",
    key,
    save_secrets: true,
    login: true,
  };
}

export function readTreasuryWalletRpcConfigFromEnv(): TreasuryWalletRpcConfig {
  const backend = process.env.TREASURY_WALLET_BACKEND === "chia" ? "chia" : "sage";
  const defaults = backend === "sage" ? defaultSageCertPaths() : {};
  const fingerprintRaw = process.env.TREASURY_SAGE_FINGERPRINT?.trim();

  return {
    backend,
    url:
      process.env.TREASURY_WALLET_RPC_URL?.trim() ||
      (backend === "sage" ? "https://127.0.0.1:9257" : "https://127.0.0.1:9256"),
    certPath: expandWalletPath(process.env.TREASURY_WALLET_CERT_PATH) ?? defaults.certPath,
    keyPath: expandWalletPath(process.env.TREASURY_WALLET_KEY_PATH) ?? defaults.keyPath,
    rejectUnauthorized:
      backend === "sage"
        ? process.env.TREASURY_WALLET_INSECURE === "true"
          ? false
          : false
        : process.env.TREASURY_WALLET_INSECURE !== "true",
    sageFingerprint: parseSageFingerprint(fingerprintRaw),
  };
}

/** @deprecated use readTreasuryWalletRpcConfigFromEnv */
export function readWalletRpcConfigFromEnv(): TreasuryWalletRpcConfig {
  return readTreasuryWalletRpcConfigFromEnv();
}

function buildAgent(config: TreasuryWalletRpcConfig): https.Agent {
  if (config.certPath && config.keyPath) {
    return new https.Agent({
      cert: readFileSync(config.certPath),
      key: readFileSync(config.keyPath),
      rejectUnauthorized: config.rejectUnauthorized ?? false,
    });
  }
  return new https.Agent({
    rejectUnauthorized: config.rejectUnauthorized ?? false,
  });
}

function remapTreasuryWalletRpcError(text: string, statusCode?: number): string {
  if (isSageMempoolConflict(text)) return describeSageMempoolConflict();
  if (isSageCoinSelectionError(text)) return describeSageNoSpendableCoins();
  return text.trim() || describeSageWalletRpcFailure(statusCode, text);
}

export async function treasuryWalletRpcRequest<T>(
  config: TreasuryWalletRpcConfig,
  method: string,
  params: Record<string, unknown> = {},
  options?: { timeoutMs?: number },
): Promise<T> {
  const url = new URL(`/${method}`, config.url.endsWith("/") ? config.url : `${config.url}/`);
  const body = JSON.stringify(params);
  const agent = buildAgent(config);
  const timeoutMs = options?.timeoutMs ?? 12_000;

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: T & { success?: boolean; error?: string };
          try {
            parsed = JSON.parse(text) as T & { success?: boolean; error?: string };
          } catch {
            reject(new Error(describeSageWalletRpcFailure(res.statusCode, text)));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(remapTreasuryWalletRpcError(parsed.error ?? text, res.statusCode)));
            return;
          }
          if (parsed.success === false) {
            reject(new Error(remapTreasuryWalletRpcError(parsed.error ?? "Treasury wallet RPC failed")));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Treasury Sage RPC timed out waiting for an offer"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function pingTreasuryWalletRpc(config: TreasuryWalletRpcConfig): Promise<boolean> {
  try {
    if (config.backend === "sage") {
      await treasuryWalletRpcRequest(config, "get_sync_status", {});
    } else {
      await treasuryWalletRpcRequest(config, "get_routes", {});
    }
    return true;
  } catch {
    return false;
  }
}

export async function readSageTreasuryFunds(
  config: TreasuryWalletRpcConfig,
  assetId?: string,
): Promise<SageTreasuryFunds> {
  const funds = emptySageTreasuryFunds(assetId);
  try {
    const sync = await treasuryWalletRpcRequest<{
      selectable_balance?: unknown;
      receive_address?: string;
      synced_coins?: number;
      total_coins?: number;
    }>(config, "get_sync_status", {});
    if (typeof sync.receive_address === "string" && sync.receive_address.trim()) {
      funds.address = sync.receive_address.trim();
    }
    if (typeof sync.synced_coins === "number") funds.syncedCoins = sync.synced_coins;
    if (typeof sync.total_coins === "number") funds.totalCoins = sync.total_coins;
    const xch = parseSageAmount(sync.selectable_balance);
    if (xch != null) funds.xchSelectableMojos = xch;
  } catch {
    /* health / payout still report whatever we got */
  }
  if (funds.assetId) {
    try {
      const listed = await treasuryWalletRpcRequest<{
        token?: {
          balance?: unknown;
          selectable_balance?: unknown;
          ticker?: string;
          precision?: number;
        } | null;
      }>(config, "get_token", { asset_id: funds.assetId });
      if (listed.token) {
        funds.datBalanceMojos = parseSageAmount(listed.token.balance) ?? 0n;
        funds.datSelectableMojos = parseSageAmount(listed.token.selectable_balance) ?? 0n;
        if (listed.token.ticker?.trim()) funds.datTicker = listed.token.ticker.trim();
        if (typeof listed.token.precision === "number") funds.datPrecision = listed.token.precision;
      } else {
        funds.datBalanceMojos = 0n;
        funds.datSelectableMojos = 0n;
      }
    } catch {
      /* get_token is best-effort */
    }
    try {
      const count = await treasuryWalletRpcRequest<{ count?: number }>(
        config,
        "get_spendable_coin_count",
        { asset_id: funds.assetId },
      );
      if (typeof count.count === "number") funds.datSpendableCoins = count.count;
    } catch {
      /* get_spendable_coin_count is best-effort */
    }
  }
  try {
    const listed = await listSageOffers(config);
    funds.pendingOfferCount = openSageOfferIds(listed).length;
  } catch {
    /* get_offers is best-effort */
  }
  try {
    const pending = await listSagePendingTransactions(config);
    funds.pendingTransactionCount = pending.length;
  } catch {
    /* get_pending_transactions is best-effort */
  }
  return funds;
}

export async function listSagePendingTransactions(
  config: TreasuryWalletRpcConfig,
): Promise<Array<{ transaction_id?: string }>> {
  const listed = await treasuryWalletRpcRequest<{ transactions?: Array<{ transaction_id?: string }> }>(
    config,
    "get_pending_transactions",
    {},
  );
  return Array.isArray(listed.transactions) ? listed.transactions : [];
}

export async function listSageOffers(config: TreasuryWalletRpcConfig): Promise<SageOfferRecord[]> {
  const listed = await treasuryWalletRpcRequest<{ offers?: SageOfferRecord[] }>(config, "get_offers", {});
  return Array.isArray(listed.offers) ? listed.offers : [];
}

export async function deleteSageOffer(config: TreasuryWalletRpcConfig, offerId: string): Promise<void> {
  await treasuryWalletRpcRequest(config, "delete_offer", { offer_id: offerId });
}

/** Local-only. Use when DAT is already selectable — on-chain cancel would spend those coins. */
export async function deleteOpenSageOffers(config: TreasuryWalletRpcConfig): Promise<string[]> {
  const ids = openSageOfferIds(await listSageOffers(config));
  const deleted: string[] = [];
  for (const offerId of ids) {
    try {
      await deleteSageOffer(config, offerId);
      deleted.push(offerId);
    } catch {
      /* a completed offer can fail delete */
    }
  }
  return deleted;
}

const recentSageOfferCancels = new Map<string, number>();
const SAGE_CANCEL_COOLDOWN_MS = 3 * 60_000;

export function rememberSageOfferCancel(offerId: string, now = Date.now()): void {
  recentSageOfferCancels.set(offerId, now);
}

export function wasSageOfferRecentlyCancelled(offerId: string, now = Date.now()): boolean {
  const at = recentSageOfferCancels.get(offerId);
  if (at == null) return false;
  if (now - at > SAGE_CANCEL_COOLDOWN_MS) {
    recentSageOfferCancels.delete(offerId);
    return false;
  }
  return true;
}

export function resetSageOfferCancelMemory(): void {
  recentSageOfferCancels.clear();
}

export function buildSageCancelOfferRequest(
  offerId: string,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): { offer_id: string; fee: string; auto_submit: true } {
  const id = offerId.trim();
  if (!id) {
    throw new Error("offer_id required to cancel a Sage offer");
  }
  const fee = feeMojos > 0n ? feeMojos : DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS;
  return {
    offer_id: id,
    fee: sageRpcAmount(fee),
    auto_submit: true,
  };
}

/** On-chain cancel — invalidates leftover offer1. Local delete_offer does not. */
export async function cancelSageOffer(
  config: TreasuryWalletRpcConfig,
  offerId: string,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): Promise<void> {
  await treasuryWalletRpcRequest(config, "cancel_offer", buildSageCancelOfferRequest(offerId, feeMojos), {
    timeoutMs: 45_000,
  });
}

export async function cancelOpenSageOffers(
  config: TreasuryWalletRpcConfig,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): Promise<SageOfferCancelResult> {
  const ids = openSageOfferIds(await listSageOffers(config));
  const cancelled: string[] = [];
  const mempoolConflict: string[] = [];
  const failed: string[] = [];
  const errors: string[] = [];
  const skippedRecent: string[] = [];
  for (const offerId of ids) {
    if (wasSageOfferRecentlyCancelled(offerId)) {
      skippedRecent.push(offerId);
      continue;
    }
    try {
      await cancelSageOffer(config, offerId, feeMojos);
      rememberSageOfferCancel(offerId);
      cancelled.push(offerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isSageMempoolConflict(message)) {
        rememberSageOfferCancel(offerId);
        mempoolConflict.push(offerId);
      } else {
        failed.push(offerId);
        if (message.trim()) errors.push(message.trim());
      }
    }
  }
  return { cancelled, mempoolConflict, failed, errors, skippedRecent };
}

/**
 * Cancel leftover pending/active offers on-chain.
 * Local delete_offer leaves the shared offer1 takeable and causes mempool conflicts.
 */
export async function releaseOpenSageOffers(
  config: TreasuryWalletRpcConfig,
  feeMojos: bigint = DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
): Promise<string[]> {
  const result = await cancelOpenSageOffers(config, feeMojos);
  return [...result.cancelled, ...result.mempoolConflict];
}

export function describeSageFundsBlock(
  funds: SageTreasuryFunds,
  neededMojos: bigint,
): string | null {
  if (funds.datSelectableMojos === 0n || (funds.datSpendableCoins === 0 && funds.datSelectableMojos == null)) {
    return describeSageNoSpendableCoins(funds, neededMojos);
  }
  if (funds.datSelectableMojos != null && funds.datSelectableMojos < neededMojos) {
    return describeSageNoSpendableCoins(funds, neededMojos);
  }
  return null;
}

export async function ensureSageTreasuryLoggedIn(config: TreasuryWalletRpcConfig): Promise<void> {
  if (config.backend !== "sage" || !config.sageFingerprint) {
    return;
  }
  await treasuryWalletRpcRequest(config, "login", { fingerprint: config.sageFingerprint });
}

export async function importSageTreasuryKey(
  config: TreasuryWalletRpcConfig,
  key: string,
): Promise<number> {
  const imported = await treasuryWalletRpcRequest<{ fingerprint?: number }>(
    config,
    "import_key",
    buildSageImportKeyRequest(key),
  );
  if (!imported.fingerprint) {
    throw new Error("Sage import_key did not return a fingerprint");
  }
  return imported.fingerprint;
}

export async function ensureSageTreasuryReady(
  config: TreasuryWalletRpcConfig,
): Promise<TreasuryWalletRpcConfig> {
  if (config.backend !== "sage") {
    return config;
  }
  let fingerprint = config.sageFingerprint;
  const secret = readSageTreasurySecretFromEnv();
  if (secret) {
    try {
      fingerprint = await importSageTreasuryKey(config, secret);
    } catch {
      /* key may already be in Sage — fall through to get_keys / login */
    }
  }
  if (!fingerprint) {
    try {
      const listed = await treasuryWalletRpcRequest<{ keys?: Array<{ fingerprint?: number }> }>(
        config,
        "get_keys",
        {},
      );
      const fingerprints = (listed.keys ?? [])
        .map((key) => key.fingerprint)
        .filter((value): value is number => typeof value === "number");
      if (fingerprints.length === 1) {
        fingerprint = fingerprints[0];
      }
    } catch {
      /* Sage RPC may still be starting */
    }
  }
  const next = { ...config, sageFingerprint: fingerprint };
  await ensureSageTreasuryLoggedIn(next);
  return next;
}
