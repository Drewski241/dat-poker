import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { POKER_VARIANTS } from "@dat-poker/shared";
import { registerCatChannelRoutes } from "./routes/cat-channel.js";
import { registerHandRoutes } from "./routes/hands.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerWalletRoutes } from "./routes/wallet.js";
import { serializeForJson } from "./serialize.js";

export function createChiaClient(): ChiaGamingClient {
  return new ChiaGamingClient({
    network: (process.env.CHIA_NETWORK as "mainnet" | "testnet") ?? "mainnet",
    lobbyUrl: process.env.CHIA_GAMING_LOBBY_URL ?? "http://localhost:3001",
    gameUrl: process.env.CHIA_GAMING_GAME_URL ?? "http://localhost:3000",
    coinsetUrl: process.env.COINSET_URL ?? "https://coinset.org",
    walletConnect: process.env.WALLETCONNECT_PROJECT_ID
      ? {
          projectId: process.env.WALLETCONNECT_PROJECT_ID,
          chainId: process.env.CHIA_CHAIN_ID ?? "chia:mainnet",
        }
      : undefined,
  });
}

export async function buildApp(
  chiaClient: ChiaGamingClient = createChiaClient(),
  options?: { logger?: boolean },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options?.logger ?? false });
  await app.register(cors, { origin: true });

  app.addHook("preSerialization", async (_request, _reply, payload) => {
    if (payload === undefined || payload === null) return payload;
    return serializeForJson(payload);
  });

  registerHealthRoutes(app, chiaClient);
  registerWalletRoutes(app, chiaClient);
  registerTableRoutes(app);
  registerHandRoutes(app);
  registerCatChannelRoutes(app);

  app.get("/v1/variants", async () => ({
    variants: POKER_VARIANTS,
  }));

  return app;
}
