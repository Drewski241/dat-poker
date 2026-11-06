import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { resetSiteDatLedger } from "./site-dat-ledger.js";
import { registerSiteDatRoutes } from "./routes/site-dat.js";
import { registerTournamentRoutes } from "./routes/tournaments.js";
import { resetTournaments } from "./tournaments.js";

const PLAYER_A = "xch1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qzarh9q";
const PLAYER_B = "xch1424242424242424242424242424242424242424242424242424q48w9sf";
const SIG = "wallet-signature";
const PUBKEY = "ab".repeat(48);

async function buildApp() {
  const app = Fastify();
  registerSiteDatRoutes(app);
  registerTournamentRoutes(app);
  return app;
}

async function createSng(app: Awaited<ReturnType<typeof buildApp>>, buyInMojos = "1000") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/tournaments",
    payload: { format: "sng", buyInMojos, maxEntries: 8 },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { id: string; chainTournamentId: string; buyInMojos: string };
}

async function signJoin(
  app: Awaited<ReturnType<typeof buildApp>>,
  tournamentId: string,
  address: string,
  custody: "pool_coin" | "site_ledger",
) {
  const message = await app.inject({
    method: "GET",
    url: `/v1/tournaments/${tournamentId}/join/message?address=${address}&custody=${custody}`,
  });
  expect(message.statusCode).toBe(200);
  const body = message.json() as { message: string; puzzleHash: string };
  const joined = await app.inject({
    method: "POST",
    url: `/v1/tournaments/${tournamentId}/join`,
    payload: {
      address,
      custody,
      proof: { message: body.message, signature: SIG, pubkey: PUBKEY },
    },
  });
  return { status: joined.statusCode, body: joined.json() as Record<string, unknown> };
}

describe("tournament pool and site DAT", () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.DAT_ALLOW_DEV_BUYIN = "true";
    process.env.DAT_ALLOW_SITE_REDEEM = "true";
    process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID = "ab".repeat(32);
    process.env.DAT_SITE_REDEEM_MAX_MOJOS = "100000";
    process.env.DAT_SITE_REDEEM_CAP_MOJOS = "1000000";
    resetTournaments();
    resetSiteDatLedger();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    resetTournaments();
    resetSiteDatLedger();
  });

  it("requires a wallet signature to join", async () => {
    const app = await buildApp();
    const tournament = await createSng(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/join`,
      payload: {
        address: PLAYER_A,
        custody: "pool_coin",
        proof: { message: "dat-poker:v1:tournament-join:nope", signature: "", pubkey: "" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/signature/i);
  });

  it("keeps a wallet entry off the site ledger until the pool coin is locked", async () => {
    const app = await buildApp();
    const tournament = await createSng(app);
    const joined = await signJoin(app, tournament.id, PLAYER_A, "pool_coin");
    expect(joined.status).toBe(200);
    const entry = (joined.body.entries as Array<Record<string, string>>)[0]!;
    expect(entry.status).toBe("awaiting_lock");
    expect(entry.custody).toBe("pool_coin");
    expect(entry.innerPuzzleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.catPuzzleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(joined.body.prizePoolMojos).toBe("0");

    const coinId = "cd".repeat(32);
    const lockMessage = await app.inject({
      method: "GET",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock/message?coinId=${coinId}`,
    });
    const locked = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock`,
      payload: {
        coinId,
        proof: {
          message: lockMessage.json().message,
          signature: SIG,
          pubkey: PUBKEY,
        },
      },
    });
    expect(locked.statusCode).toBe(200);
    expect(locked.json().prizePoolMojos).toBe("1000");
    expect(locked.json().lockedPoolMojos).toBe("1000");
    expect(locked.json().siteLedgerMojos).toBe("0");
  });

  it("redeems site DAT with a wallet signature and spends it without a pool coin", async () => {
    const app = await buildApp();
    const tournament = await createSng(app, "1000");
    const nonce = "redeem-1";
    const message = await app.inject({
      method: "GET",
      url: `/v1/wallet/site-dat/redeem/message?address=${PLAYER_B}&amountMojos=5000&nonce=${nonce}`,
    });
    const redeemed = await app.inject({
      method: "POST",
      url: "/v1/wallet/site-dat/redeem",
      payload: {
        address: PLAYER_B,
        amountMojos: "5000",
        nonce,
        proof: { message: message.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().balanceMojos).toBe("5000");

    const joined = await signJoin(app, tournament.id, PLAYER_B, "site_ledger");
    expect(joined.status).toBe(200);
    const entry = (joined.body.entries as Array<Record<string, string>>)[0]!;
    expect(entry.status).toBe("seated");
    expect(entry.innerPuzzleHash).toBeUndefined();
    expect(joined.body.siteLedgerMojos).toBe("1000");
    expect(joined.body.prizePoolMojos).toBe("1000");

    const balance = await app.inject({
      method: "GET",
      url: `/v1/wallet/site-dat?address=${PLAYER_B}`,
    });
    expect(balance.json().balanceMojos).toBe("4000");
  });

  it("rejects a 6-max sit and go and a payout table chosen at create", async () => {
    const app = await buildApp();
    const six = await app.inject({
      method: "POST",
      url: "/v1/tournaments",
      payload: { format: "sng", buyInMojos: "1000", maxEntries: 6 },
    });
    expect(six.statusCode).toBe(400);
    expect(six.json().error).toMatch(/8 or 16/);

    const custom = await app.inject({
      method: "POST",
      url: "/v1/tournaments",
      payload: { format: "sng", buyInMojos: "1000", maxEntries: 8, payoutBps: [10_000] },
    });
    expect(custom.statusCode).toBe(400);
    expect(custom.json().error).toMatch(/top 20%/);

    const sixteen = await app.inject({
      method: "POST",
      url: "/v1/tournaments",
      payload: { format: "sng", buyInMojos: "1000", maxEntries: 16 },
    });
    expect(sixteen.statusCode).toBe(200);
    expect(sixteen.json().paidPlaces).toBe(3);
    expect(sixteen.json().payoutBps).toEqual([5001, 3333, 1666]);
    expect(sixteen.json().payoutNote).toBe("Pays 3 places (top 20% of 16)");

    const open = await app.inject({
      method: "POST",
      url: "/v1/tournaments",
      payload: { format: "mtt", buyInMojos: "1000" },
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().maxEntries).toBe(100_000);
    expect(open.json().fieldLabel).toBe("Open tournament");
    expect(open.json().payoutNote).toBe("Pays the top 20% of the paid field at settle");
    expect(open.json().paidPlaces).toBe(0);
    const seated = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${open.json().id}/fill-house`,
      payload: { seats: 3 },
    });
    expect(seated.statusCode).toBe(200);
    expect(seated.json().payoutNote).toBe("Pays 1 place (top 20% of 3 entered)");
    expect(seated.json().paidPlaces).toBe(1);
  });

  it("settles pool coins and site DAT as separate collateral", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tournaments",
      payload: { format: "mtt", buyInMojos: "1000", maxEntries: 2 },
    });
    expect(created.statusCode).toBe(200);
    const tournament = created.json() as { id: string };

    for (const [address, nonce] of [
      [PLAYER_A, "a"],
      [PLAYER_B, "b"],
    ] as const) {
      const message = await app.inject({
        method: "GET",
        url: `/v1/wallet/site-dat/redeem/message?address=${address}&amountMojos=1000&nonce=${nonce}`,
      });
      await app.inject({
        method: "POST",
        url: "/v1/wallet/site-dat/redeem",
        payload: {
          address,
          amountMojos: "1000",
          nonce,
          proof: { message: message.json().message, signature: SIG, pubkey: PUBKEY },
        },
      });
    }

    const pool = await signJoin(app, tournament.id, PLAYER_A, "pool_coin");
    const poolEntry = (pool.body.entries as Array<Record<string, string>>)[0]!;
    const coinId = "ef".repeat(32);
    const lockMessage = await app.inject({
      method: "GET",
      url: `/v1/tournaments/${tournament.id}/entries/${poolEntry.entryId}/lock/message?coinId=${coinId}`,
    });
    await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/entries/${poolEntry.entryId}/lock`,
      payload: {
        coinId,
        proof: { message: lockMessage.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });
    await signJoin(app, tournament.id, PLAYER_B, "site_ledger");

    const settled = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/settle`,
      payload: { finishOrder: [PLAYER_A, PLAYER_B] },
    });
    expect(settled.statusCode).toBe(400);
    expect(settled.json().error).toMatch(/one player per payout place/);

    const threePlaces = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/settle`,
      payload: {
        payouts: [
          { address: PLAYER_A, amountMojos: "1500" },
          { address: PLAYER_B, amountMojos: "500" },
        ],
      },
    });
    expect(threePlaces.statusCode).toBe(200);
    const body = threePlaces.json();
    expect(body.status).toBe("settled");
    expect(body.spends).toHaveLength(1);
    expect(body.spends[0].settle.authorizerMessage).toMatch(/^[0-9a-f]{64}$/);
    expect(body.spends[0].settle.outputs).toEqual([
      { puzzleHash: "22".repeat(32), amountMojos: "1000" },
    ]);
    expect(body.siteCredits).toEqual([
      { address: PLAYER_A, amountMojos: "500" },
      { address: PLAYER_B, amountMojos: "500" },
    ]);

    const balanceA = await app.inject({ method: "GET", url: `/v1/wallet/site-dat?address=${PLAYER_A}` });
    const balanceB = await app.inject({ method: "GET", url: `/v1/wallet/site-dat?address=${PLAYER_B}` });
    expect(balanceA.json().balanceMojos).toBe("1500");
    expect(balanceB.json().balanceMojos).toBe("500");
  });

  it("refunds site DAT on cancel and returns a pool-coin refund spend", async () => {
    const app = await buildApp();
    const tournament = await createSng(app, "1000");
    const message = await app.inject({
      method: "GET",
      url: `/v1/wallet/site-dat/redeem/message?address=${PLAYER_B}&amountMojos=1000&nonce=cancel`,
    });
    await app.inject({
      method: "POST",
      url: "/v1/wallet/site-dat/redeem",
      payload: {
        address: PLAYER_B,
        amountMojos: "1000",
        nonce: "cancel",
        proof: { message: message.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });
    const pool = await signJoin(app, tournament.id, PLAYER_A, "pool_coin");
    const entry = (pool.body.entries as Array<Record<string, string>>)[0]!;
    const coinId = "12".repeat(32);
    const lockMessage = await app.inject({
      method: "GET",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock/message?coinId=${coinId}`,
    });
    await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock`,
      payload: {
        coinId,
        proof: { message: lockMessage.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });
    await signJoin(app, tournament.id, PLAYER_B, "site_ledger");

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");
    expect(cancelled.json().spends[0].timeoutRefund.solutionHex).toBe("ff80ff8080");
    expect(cancelled.json().spends[0].immediateRefund.authorizerMessage).toMatch(/^[0-9a-f]{64}$/);

    const balance = await app.inject({ method: "GET", url: `/v1/wallet/site-dat?address=${PLAYER_B}` });
    expect(balance.json().balanceMojos).toBe("1000");
  });

  it("fills an 8-max with the house and pays the one real pool coin to first", async () => {
    const app = await buildApp();
    const tournament = await createSng(app, "1000");
    expect(tournament).toMatchObject({
      paidPlaces: 2,
      payoutBps: [6667, 3333],
      payoutNote: "Pays 2 places (top 20% of 8)",
    });

    const early = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/settle`,
      payload: { playerWinsAddress: PLAYER_A },
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toMatch(/all 8 seats/);

    const pool = await signJoin(app, tournament.id, PLAYER_A, "pool_coin");
    const entry = (pool.body.entries as Array<Record<string, string>>)[0]!;
    const coinId = "ab".repeat(32);
    const lockMessage = await app.inject({
      method: "GET",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock/message?coinId=${coinId}`,
    });
    await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/entries/${entry.entryId}/lock`,
      payload: {
        coinId,
        proof: { message: lockMessage.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });

    const filled = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/fill-house`,
      payload: {},
    });
    expect(filled.statusCode).toBe(200);
    const field = filled.json();
    expect(field.houseCount).toBe(7);
    expect(field.houseMojos).toBe("7000");
    expect(field.siteLedgerMojos).toBe("0");
    expect(field.prizePoolMojos).toBe("8000");
    expect(field.lockedPoolMojos).toBe("1000");

    const won = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/settle`,
      payload: { playerWinsAddress: PLAYER_A },
    });
    expect(won.statusCode).toBe(200);
    const body = won.json();
    expect(body.status).toBe("settled");
    expect(body.payoutNote).toBe("Paid 2 places (top 20% of 8)");
    expect(body.spends).toHaveLength(1);
    expect(body.spends[0].settle.outputs).toEqual([
      { puzzleHash: "22".repeat(32), amountMojos: "1000" },
    ]);
    expect(body.spends[0].settle.solutionHex.startsWith("ff01")).toBe(true);
    expect(body.spends[0].settle.authorizerMessage).toMatch(/^[0-9a-f]{64}$/);
    expect(body.siteCredits).toEqual([{ address: PLAYER_A, amountMojos: "4334" }]);

    const balance = await app.inject({ method: "GET", url: `/v1/wallet/site-dat?address=${PLAYER_A}` });
    expect(balance.json().balanceMojos).toBe("4334");
  });

  it("does not refund house collateral onto the site ledger", async () => {
    const app = await buildApp();
    const tournament = await createSng(app, "1000");
    const message = await app.inject({
      method: "GET",
      url: `/v1/wallet/site-dat/redeem/message?address=${PLAYER_B}&amountMojos=1000&nonce=house-cancel`,
    });
    await app.inject({
      method: "POST",
      url: "/v1/wallet/site-dat/redeem",
      payload: {
        address: PLAYER_B,
        amountMojos: "1000",
        nonce: "house-cancel",
        proof: { message: message.json().message, signature: SIG, pubkey: PUBKEY },
      },
    });
    await signJoin(app, tournament.id, PLAYER_B, "site_ledger");
    const filled = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/fill-house`,
      payload: {},
    });
    expect(filled.json().houseCount).toBe(7);

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/tournaments/${tournament.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    const balance = await app.inject({ method: "GET", url: `/v1/wallet/site-dat?address=${PLAYER_B}` });
    expect(balance.json().balanceMojos).toBe("1000");
    const houseBalance = await app.inject({
      method: "GET",
      url: `/v1/wallet/site-dat?address=${encodeURIComponent(`dat-poker:house:${tournament.id}:0`)}`,
    });
    expect(houseBalance.json().balanceMojos).toBe("0");
  });
});
