import type { FastifyInstance } from "fastify";
import type { ChiaGamingClient } from "@dat-poker/chia-bridge";
import { readMtt16FieldSize, readMttFieldSize } from "../mtt-env.js";

export function registerHealthRoutes(app: FastifyInstance, chia: ChiaGamingClient): void {
  app.get("/health", async () => ({
    status: "ok",
    service: "dat-poker-api",
    buildRef: process.env.DAT_POKER_REPO_REF?.trim() || null,
    lobby: {
      cash6Max: true,
      sng9Max: true,
      /** POST /v1/tables/join-mtt16 — 16-player sit-n-go (two 8-max tables + final) */
      mtt16Sng: true,
      /** POST /v1/tables/join-mtt — multi-table MTT (field size from env, 500 on beta) */
      mttFieldSize: readMttFieldSize(),
      mtt16FieldSize: readMtt16FieldSize(),
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
