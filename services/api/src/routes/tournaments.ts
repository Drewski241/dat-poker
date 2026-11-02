import type { FastifyInstance } from "fastify";
import type { TableFormat } from "@dat-poker/shared";
import type { EntryCustody } from "@dat-poker/chia-bridge";
import { readDatTokenConfig } from "../wallet-config.js";
import { readAuthorizerPublicKey } from "../tournament-config.js";
import {
  cancelTournament,
  createTournament,
  getTournament,
  joinMessage,
  joinTournament,
  listTournaments,
  lockMessage,
  lockPoolCoin,
  settleTournament,
  TournamentError,
  type WalletProof,
} from "../tournaments.js";

function sendError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof TournamentError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  throw error;
}

export function registerTournamentRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      format?: TableFormat;
      variant?: string;
      buyInMojos?: string;
      maxEntries?: number;
      payoutBps?: number[];
      refundAfterSeconds?: number;
    };
  }>("/v1/tournaments", async (req, reply) => {
    const dat = readDatTokenConfig();
    try {
      return createTournament({
        ...req.body,
        buyInMojos: req.body?.buyInMojos ?? dat.minBuyInMojos,
        authorizerPublicKey: readAuthorizerPublicKey(),
        assetId: dat.assetId,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/tournaments", async () => ({ tournaments: listTournaments() }));

  app.get<{ Params: { tournamentId: string } }>("/v1/tournaments/:tournamentId", async (req, reply) => {
    try {
      return getTournament(req.params.tournamentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{
    Params: { tournamentId: string };
    Querystring: { address?: string; custody?: EntryCustody };
  }>("/v1/tournaments/:tournamentId/join/message", async (req, reply) => {
    const { address, custody } = req.query;
    if (!address || !custody) {
      return reply.status(400).send({ error: "address and custody required" });
    }
    try {
      return joinMessage(req.params.tournamentId, address, custody);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{
    Params: { tournamentId: string };
    Body: { address?: string; custody?: EntryCustody; proof?: WalletProof };
  }>("/v1/tournaments/:tournamentId/join", async (req, reply) => {
    const { address, custody, proof } = req.body ?? {};
    if (!address || !custody || !proof) {
      return reply.status(400).send({ error: "address, custody, and proof required" });
    }
    try {
      return joinTournament(req.params.tournamentId, { address, custody, proof });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{
    Params: { tournamentId: string; entryId: string };
    Querystring: { coinId?: string };
  }>("/v1/tournaments/:tournamentId/entries/:entryId/lock/message", async (req, reply) => {
    if (!req.query.coinId) return reply.status(400).send({ error: "coinId required" });
    try {
      return lockMessage(req.params.tournamentId, req.params.entryId, req.query.coinId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{
    Params: { tournamentId: string; entryId: string };
    Body: { coinId?: string; proof?: WalletProof };
  }>("/v1/tournaments/:tournamentId/entries/:entryId/lock", async (req, reply) => {
    const { coinId, proof } = req.body ?? {};
    if (!coinId || !proof) return reply.status(400).send({ error: "coinId and proof required" });
    try {
      return lockPoolCoin(req.params.tournamentId, req.params.entryId, { coinId, proof });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId/cancel",
    async (req, reply) => {
      try {
        return cancelTournament(req.params.tournamentId);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{
    Params: { tournamentId: string };
    Body: {
      finishOrder?: string[];
      payouts?: Array<{ address: string; amountMojos: string; puzzleHash?: string }>;
    };
  }>("/v1/tournaments/:tournamentId/settle", async (req, reply) => {
    try {
      return settleTournament(req.params.tournamentId, req.body ?? {});
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
