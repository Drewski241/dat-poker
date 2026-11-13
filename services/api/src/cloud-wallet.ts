import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Cloud Wallet only receives a DAT offer that treasury Sage already built.
 * Connect stays off until CHIA_CLOUD_WALLET_CLIENT_ID is set on this host.
 * A client secret, when the portal issued one, is sent only from this server.
 */

export const CLOUD_WALLET_REDIRECT_URI = "https://datspiritpoker.com/v1/wallet/cloud/callback";

export const CLOUD_WALLET_SCOPES = "wallet.read offer.read offer.accept offline_access";

const SESSION_COOKIE = "dp_cloud";
const STATE_COOKIE = "dp_cloud_state";
const PENDING_TTL_MS = 10 * 60 * 1000;

export interface CloudWalletConfig {
  clientId: string | null;
  clientSecret: string | null;
  apiOrigin: string;
}

export interface CloudPlayer {
  sessionId: string;
  address: string;
  walletId: string;
  datSpendableMojos: string | null;
}

export interface CloudWalletPublicStatus {
  enabled: boolean;
  connected: boolean;
  address: string | null;
  datSpendableMojos: string | null;
}

interface PendingOAuth {
  verifier: string;
  createdAt: number;
}

interface CloudSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  walletId: string;
  address: string;
  datSpendableMojos: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface VaultAddress {
  index?: number;
  address?: string;
}

interface WalletNode {
  id?: string;
  state?: string;
  vaultAddresses?: VaultAddress[];
  dat?: { spendableAmount?: string | number | null } | null;
}

const pending = new Map<string, PendingOAuth>();
const sessions = new Map<string, CloudSession>();

let fetchImpl: typeof fetch = globalThis.fetch;

export function readCloudWalletConfig(): CloudWalletConfig {
  const clientId = process.env.CHIA_CLOUD_WALLET_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET?.trim() || null;
  const override = process.env.CHIA_CLOUD_WALLET_API_ORIGIN?.trim();
  const apiOrigin = (override || defaultApiOrigin()).replace(/\/$/, "");
  return { clientId, clientSecret, apiOrigin };
}

function defaultApiOrigin(): string {
  return process.env.CHIA_NETWORK === "testnet"
    ? "https://api.vault.chiatest.net"
    : "https://api.vault.chia.net";
}

export function cloudWalletEnabled(): boolean {
  return Boolean(readCloudWalletConfig().clientId);
}

export function publicCloudWalletStatus(player: CloudPlayer | null): CloudWalletPublicStatus {
  const enabled = cloudWalletEnabled();
  if (!enabled || !player) {
    return { enabled, connected: false, address: null, datSpendableMojos: null };
  }
  return {
    enabled: true,
    connected: true,
    address: player.address,
    datSpendableMojos: player.datSpendableMojos,
  };
}

export function buildCloudAuthorizeUrl(params: {
  apiOrigin: string;
  clientId: string;
  state: string;
  codeChallenge: string;
}): URL {
  const url = new URL("/authorize", params.apiOrigin);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", CLOUD_WALLET_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CLOUD_WALLET_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export function buildCloudTokenForm(params: {
  grantType: "authorization_code" | "refresh_token";
  clientId: string;
  clientSecret?: string | null;
  code?: string;
  codeVerifier?: string;
  refreshToken?: string;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", params.grantType);
  body.set("client_id", params.clientId);
  if (params.grantType === "authorization_code") {
    body.set("redirect_uri", CLOUD_WALLET_REDIRECT_URI);
    if (params.code) body.set("code", params.code);
    if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);
  } else if (params.refreshToken) {
    body.set("refresh_token", params.refreshToken);
  }
  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }
  return body;
}

export function resetCloudWalletForTests(nextFetch?: typeof fetch): void {
  pending.clear();
  sessions.clear();
  fetchImpl = nextFetch ?? globalThis.fetch;
}

export async function cloudPlayerFromRequest(req: FastifyRequest): Promise<CloudPlayer | null> {
  if (!cloudWalletEnabled()) return null;
  const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  try {
    await ensureAccessToken(session);
    const profile = await loadProfile(session.accessToken);
    session.walletId = profile.walletId;
    session.address = profile.address;
    session.datSpendableMojos = profile.datSpendableMojos;
    return {
      sessionId,
      address: profile.address,
      walletId: profile.walletId,
      datSpendableMojos: profile.datSpendableMojos,
    };
  } catch {
    sessions.delete(sessionId);
    return null;
  }
}

export async function deliverTreasuryOffer(
  sessionId: string,
  offer: string,
  feeMojos: bigint,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session || !offer.startsWith("offer1")) {
    throw new Error("Could not send the DAT offer to your Cloud Wallet.");
  }
  const token = await ensureAccessToken(session);
  const offerId = await importOffer(token, session.walletId, offer);
  try {
    await takeImportedOffer(token, session.walletId, offerId, feeMojos);
  } catch {
    // addOffer already put the treasury offer in the player's wallet.
  }
}

export async function beginCloudWalletConnect(reply: FastifyReply): Promise<{ url: string } | null> {
  const config = readCloudWalletConfig();
  if (!config.clientId) return null;
  prunePending();
  const state = randomUUID();
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  pending.set(state, { verifier, createdAt: Date.now() });
  reply.header(
    "set-cookie",
    cookieValue(STATE_COOKIE, state, 600, reply.request),
  );
  const url = buildCloudAuthorizeUrl({
    apiOrigin: config.apiOrigin,
    clientId: config.clientId,
    state,
    codeChallenge: challenge,
  });
  return { url: url.toString() };
}

export async function finishCloudWalletCallback(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = req.query as { code?: string; state?: string; error?: string };
  const fail = () => {
    reply.header("cache-control", "no-store");
    reply.header("set-cookie", clearCookie(STATE_COOKIE, req));
    return reply.redirect("/?cloudWallet=denied", 302);
  };

  if (!cloudWalletEnabled() || query.error || !query.code || !query.state) {
    return fail();
  }

  const cookieState = readCookie(req.headers.cookie, STATE_COOKIE);
  const pendingAuth = pending.get(query.state);
  pending.delete(query.state);
  if (!pendingAuth || cookieState !== query.state || Date.now() - pendingAuth.createdAt > PENDING_TTL_MS) {
    return fail();
  }

  try {
    const config = readCloudWalletConfig();
    const tokens = await exchangeCode(config, query.code, pendingAuth.verifier);
    const profile = await loadProfile(tokens.accessToken);
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      walletId: profile.walletId,
      address: profile.address,
      datSpendableMojos: profile.datSpendableMojos,
    });
    reply.header("cache-control", "no-store");
    reply.header("set-cookie", [
      clearCookie(STATE_COOKIE, req),
      cookieValue(SESSION_COOKIE, sessionId, sessionMaxAge(tokens.expiresAt, Boolean(tokens.refreshToken)), req),
    ]);
    return reply.redirect("/", 302);
  } catch {
    return fail();
  }
}

export async function disconnectCloudWallet(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (sessionId) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session) {
      const token = session.refreshToken ?? session.accessToken;
      try {
        await revokeToken(token);
      } catch {
        // The local session is already gone.
      }
    }
  }
  reply.header("set-cookie", clearCookie(SESSION_COOKIE, req));
}

function sessionMaxAge(expiresAt: number, hasRefresh: boolean): number {
  if (hasRefresh) return 30 * 24 * 60 * 60;
  return Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
}

async function ensureAccessToken(session: CloudSession): Promise<string> {
  if (session.expiresAt > Date.now() + 30_000) return session.accessToken;
  if (!session.refreshToken) {
    throw new Error("Cloud Wallet session expired");
  }
  const config = readCloudWalletConfig();
  if (!config.clientId) throw new Error("Cloud Wallet is unavailable");
  const body = buildCloudTokenForm({
    grantType: "refresh_token",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: session.refreshToken,
  });
  const tokens = await requestToken(config.apiOrigin, body);
  session.accessToken = tokens.accessToken;
  session.refreshToken = tokens.refreshToken ?? session.refreshToken;
  session.expiresAt = tokens.expiresAt;
  return session.accessToken;
}

async function exchangeCode(
  config: CloudWalletConfig,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  if (!config.clientId) throw new Error("Cloud Wallet is unavailable");
  const body = buildCloudTokenForm({
    grantType: "authorization_code",
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    codeVerifier: verifier,
  });
  return requestToken(config.apiOrigin, body);
}

async function requestToken(
  apiOrigin: string,
  body: URLSearchParams,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const res = await fetchImpl(`${apiOrigin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const payload = (await readJson(res)) as TokenResponse | null;
  if (!res.ok || !payload?.access_token) {
    throw new Error("Cloud Wallet token exchange failed");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function revokeToken(token: string): Promise<void> {
  const config = readCloudWalletConfig();
  if (!config.clientId) return;
  const body = new URLSearchParams();
  body.set("client_id", config.clientId);
  body.set("token", token);
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const res = await fetchImpl(`${config.apiOrigin}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Cloud Wallet revoke failed");
}

async function loadProfile(accessToken: string): Promise<{
  walletId: string;
  address: string;
  datSpendableMojos: string | null;
}> {
  const assetId = process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID?.trim() || null;
  const data = await graphql<{
    viewer?: { wallets?: { edges?: { node?: WalletNode }[] } };
  }>(accessToken, PROFILE_QUERY, { assetHash: assetId });
  const nodes = (data.viewer?.wallets?.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is WalletNode => Boolean(node));
  const ready = nodes.filter((node) => node.state === "READY" && node.id?.startsWith("Wallet_"));
  const ranked = ready
    .map((node) => ({
      node,
      address: primaryAddress(node),
      balance: mojos(node.dat?.spendableAmount),
    }))
    .filter((item): item is { node: WalletNode; address: string; balance: string | null } => Boolean(item.address));
  ranked.sort((a, b) => {
    const aBal = a.balance ? BigInt(a.balance) : 0n;
    const bBal = b.balance ? BigInt(b.balance) : 0n;
    if (aBal === bBal) return 0;
    return aBal > bBal ? -1 : 1;
  });
  const chosen = ranked[0];
  if (!chosen?.node.id) {
    throw new Error("Cloud Wallet has no ready vault");
  }
  return {
    walletId: chosen.node.id,
    address: chosen.address,
    datSpendableMojos: assetId ? chosen.balance : null,
  };
}

async function importOffer(accessToken: string, walletId: string, offer: string): Promise<string> {
  const data = await graphql<{
    addOffer?: { offer?: { offerId?: string } };
  }>(accessToken, ADD_OFFER_MUTATION, { input: { walletId, offer } });
  const offerId = data.addOffer?.offer?.offerId;
  if (!offerId?.startsWith("Offer_")) {
    throw new Error("Cloud Wallet did not accept the offer");
  }
  return offerId;
}

async function takeImportedOffer(
  accessToken: string,
  walletId: string,
  offerId: string,
  feeMojos: bigint,
): Promise<void> {
  await graphql(accessToken, TAKE_OFFER_MUTATION, {
    input: {
      walletId,
      offerId,
      fee: feeMojos.toString(),
      autoSubmit: true,
    },
  });
}

async function graphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { apiOrigin } = readCloudWalletConfig();
  const res = await fetchImpl(`${apiOrigin}/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = (await readJson(res)) as { data?: T; errors?: unknown[] } | null;
  if (!res.ok || !payload?.data || payload.errors?.length) {
    throw new Error("Cloud Wallet request failed");
  }
  return payload.data;
}

function primaryAddress(node: WalletNode): string | null {
  const addresses = [...(node.vaultAddresses ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );
  const primary = addresses.find((item) => item.index === 0) ?? addresses[0];
  const address = primary?.address;
  if (!address || !/^(txch1|xch1)[a-z0-9]{10,}$/.test(address)) return null;
  return address;
}

function mojos(value: string | number | null | undefined): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function prunePending(): void {
  const now = Date.now();
  for (const [state, auth] of pending) {
    if (now - auth.createdAt > PENDING_TTL_MS) pending.delete(state);
  }
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function cookieValue(name: string, value: string, maxAge: number, req: FastifyRequest): string {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearCookie(name: string, req: FastifyRequest): string {
  const secure = requestIsHttps(req) ? "; Secure" : "";
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function requestIsHttps(req: FastifyRequest): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return proto === "https" || process.env.NODE_ENV === "production";
}

const PROFILE_QUERY = `query CloudProfile($assetHash: String) {
  viewer {
    wallets(first: 20) {
      edges {
        node {
          id
          state
          vaultAddresses { index address }
          dat: asset(assetHash: $assetHash) { spendableAmount }
        }
      }
    }
  }
}`;

const ADD_OFFER_MUTATION = `mutation ImportOffer($input: AddOfferInput!) {
  addOffer(input: $input) {
    offer { id offerId state }
  }
}`;

const TAKE_OFFER_MUTATION = `mutation TakeOffer($input: TakeOfferInput!) {
  takeOffer(input: $input) {
    signatureRequest { id status }
  }
}`;
