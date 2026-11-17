import { describe, expect, it } from "vitest";
import {
  CHIA_CLOUD_WALLET_SCOPES,
  createPkceAuthorization,
  readChiaCloudWalletConfig,
  vaultApiOriginForNetwork,
} from "./chia-cloud-wallet.js";

describe("readChiaCloudWalletConfig", () => {
  it("stays disabled without client id", () => {
    const cfg = readChiaCloudWalletConfig({
      CHIA_NETWORK: "mainnet",
      API_PORT: "4000",
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.clientId).toBe("");
  });

  it("enables connect when client id is present", () => {
    const cfg = readChiaCloudWalletConfig({
      CHIA_CLOUD_WALLET_CLIENT_ID: "app_test",
      CHIA_CLOUD_WALLET_REDIRECT_URI: "https://datspiritpoker.com/v1/wallet/cloud/callback",
      CHIA_NETWORK: "mainnet",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.redirectUri).toBe("https://datspiritpoker.com/v1/wallet/cloud/callback");
    expect(cfg.vaultApiOrigin).toBe("https://api.vault.chia.net");
  });
});

describe("createPkceAuthorization", () => {
  it("includes required scopes and PKCE parameters", () => {
    const cfg = readChiaCloudWalletConfig({
      CHIA_CLOUD_WALLET_CLIENT_ID: "app_test",
      CHIA_CLOUD_WALLET_REDIRECT_URI: "https://example.com/callback",
      CHIA_NETWORK: "testnet11",
    });
    const auth = createPkceAuthorization(cfg);
    const url = new URL(auth.authorizeUrl);
    expect(url.origin).toBe(vaultApiOriginForNetwork("testnet11"));
    expect(url.searchParams.get("client_id")).toBe("app_test");
    expect(url.searchParams.get("scope")).toBe(CHIA_CLOUD_WALLET_SCOPES);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(auth.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });
});