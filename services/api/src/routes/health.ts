import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";

export function registerHealthRoutes(app: FastifyInstance, chia: ChiaGamingClient): void {
  app.get("/health", async () => ({
    status: "ok",
    service: "dat-poker-api",
    buildRef: process.env.DAT_POKER_REPO_REF?.trim() || null,
    lobby: {
      cash6Max: true,
      sng9Max: true,
      /** POST /v1/tables/join-mtt — 16-player two-table MTT */
      mtt16: true,
    },
  }));

  app.get("/health/chia-gaming", async () => {
    const lobbyOk = await chia.pingLobby();
    return {
      lobby: lobbyOk ? "up" : "down",
      lobbyUrl: chia.lobbyBaseUrl,
      gameUrl: chia.gameBaseUrl,
    };
  });
}
