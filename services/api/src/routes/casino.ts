import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlackjackTable,
  CalpokerTable,
  VideoPokerTable,
} from "@dat-poker/game-engine";
import {
  CASINO_MAX_BUY_IN_MOJOS,
  CASINO_MIN_BUY_IN_MOJOS,
  DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
} from "@dat-poker/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { creditAccount, debitAccount, getAccountBalance } from "../account-store.js";
import { loadBlackjackTables, saveBlackjackTables } from "../blackjack-store.js";
import { loadCalpokerTables, saveCalpokerTables } from "../calpoker-store.js";
import { requirePlayer, type PlayerSession } from "../player-session.js";
import { loadVideoPokerTables, saveVideoPokerTables } from "../video-poker-store.js";

function casinoDataDir(): string {
  const override = process.env.DAT_CASINO_DATA_DIR?.trim();
  if (override) return resolve(override);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Bad request";
}

function sendError(reply: FastifyReply, error: unknown) {
  return reply.status(400).send({ error: errorMessage(error) });
}

function parseBuyIn(raw: unknown): bigint {
  const value = raw == null || raw === "" ? CASINO_MIN_BUY_IN_MOJOS : BigInt(String(raw));
  if (value < CASINO_MIN_BUY_IN_MOJOS || value > CASINO_MAX_BUY_IN_MOJOS) {
    throw new Error("Buy-in must be between 100 and 5000 DAT");
  }
  return value;
}

function parseLimit(raw: unknown): bigint | null {
  if (raw == null || raw === "") return null;
  return BigInt(String(raw));
}

interface OwnedTable {
  toSnapshot(): { id: string; playerId: string };
  takeStack(): bigint;
  view(): unknown;
}

function findOwned<T extends OwnedTable>(tables: Map<string, T>, playerId: string): T | undefined {
  return [...tables.values()].find((table) => table.toSnapshot().playerId === playerId);
}

function requireOwned<T extends OwnedTable>(
  tables: Map<string, T>,
  id: string,
  playerId: string,
  reply: FastifyReply,
): T | null {
  const table = tables.get(id);
  if (!table) {
    void reply.status(404).send({ error: "Table not found" });
    return null;
  }
  if (table.toSnapshot().playerId !== playerId) {
    void reply.status(403).send({ error: "That table belongs to another player" });
    return null;
  }
  return table;
}

function player(req: Parameters<typeof requirePlayer>[0], reply: FastifyReply): PlayerSession | null {
  return requirePlayer(req, reply);
}

/**
 * Blackjack, video poker, and California poker on the account ledger.
 * Buy-in debits the account. Leave credits whatever stack remains.
 * A second open for the same player returns the table they already hold.
 */
export function registerCasinoRoutes(app: FastifyInstance): void {
  const dir = casinoDataDir();
  mkdirSync(dir, { recursive: true });
  const blackjackFile = resolve(dir, "blackjack.json");
  const videoPokerFile = resolve(dir, "video-poker.json");
  const calpokerFile = resolve(dir, "calpoker.json");

  const blackjack = new Map(loadBlackjackTables(blackjackFile).map((table) => [table.toSnapshot().id, table]));
  const videoPoker = new Map(loadVideoPokerTables(videoPokerFile).map((table) => [table.toSnapshot().id, table]));
  const calpoker = new Map(loadCalpokerTables(calpokerFile).map((table) => [table.toSnapshot().id, table]));

  const saveBlackjack = () => saveBlackjackTables(blackjackFile, [...blackjack.values()]);
  const saveVideoPoker = () => saveVideoPokerTables(videoPokerFile, [...videoPoker.values()]);
  const saveCalpoker = () => saveCalpokerTables(calpokerFile, [...calpoker.values()]);

  function openTable<T extends OwnedTable>(
    tables: Map<string, T>,
    session: PlayerSession,
    buyIn: bigint,
    create: (id: string, stack: bigint) => T,
    persist: () => void,
    ref: string,
  ): T {
    const existing = findOwned(tables, session.playerId);
    if (existing) return existing;
    debitAccount(session.playerId, buyIn, { type: "debit", ref });
    const table = create(randomUUID(), buyIn);
    tables.set(table.toSnapshot().id, table);
    try {
      persist();
    } catch (error) {
      tables.delete(table.toSnapshot().id);
      creditAccount(session.playerId, buyIn, { type: "credit", ref: `${ref}-rollback` });
      throw error;
    }
    return table;
  }

  function leaveTable<T extends OwnedTable>(
    tables: Map<string, T>,
    table: T,
    session: PlayerSession,
    persist: () => void,
    ref: string,
  ): { ok: true; returnedMojos: bigint; accountBalanceMojos: bigint } {
    const id = table.toSnapshot().id;
    const amount = table.takeStack();
    persist();
    const accountBalanceMojos = creditAccount(session.playerId, amount, { type: "credit", ref: `${ref}:${id}` });
    tables.delete(id);
    persist();
    return { ok: true, returnedMojos: amount, accountBalanceMojos };
  }

  app.post("/v1/blackjack", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    try {
      const buyIn = parseBuyIn((req.body as { buyInMojos?: string } | null)?.buyInMojos);
      const table = openTable(
        blackjack,
        session,
        buyIn,
        (id, stack) =>
          new BlackjackTable({
            id,
            playerId: session.playerId,
            displayName: "You",
            stackMojos: stack,
            lossLimitMojos: DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
          }),
        saveBlackjack,
        "blackjack-buyin",
      );
      return { ...table.view(), accountBalanceMojos: getAccountBalance(session.playerId) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/blackjack/:id", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(blackjack, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    return table.view();
  });

  app.post("/v1/blackjack/:id/limit", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(blackjack, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.setLossLimit(parseLimit((req.body as { lossLimitMojos?: string | null } | null)?.lossLimitMojos));
      saveBlackjack();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/blackjack/:id/bet", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(blackjack, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.placeBet(BigInt(String((req.body as { amountMojos?: string }).amountMojos ?? "")));
      saveBlackjack();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/blackjack/:id/action", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(blackjack, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    const action = (req.body as { action?: string } | null)?.action;
    try {
      if (action === "hit") table.hit();
      else if (action === "stand") table.stand();
      else if (action === "double") table.double();
      else if (action === "split") table.split();
      else return reply.status(400).send({ error: "Action must be hit, stand, double, or split" });
      saveBlackjack();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/blackjack/:id/leave", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(blackjack, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      return leaveTable(blackjack, table, session, saveBlackjack, "blackjack-leave");
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/video-poker", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    try {
      const buyIn = parseBuyIn((req.body as { buyInMojos?: string } | null)?.buyInMojos);
      const table = openTable(
        videoPoker,
        session,
        buyIn,
        (id, stack) =>
          new VideoPokerTable({
            id,
            playerId: session.playerId,
            displayName: "You",
            stackMojos: stack,
            lossLimitMojos: DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
          }),
        saveVideoPoker,
        "video-poker-buyin",
      );
      return { ...table.view(), accountBalanceMojos: getAccountBalance(session.playerId) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/video-poker/:id", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    return table.view();
  });

  app.post("/v1/video-poker/:id/limit", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.setLossLimit(parseLimit((req.body as { lossLimitMojos?: string | null } | null)?.lossLimitMojos));
      saveVideoPoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/video-poker/:id/deal", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.deal(Number((req.body as { coins?: number }).coins));
      saveVideoPoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/video-poker/:id/hold", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.toggleHold(Number((req.body as { index?: number }).index));
      saveVideoPoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/video-poker/:id/draw", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.draw();
      saveVideoPoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/video-poker/:id/leave", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(videoPoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      return leaveTable(videoPoker, table, session, saveVideoPoker, "video-poker-leave");
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/calpoker", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    try {
      const buyIn = parseBuyIn((req.body as { buyInMojos?: string } | null)?.buyInMojos);
      const table = openTable(
        calpoker,
        session,
        buyIn,
        (id, stack) =>
          new CalpokerTable({
            id,
            playerId: session.playerId,
            displayName: "You",
            stackMojos: stack,
            lossLimitMojos: DEFAULT_CASINO_LOSS_LIMIT_MOJOS,
          }),
        saveCalpoker,
        "calpoker-buyin",
      );
      return { ...table.view(), accountBalanceMojos: getAccountBalance(session.playerId) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/calpoker/:id", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(calpoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    return table.view();
  });

  app.post("/v1/calpoker/:id/limit", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(calpoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.setLossLimit(parseLimit((req.body as { lossLimitMojos?: string | null } | null)?.lossLimitMojos));
      saveCalpoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/calpoker/:id/deal", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(calpoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      table.deal(BigInt(String((req.body as { amountMojos?: string }).amountMojos ?? "")));
      saveCalpoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/calpoker/:id/swap", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(calpoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      const indexes = (req.body as { indexes?: number[] } | null)?.indexes ?? [];
      table.swap(indexes);
      saveCalpoker();
      return table.view();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/calpoker/:id/leave", async (req, reply) => {
    const session = player(req, reply);
    if (!session) return;
    const table = requireOwned(calpoker, (req.params as { id: string }).id, session.playerId, reply);
    if (!table) return;
    try {
      return leaveTable(calpoker, table, session, saveCalpoker, "calpoker-leave");
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
