import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerCloudWalletRoutes } from "./routes/cloud-wallet.js";
import { issueTestSession, resetPlayerSessionsForTests } from "./player-session.js";
import {
  acceptCloudWalletOffer,
  resetCloudWalletForTests,
  setCloudWalletFetchForTests,
} from "./cloud-wallet.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Chia Cloud Wallet connect", () => {
  afterEach(() => {
    resetCloudWalletForTests();
    resetPlayerSessionsForTests();
    delete process.env.CHIA_CLOUD_WALLET_CLIENT_ID;
    delete process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET;
    delete process.env.CHIA_CLOUD_WALLET_REDIRECT_URI;
    delete process.env.CHIA_CLOUD_WALLET_RETURN_URL;
    delete process.env.CHIA_CLOUD_WALLET_API_BASE;
  });

  it("stays off until an OAuth client is registered, then stores a vault address without exposing tokens", async () => {
    process.env.DAT_SESSION_SECRET = "dat-poker-test-session";
    process.env.DAT_CLOUD_WALLET_PATH = "memory";
    process.env.CHIA_CLOUD_WALLET_RETURN_URL = "https://datspiritpoker.com/play";
    resetCloudWalletForTests();
    resetPlayerSessionsForTests();

    const app = Fastify();
    registerCloudWalletRoutes(app);
    const { token, session } = issueTestSession("player-one");
    const headers = { authorization: `Bearer ${token}` };

    const blocked = await app.inject({ method: "POST", url: "/v1/wallet/cloud/start", headers });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.body).toContain("CHIA_CLOUD_WALLET_CLIENT_ID");

    process.env.CHIA_CLOUD_WALLET_CLIENT_ID = "client-dat-poker";
    process.env.CHIA_CLOUD_WALLET_CLIENT_SECRET = "secret-only-on-host";
    process.env.CHIA_CLOUD_WALLET_REDIRECT_URI = "https://datspiritpoker.com/v1/wallet/cloud/callback";

    const started = await app.inject({ method: "POST", url: "/v1/wallet/cloud/start", headers });
    expect(started.statusCode).toBe(200);
    const { authorizeUrl } = JSON.parse(started.body) as { authorizeUrl: string };
    const authorize = new URL(authorizeUrl);
    expect(authorize.pathname).toBe("/api/auth/oauth2/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("client-dat-poker");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://datspiritpoker.com/v1/wallet/cloud/callback",
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("scope")).toContain("offer.accept");
    const state = authorize.searchParams.get("state");
    expect(state).toBeTruthy();

    const missing = await app.inject({
      method: "GET",
      url: "/v1/wallet/cloud/callback?state=not-ours&code=nope",
    });
    expect(missing.statusCode).toBe(302);
    expect(missing.headers.location).toContain("cloud=error");

    let tokenBody = "";
    const graphqlBodies: { query: string; variables?: { input?: Record<string, unknown> } }[] = [];
    setCloudWalletFetchForTests(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        tokenBody = String(init?.body ?? "");
        return jsonResponse({ access_token: "atk-secret", refresh_token: "rtk-secret", expires_in: 3600 });
      }
      if (url.endsWith("/graphql")) {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          query: string;
          variables?: { input?: Record<string, unknown> };
        };
        graphqlBodies.push(parsed);
        if (parsed.query.includes("oAuthConsentedWallets")) {
          return jsonResponse({
            data: {
              oAuthConsentedWallets: [
                {
                  id: "wal_1",
                  name: "Main",
                  state: "READY",
                  vaultAddresses: [
                    { index: 1, address: "xch1later" },
                    { index: 0, address: "xch1vault" },
                  ],
                },
              ],
            },
          });
        }
        if (parsed.query.includes("addOffer")) {
          return jsonResponse({ data: { addOffer: { offer: { offerId: "off_1" } } } });
        }
        if (parsed.query.includes("takeOffer")) {
          return jsonResponse({ data: { takeOffer: { signatureRequest: { status: "SUBMITTED" } } } });
        }
      }
      if (url.endsWith("/oauth2/revoke")) return jsonResponse({});
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const callback = await app.inject({
      method: "GET",
      url: `/v1/wallet/cloud/callback?state=${encodeURIComponent(state!)}&code=auth-code`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("https://datspiritpoker.com/play");
    expect(callback.headers.location).toContain("cloud=connected");
    expect(tokenBody).toContain("client_secret=secret-only-on-host");
    expect(tokenBody).toContain("code_verifier=");

    const status = await app.inject({ method: "GET", url: "/v1/wallet/cloud", headers });
    expect(status.statusCode).toBe(200);
    const body = JSON.parse(status.body) as { address: string; connected: boolean };
    expect(body.connected).toBe(true);
    expect(body.address).toBe("xch1vault");
    expect(status.body).not.toContain("atk-secret");
    expect(status.body).not.toContain("rtk-secret");

    const accepted = await acceptCloudWalletOffer(session.playerId, "offer1abc");
    expect(accepted.status).toBe("SUBMITTED");
    const take = graphqlBodies.find((row) => row.query.includes("takeOffer"));
    expect(take?.variables?.input).toMatchObject({
      walletId: "wal_1",
      offerId: "off_1",
      fee: "0",
      autoSubmit: true,
    });

    const gone = await app.inject({ method: "POST", url: "/v1/wallet/cloud/disconnect", headers });
    expect(JSON.parse(gone.body).connected).toBe(false);
    await app.close();
  });
});
