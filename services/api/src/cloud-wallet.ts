import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCOPES = "wallet.read offer.read offer.accept offline_access";
const PENDING_MS = 10 * 60_000;

export type CloudWalletPublic = {
  configured: boolean;
  connected: boolean;
  walletId: string | null;
  walletName: string | null;
  address: string | null;
};

type PendingAuth = {
  playerId: string;
  codeVerifier: string;
  createdAt: number;
};

type StoredConnection = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  walletId: string;
  walletName: string;
  address: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type VaultAddress = { index?: number; address?: string };
type ConsentedWallet = {
  id?: string;
  name?: string;
  state?: string;
  vaultAddresses?: VaultAddress[];
};

let fetchImpl: typeof fetch = globalThis.fetch;
const pending = new Map<string, PendingAuth>();
const connections = new Map<string, StoredConnection>();
let loaded = false;

export function setCloudWalletFetchForTests(next: typeof fetch | null): void {
  fetchImpl = next ?? globalThis.fetch;
}

export function resetCloudWalletForTests(): void {
  pending.clear();
  connections.clear();
  loaded = false;
  fetchImpl = globalThis.fetch;
}

function storePath(): string | null {
  const raw = process.env.DAT_CLOUD_WALLET_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../data/cloud-wallets.json");
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const path = storePath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { connections?: Record<string, StoredConnection> };
    for (const [playerId, row] of Object.entries(parsed.connections ?? {})) {
      if (row?.accessToken && row.address && row.walletId) connections.set(playerId, row);
    }
  } catch {
    /* first run */
  }
}

function persist(): void {
  const path = storePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const obj: Record<string, StoredConnection> = {};
  for (const [playerId, row] of connections) obj[playerId] = row;
  writeFileSync(path, JSON.stringify({ connections: obj }), { encoding: "utf8", mode: 0o600 });
}

export function cloudWalletApiBase(): string {
  const explicit = process.env.CHIA_CLOUD_WALLET_API_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const network = process.env.CHIA_NETWORK?.trim();
  if (network === "testnet" || network === "testnet11") return "https://api.vault.chiatest.net";
  return "https://api.vault.chia.net";
}

export function cloudWalletClientId(): string | null {
  const id = process.env.CHIA_CLOUD_WALLET_CLIENT_ID?.trim();
  return id || null;
}

export function cloudWalletConfigured(): boolean {
  return Boolean(cloudWalletClientId() && process.env.CHIA_CLOUD_WALLET_REDIRECT_URI?.trim());
}

function redirectUri(): string {
  const uri = process.env.CHIA_CLOUD_WALLET_REDIRECT_URI?.trim();
  if (!uri) throw new Error("CHIA_CLOUD_WALLET_REDIRECT_URI is not set");
  return uri;
}

export function cloudWalletReturnUrl(result: "connected" | "error", message?: string): string {
  const base = process.env.CHIA_CLOUD_WALLET_RETURN_URL?.trim() || "https://datspiritpoker.com/play";
  const url = new URL(base);
  url.searchParams.set("cloud", result);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return url.toString();
}

export function cloudWalletPublic(playerId: string): CloudWalletPublic {
  load();
  const row = connections.get(playerId);
  return {
    configured: cloudWalletConfigured(),
    connected: Boolean(row),
    walletId: row?.walletId ?? null,
    walletName: row?.walletName ?? null,
    address: row?.address ?? null,
  };
}

export function startCloudWalletConnect(playerId: string): { authorizeUrl: string } {
  const clientId = cloudWalletClientId();
  if (!clientId || !process.env.CHIA_CLOUD_WALLET_REDIRECT_URI?.trim()) {
    throw new Error(
      "Chia Cloud Wallet is not configured. Set CHIA_CLOUD_WALLET_CLIENT_ID and CHIA_CLOUD_WALLET_REDIRECT_URI on the API host.",
    );
  }
  const state = randomUUID();
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  pending.set(state, { playerId, codeVerifier, createdAt: Date.now() });
  const url = new URL(`${cloudWalletApiBase()}/api/auth/oauth2/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: url.toString() };
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const clientId = cloudWalletClientId();
  if (!clientId) throw new Error("Chia Cloud Wallet is not configured");
  body.set("client_id", clientId);
  const secret = process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET?.trim();
  if (secret) body.set("client_secret", secret);
  const res = await fetchImpl(`${cloudWalletApiBase()}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await res.json()) as TokenResponse;
  if (!res.ok || !payload.access_token) {
    throw new Error("Chia Cloud Wallet rejected the connection. Connect again.");
  }
  return payload;
}

async function graphql<T>(accessToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetchImpl(`${cloudWalletApiBase()}/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (!res.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || "Chia Cloud Wallet request failed");
  }
  if (!payload.data) throw new Error("Chia Cloud Wallet returned an empty response");
  return payload.data;
}

function pickAddress(wallets: ConsentedWallet[]): { walletId: string; walletName: string; address: string } {
  const ready = wallets.filter((wallet) => wallet.id && (wallet.vaultAddresses?.length ?? 0) > 0);
  const preferred = ready.find((wallet) => wallet.state === "READY") ?? ready[0];
  if (!preferred?.id) {
    throw new Error("Cloud Wallet did not grant a vault with a receive address. Connect again and allow a vault.");
  }
  const addresses = [...(preferred.vaultAddresses ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const address = addresses.find((row) => row.address?.startsWith("xch") || row.address?.startsWith("txch"))?.address;
  if (!address) {
    throw new Error("Cloud Wallet did not grant a vault with a receive address. Connect again and allow a vault.");
  }
  return { walletId: preferred.id, walletName: preferred.name?.trim() || "Cloud Wallet", address };
}

const WALLETS_QUERY = `query Destinations {
  oAuthConsentedWallets { id name state vaultAddresses { index address } }
}`;

async function rememberConnection(playerId: string, token: TokenResponse): Promise<StoredConnection> {
  if (!token.access_token) throw new Error("Chia Cloud Wallet rejected the connection. Connect again.");
  const data = await graphql<{ oAuthConsentedWallets?: ConsentedWallet[] }>(token.access_token, WALLETS_QUERY);
  const picked = pickAddress(data.oAuthConsentedWallets ?? []);
  const row: StoredConnection = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? SCOPES,
    ...picked,
  };
  connections.set(playerId, row);
  persist();
  return row;
}

export async function completeCloudWalletConnect(state: string, code: string): Promise<void> {
  load();
  const auth = pending.get(state);
  pending.delete(state);
  if (!auth || Date.now() - auth.createdAt > PENDING_MS) {
    throw new Error("Cloud Wallet connect expired. Start again from the site.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: auth.codeVerifier,
  });
  const token = await tokenRequest(body);
  await rememberConnection(auth.playerId, token);
}

async function accessTokenFor(playerId: string): Promise<StoredConnection> {
  load();
  const row = connections.get(playerId);
  if (!row) throw new Error("Connect Chia Cloud Wallet before withdrawing DAT there.");
  if (Date.now() < row.expiresAt - 30_000) return row;
  if (!row.refreshToken) {
    connections.delete(playerId);
    persist();
    throw new Error("Cloud Wallet session expired. Connect again.");
  }
  try {
    const token = await tokenRequest(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refreshToken }),
    );
    const next: StoredConnection = {
      ...row,
      accessToken: token.access_token!,
      refreshToken: token.refresh_token ?? row.refreshToken,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      scope: token.scope ?? row.scope,
    };
    connections.set(playerId, next);
    persist();
    return next;
  } catch (error) {
    connections.delete(playerId);
    persist();
    throw error;
  }
}

export async function acceptCloudWalletOffer(playerId: string, offer: string): Promise<{ status: string }> {
  const row = await accessTokenFor(playerId);
  const added = await graphql<{ addOffer?: { offer?: { offerId?: string } } }>(
    row.accessToken,
    `mutation AddOffer($input: AddOfferInput!) { addOffer(input: $input) { offer { offerId state } } }`,
    { input: { walletId: row.walletId, offer } },
  );
  const offerId = added.addOffer?.offer?.offerId;
  if (!offerId) throw new Error("Cloud Wallet did not accept the treasury offer");
  const taken = await graphql<{ takeOffer?: { signatureRequest?: { status?: string } } }>(
    row.accessToken,
    `mutation TakeOffer($input: TakeOfferInput!) {
      takeOffer(input: $input) { signatureRequest { id status } }
    }`,
    { input: { walletId: row.walletId, offerId, fee: "0", autoSubmit: true } },
  );
  return { status: taken.takeOffer?.signatureRequest?.status ?? "SUBMITTED" };
}

export async function disconnectCloudWallet(playerId: string): Promise<void> {
  load();
  const row = connections.get(playerId);
  connections.delete(playerId);
  persist();
  if (!row) return;
  const clientId = cloudWalletClientId();
  if (!clientId) return;
  const body = new URLSearchParams({
    client_id: clientId,
    token: row.refreshToken || row.accessToken,
  });
  const secret = process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET?.trim();
  if (secret) body.set("client_secret", secret);
  try {
    await fetchImpl(`${cloudWalletApiBase()}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    /* local disconnect still stands */
  }
}
