import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serializeForJson } from "./serialize.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerHandRoutes } from "./routes/hands.js";
import {
  initTournamentStore,
  registerTournamentRoutes,
} from "./routes/tournaments.js";
import { isHousePlayerId } from "@dat-poker/shared";
import { actorPlayerId } from "@dat-poker/game-engine";
import { getTableEngine } from "./routes/tables.js";

describe("playable SNG hand wiring", () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    process.env.DAT_ACCOUNTS_PATH = "memory";
    process.env.DAT_LEDGER_PATH = "memory";
    delete process.env.DATABASE_URL;
    app.addHook("preSerialization", async (_req, _reply, payload) => {
      if (payload === undefined || payload === null) return payload;
      return serializeForJson(payload);
    });
    await initTournamentStore();
    registerTableRoutes(app);
    registerHandRoutes(app);
    registerTournamentRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a house-filled SNG and plays a hand via table routes", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/tournaments/playable-sng",
      payload: { playerId: "alice", maxSeats: 4, buyInMojos: "1000" },
    });
    expect(create.statusCode).toBe(200);
    const body = create.json() as {
      tournamentId: string;
      tableId: string;
      houseCount: number;
      seats: { playerId: string }[];
    };
    expect(body.houseCount).toBe(3);
    expect(body.seats).toHaveLength(4);
    expect(body.seats.some((s) => s.playerId === "alice")).toBe(true);
    expect(body.seats.filter((s) => isHousePlayerId(s.playerId))).toHaveLength(3);

    const start = await app.inject({
      method: "POST",
      url: `/v1/tables/${body.tableId}/hands/start`,
      payload: {},
    });
    expect(start.statusCode).toBe(200);

    const seed = await app.inject({
      method: "POST",
      url: `/v1/tables/${body.tableId}/hands/seed`,
      payload: { playerId: "alice" },
    });
    expect(seed.statusCode).toBe(200);
    const seeded = seed.json() as { dealt: boolean; hand: { actionSeat: number | null } | null };
    expect(seeded.dealt).toBe(true);

    const engine = getTableEngine(body.tableId);
    expect(engine).toBeTruthy();

    // Drive until hand ends or alice must act (fold when it's her turn)
    let guard = 0;
    while (engine!.isHandInProgress() && guard++ < 40) {
      const actor = actorPlayerId(engine!);
      if (!actor || isHousePlayerId(actor)) break;
      const action = await app.inject({
        method: "POST",
        url: `/v1/tables/${body.tableId}/hands/action`,
        payload: { playerId: "alice", action: "fold" },
      });
      expect(action.statusCode).toBe(200);
      const res = action.json() as {
        tournament?: { summary: { activeCount: number } };
      };
      if (!engine!.isHandInProgress()) {
        expect(res.tournament).toBeTruthy();
      }
    }

    const tableGet = await app.inject({
      method: "GET",
      url: `/v1/tables/${body.tableId}`,
    });
    expect(tableGet.statusCode).toBe(200);
  });
});
