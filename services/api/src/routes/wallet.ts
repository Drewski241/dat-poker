import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";

function readDatTokenConfig() {
  const assetId = process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID?.trim() || undefined;
  const devBuyInEnabled = process.env.DAT_ALLOW_DEV_BUYIN === "true";
  return {
    assetId: assetId ?? null,
    ticker: process.env.DAT_GOVERNANCE_TOKEN_TICKER ?? "DAT",
    minBuyInMojos: process.env.DAT_MIN_BUY_IN_MOJOS ?? "2000000000000",
    devBuyInEnabled,
    buyInReady: Boolean(assetId) || devBuyInEnabled,
  };
}

export function registerWalletRoutes(app: FastifyInstance, chia: ChiaGamingClient): void {
  app.get("/v1/wallet/config", async () => {
    const projectId = process.env.WALLETCONNECT_PROJECT_ID?.trim();
    const chainId = process.env.CHIA_CHAIN_ID ?? "chia:mainnet";

    return {
      chiaNetwork: process.env.CHIA_NETWORK ?? "mainnet",
      chainId,
      coinsetUrl: process.env.COINSET_URL ?? "https://coinset.org",
      walletConnect: projectId
        ? {
            projectId,
            chainId,
          }
        : null,
      chiaGaming: {
        lobbyUrl: chia.lobbyBaseUrl,
        gameUrl: chia.gameBaseUrl,
      },
    };
  });

  app.get("/v1/wallet/dat-token", async () => readDatTokenConfig());

  app.get("/v1/wallet/status", async () => {
    const dat = readDatTokenConfig();
    const lobbyOk = await chia.pingLobby();
    return {
      dat,
      walletConnectConfigured: Boolean(process.env.WALLETCONNECT_PROJECT_ID?.trim()),
      chiaGamingLobby: lobbyOk ? "up" : "down",
    };
  });
}
