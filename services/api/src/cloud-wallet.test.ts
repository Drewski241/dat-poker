import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLOUD_WALLET_REDIRECT_URI,
  CLOUD_WALLET_SCOPES,
  buildCloudAuthorizeUrl,
  buildCloudTokenForm,
  publicCloudWalletStatus,
  resetCloudWalletForTests,
} from "./cloud-wallet.js";
import { registerCloudWalletRoutes } from "./routes/cloud-wallet.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { serializeForJson } from "./serialize.js";

const CLIENT_ID = "site-oauth-client";
const CLIENT_SECRET = "portal-issued-secret";
const ADDRESS = "xch1cloudwalletplayer";
const OFFER = "offer1treasurytestdatpayout";
const ASSET_ID = "ab".repeat(32);
const API_ORIGIN = "https://cloud.test";

const ENV_KEYS = [
  "CHIA_CLOUD_WALLET_CLIENT_ID",
  "CHIA_CLOUD_WALLET_CLIENT_SECRET",
  "CHIA_CLOUD_WALLET_API_ORIGIN",
  "CHIA_NETWORK",
  "DAT_GOVERNANCE_TOKEN_ASSET_ID",
  "DAT_ALLOW_DEV_BUYIN",
  "DAT_TREASURY_PAYOUT_URL",
  "DAT_WITHDRAW_PAYOUT_MODE",
  "DAT_MIN_BUY_IN_MOJOS",
  "NODE_ENV",
] as const;

const savedEnv = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((value) => value.split(";")[0]).join("; ");
}

function installFetch(options?: { failTake?: boolean; secret?: string | null }) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const raw = init?.body;
    const body = typeof raw === "string" ? raw : raw instanceof URLSearchParams ? raw.toString() : "";
    calls.push({ url, body });
    if (url.endsWith("/token") || url.endsWith("/revoke")) {
      if (options?.secret) {
        expect(body).toContain(`client_secret=${encodeURIComponent(options.secret)}`);
      } else {
        expect(body).not.toContain("client_secret");
      }
      if (url.endsWith("/revoke")) return jsonResponse({});
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (url.endsWith("/graphql")) {
      const query = JSON.parse(body) as { query: string; variables?: { input?: { offer?: string } } };
      if (query.query.includes("addOffer")) {
        expect(query.variables?.input?.offer).toBe(OFFER);
        return jsonResponse({
          data: { addOffer: { offer: { id: "WalletOffer_1", offerId: "Offer_abc", state: "ACTIVE" } } },
        });
      }
      if (query.query.includes("takeOffer")) {
        if (options?.failTake) {
          return jsonResponse({ errors: [{ message: "needs a signature in the wallet" }] });
        }
        return jsonResponse({
          data: { takeOffer: { signatureRequest: { id: "SignatureRequest_1", status: "UNSIGNED" } } },
        });
      }
      return jsonResponse({
        data: {
          viewer: {
            wallets: {
              edges: [
                {
                  node: {
                    id: "Wallet_ready",
                    state: "READY",
                    vaultAddresses: [{ index: 0, address: ADDRESS }],
                    dat: { spendableAmount: "5000000" },
                  },
                },
              ],
            },
          },
        },
      });
    }
    if (url.endsWith("/payout")) {
      return jsonResponse({ offer: OFFER });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  globalThis.fetch = fetchImpl;
  resetCloudWalletForTests(fetchImpl);
  return calls;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  const chia = new ChiaGamingClient({
    network: "mainnet",
    lobbyUrl: "http://127.0.0.1:9",
    gameUrl: "http://127.0.0.1:9",
    coinsetUrl: "https://coinset.org",
  });
  app.addHook("preSerialization", async (_request, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });
  registerWalletRoutes(app, chia);
  registerCloudWalletRoutes(app);
  registerTableRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  delete process.env.CHIA_CLOUD_WALLET_CLIENT_ID;
  delete process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET;
  process.env.CHIA_CLOUD_WALLET_API_ORIGIN = API_ORIGIN;
  process.env.CHIA_NETWORK = "mainnet";
  process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = ASSET_ID;
  process.env.DAT_ALLOW_DEV_BUYIN = "false";
  process.env.DAT_TREASURY_PAYOUT_URL = `${API_ORIGIN}/payout`;
  process.env.DAT_WITHDRAW_PAYOUT_MODE = "full";
  process.env.DAT_MIN_BUY_IN_MOJOS = "1000000";
  delete process.env.NODE_ENV;
  resetCloudWalletForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
  resetCloudWalletForTests();
});

describe("cloud wallet config", () => {
  it("keeps connect off and hides registration details until a client id is set", () => {
    const status = publicCloudWalletStatus(null);
    const encoded = JSON.stringify(status);
    expect(status).toEqual({
      enabled: false,
      connected: false,
      address: null,
      datSpendableMojos: null,
    });
    expect(encoded).not.toContain(CLOUD_WALLET_REDIRECT_URI);
    expect(encoded).not.toContain("wallet.read");
    expect(encoded).not.toContain("OAuth");
    expect(encoded).not.toContain("CLIENT_ID");
  });

  it("puts the secret only on the server token request", () => {
    const url = buildCloudAuthorizeUrl({
      apiOrigin: API_ORIGIN,
      clientId: CLIENT_ID,
      state: "state-1",
      codeChallenge: "challenge",
    });
    expect(url.searchParams.get("redirect_uri")).toBe(CLOUD_WALLET_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(CLOUD_WALLET_SCOPES);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(CLIENT_SECRET);
    expect(url.toString()).not.toContain("client_secret");

    const withSecret = buildCloudTokenForm({
      grantType: "authorization_code",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(withSecret.get("client_secret")).toBe(CLIENT_SECRET);
    expect(withSecret.get("redirect_uri")).toBe(CLOUD_WALLET_REDIRECT_URI);

    const withoutSecret = buildCloudTokenForm({
      grantType: "authorization_code",
      clientId: CLIENT_ID,
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(withoutSecret.has("client_secret")).toBe(false);
  });
});

describe("cloud wallet routes", () => {
  it("does not describe how to register when connect is off", async () => {
    const app = await buildApp();
    const status = await app.inject({ method: "GET", url: "/v1/wallet/cloud" });
    const connect = await app.inject({ method: "POST", url: "/v1/wallet/cloud/connect" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: false, connected: false });
    expect(connect.statusCode).toBe(404);
    const body = `${status.body}${connect.body}`;
    expect(body).not.toContain(CLOUD_WALLET_REDIRECT_URI);
    expect(body).not.toContain("wallet.read");
    expect(body).not.toContain("offline_access");
    expect(body).not.toContain("OAuth");
    expect(body).not.toContain("CLIENT_SECRET");
    await app.close();
  });

  it("drops provider errors instead of showing them to the player", async () => {
    process.env.CHIA_CLOUD_WALLET_CLIENT_ID = CLIENT_ID;
    const app = await buildApp();
    const denied = await app.inject({
      method: "GET",
      url: "/v1/wallet/cloud/callback?error=access_denied&error_description=pending+approval+from+Cloud+Wallet&state=nope",
    });
    expect(denied.statusCode).toBe(302);
    expect(denied.headers.location).toBe("/?cloudWallet=denied");
    expect(denied.headers.location).not.toContain("pending");
    expect(denied.body).not.toContain("approval");
    expect(denied.body).not.toContain(CLOUD_WALLET_REDIRECT_URI);
    await app.close();
  });

  it("delivers the treasury offer to Cloud Wallet and leaves the secret on the server", async () => {
    process.env.CHIA_CLOUD_WALLET_CLIENT_ID = CLIENT_ID;
    process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET = CLIENT_SECRET;
    const calls = installFetch({ secret: CLIENT_SECRET, failTake: true });
    const app = await buildApp();

    const connect = await app.inject({ method: "POST", url: "/v1/wallet/cloud/connect" });
    expect(connect.statusCode).toBe(200);
    const authorizeUrl = new URL(connect.json().url as string);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(CLOUD_WALLET_REDIRECT_URI);
    expect(authorizeUrl.searchParams.get("scope")).toBe(CLOUD_WALLET_SCOPES);
    expect(connect.body).not.toContain(CLIENT_SECRET);

    const state = authorizeUrl.searchParams.get("state");
    const callback = await app.inject({
      method: "GET",
      url: `/v1/wallet/cloud/callback?code=auth-code&state=${state}`,
      headers: { cookie: cookieHeader(connect.headers["set-cookie"]) },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    expect(JSON.stringify(callback.headers)).not.toContain(CLIENT_SECRET);

    const sessionCookie = cookieHeader(callback.headers["set-cookie"]);
    expect(sessionCookie).toContain("dp_cloud=");

    const status = await app.inject({
      method: "GET",
      url: "/v1/wallet/cloud",
      headers: { cookie: sessionCookie },
    });
    expect(status.json()).toEqual({
      enabled: true,
      connected: true,
      address: ADDRESS,
      datSpendableMojos: "5000000",
    });
    expect(status.body).not.toContain(CLIENT_SECRET);
    expect(status.body).not.toContain(CLIENT_ID);
    expect(status.body).not.toContain(CLOUD_WALLET_REDIRECT_URI);
    expect(status.body).not.toContain("wallet.read");

    const created = await app.inject({ method: "POST", url: "/v1/tables", payload: {} });
    const tableId = created.json().tableId as string;
    const seated = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/seat`,
      headers: { cookie: sessionCookie },
      payload: { playerId: ADDRESS, seatIndex: 0, buyInMojos: "1000000" },
    });
    expect(seated.statusCode).toBe(200);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      headers: { cookie: sessionCookie },
      payload: { tableId, playerId: ADDRESS },
    });
    expect(withdrawn.statusCode).toBe(200);
    const payout = withdrawn.json() as { deliveredTo?: string; offer?: string; note: string; mode: string };
    expect(payout.mode).toBe("offer");
    expect(payout.deliveredTo).toBe("cloud");
    expect(payout.offer).toBeUndefined();
    expect(payout.note).toBe("DAT offer sent to your Cloud Wallet.");
    expect(withdrawn.body).not.toContain(OFFER);
    expect(withdrawn.body).not.toContain(CLIENT_SECRET);
    expect(calls.some((call) => call.url.endsWith("/graphql") && call.body.includes(OFFER))).toBe(true);
    expect(calls.some((call) => call.body.includes("takeOffer"))).toBe(true);

    await app.close();
  });

  it("still returns a Sage offer when Cloud Wallet is not connected", async () => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    installFetch();
    const app = await buildApp();
    const created = await app.inject({ method: "POST", url: "/v1/tables", payload: {} });
    const tableId = created.json().tableId as string;
    const playerId = "xch1sageplayeraddr";
    const seated = await app.inject({
      method: "POST",
      url: `/v1/tables/${tableId}/seat`,
      payload: { playerId, seatIndex: 0, buyInMojos: "1000000", devAck: true },
    });
    expect(seated.statusCode).toBe(200);
    const withdrawn = await app.inject({
      method: "POST",
      url: "/v1/wallet/withdraw",
      payload: { tableId, playerId, devAck: true },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({ mode: "offer", offer: OFFER });
    expect(withdrawn.json().deliveredTo).toBeUndefined();
    await app.close();
  });
});

describe("website copy", () => {
  it("does not show Cloud Wallet registration on the site", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../apps/web");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const path = resolve(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx|ts|html|css)$/.test(entry)) files.push(path);
      }
    };
    walk(root);
    const source = files.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toContain(CLOUD_WALLET_REDIRECT_URI);
    expect(source).not.toContain("CHIA_CLOUD_WALLET");
    expect(source).not.toContain("wallet.read");
    expect(source).not.toContain("offer.accept");
    expect(source).not.toContain("offline_access");
    expect(source).not.toContain("OAuth Apps");
    expect(source).not.toContain("client_secret");
    expect(source).not.toContain("CLIENT_SECRET");
  });
});
