import { randomUUID } from "node:crypto";
import {
  decodeChiaPuzzleHash,
  getVariantMeta,
  type PokerVariant,
  type TableFormat,
} from "@dat-poker/shared";
import {
  buildRefundSpend,
  buildSettleSpend,
  buildSiteRedeemMessage,
  buildTournamentJoinMessage,
  buildTournamentLockMessage,
  chainTournamentId,
  planTournamentDisbursement,
  prizesForFinish,
  tournamentCatPuzzleHash,
  tournamentPoolPuzzleHash,
  type EntryCustody,
  type PoolCoinParams,
  type PoolCoinSpend,
  type PrizePayout,
} from "@dat-poker/chia-bridge";
import {
  assertRedeemAllowed,
  commitRedeem,
  creditSiteDat,
  debitSiteDat,
  getSiteDatBalance,
} from "./site-dat-ledger.js";
import { readCatModHash } from "./tournament-config.js";

export class TournamentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface WalletProof {
  message: string;
  signature: string;
  pubkey: string;
}

type EntryStatus = "awaiting_lock" | "locked" | "seated" | "refunded" | "settled" | "refund_pending";
type TournamentStatus = "registering" | "cancelled" | "settled";

interface StoredEntry {
  entryId: string;
  address: string;
  puzzleHash: string;
  custody: EntryCustody;
  status: EntryStatus;
  signature: string;
  pubkey: string;
  coinId?: string;
  innerPuzzleHash?: string;
  catPuzzleHash?: string | null;
  createdAt: string;
}

interface SpendView {
  mode: PoolCoinSpend["mode"];
  solutionHex: string;
  authorizerMessage: string | null;
  outputs: Array<{ puzzleHash: string; amountMojos: string }>;
}

interface EntrySpendView {
  entryId: string;
  address: string;
  coinId?: string;
  innerPuzzleHash: string;
  catPuzzleHash: string | null;
  timeoutRefund?: SpendView;
  immediateRefund?: SpendView;
  settle?: SpendView;
}

interface StoredTournament {
  id: string;
  format: "sng" | "mtt";
  variant: string;
  buyInMojos: bigint;
  maxEntries: number;
  payoutBps: number[];
  refundAfterSeconds: number;
  authorizerPublicKey: string;
  chainTournamentId: string;
  assetId: string | null;
  status: TournamentStatus;
  entries: StoredEntry[];
  createdAt: string;
  spends?: EntrySpendView[];
  siteCredits?: Array<{ address: string; amountMojos: string }>;
}

const tournaments = new Map<string, StoredTournament>();

export function resetTournaments(): void {
  tournaments.clear();
}

function parsePositiveMojos(raw: string, label: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new TournamentError(`${label} must be a positive integer string`, 400);
  }
  const value = BigInt(raw);
  if (value <= 0n) throw new TournamentError(`${label} must be positive`, 400);
  if (value > 18_446_744_073_709_551_615n) {
    throw new TournamentError(`${label} exceeds a CAT coin amount`, 400);
  }
  return value;
}

function requireProof(proof: WalletProof | undefined, expected: string): void {
  if (!proof?.signature || !proof.pubkey) {
    throw new TournamentError("Wallet signature required", 400);
  }
  if (proof.message !== expected) {
    throw new TournamentError("Invalid wallet message", 400);
  }
}

function coinParams(tournament: StoredTournament, puzzleHash: string): PoolCoinParams {
  return {
    chainTournamentId: tournament.chainTournamentId,
    buyInMojos: tournament.buyInMojos,
    playerPuzzleHash: puzzleHash,
    authorizerPublicKey: tournament.authorizerPublicKey,
    refundAfterSeconds: tournament.refundAfterSeconds,
  };
}

function spendView(spend: PoolCoinSpend): SpendView {
  return {
    mode: spend.mode,
    solutionHex: spend.solutionHex,
    authorizerMessage: spend.authorizerMessage,
    outputs: spend.outputs.map((output) => ({
      puzzleHash: output.puzzleHash,
      amountMojos: output.amountMojos.toString(),
    })),
  };
}

function paidEntries(tournament: StoredTournament): StoredEntry[] {
  return tournament.entries.filter(
    (entry) => entry.status === "locked" || entry.status === "seated",
  );
}

export interface TournamentView {
  id: string;
  format: "sng" | "mtt";
  variant: string;
  buyInMojos: string;
  maxEntries: number;
  payoutBps: number[];
  refundAfterSeconds: number;
  authorizerPublicKey: string;
  chainTournamentId: string;
  assetId: string | null;
  status: TournamentStatus;
  entryCount: number;
  lockedPoolMojos: string;
  siteLedgerMojos: string;
  prizePoolMojos: string;
  entries: Array<{
    entryId: string;
    address: string;
    puzzleHash: string;
    custody: EntryCustody;
    status: EntryStatus;
    coinId?: string;
    innerPuzzleHash?: string;
    catPuzzleHash?: string | null;
    createdAt: string;
  }>;
  spends?: EntrySpendView[];
  siteCredits?: Array<{ address: string; amountMojos: string }>;
  createdAt: string;
  custodyNote: string;
}

const CUSTODY_NOTE =
  "pool_coin locks a DAT CAT after a wallet signature. site_ledger spends free on-site DAT and does not create a pool coin.";

function toView(tournament: StoredTournament): TournamentView {
  const locked = tournament.entries.filter((entry) => entry.status === "locked");
  const seated = tournament.entries.filter((entry) => entry.status === "seated");
  const lockedPool = tournament.buyInMojos * BigInt(locked.length);
  const site = tournament.buyInMojos * BigInt(seated.length);
  return {
    id: tournament.id,
    format: tournament.format,
    variant: tournament.variant,
    buyInMojos: tournament.buyInMojos.toString(),
    maxEntries: tournament.maxEntries,
    payoutBps: tournament.payoutBps,
    refundAfterSeconds: tournament.refundAfterSeconds,
    authorizerPublicKey: tournament.authorizerPublicKey,
    chainTournamentId: tournament.chainTournamentId,
    assetId: tournament.assetId,
    status: tournament.status,
    entryCount: tournament.entries.length,
    lockedPoolMojos: lockedPool.toString(),
    siteLedgerMojos: site.toString(),
    prizePoolMojos: (lockedPool + site).toString(),
    entries: tournament.entries.map((entry) => ({
      entryId: entry.entryId,
      address: entry.address,
      puzzleHash: entry.puzzleHash,
      custody: entry.custody,
      status: entry.status,
      coinId: entry.coinId,
      innerPuzzleHash: entry.innerPuzzleHash,
      catPuzzleHash: entry.catPuzzleHash,
      createdAt: entry.createdAt,
    })),
    spends: tournament.spends,
    siteCredits: tournament.siteCredits,
    createdAt: tournament.createdAt,
    custodyNote: CUSTODY_NOTE,
  };
}

function requireTournament(id: string): StoredTournament {
  const tournament = tournaments.get(id);
  if (!tournament) throw new TournamentError("Tournament not found", 404);
  return tournament;
}

export function createTournament(input: {
  format?: TableFormat;
  variant?: string;
  buyInMojos?: string;
  maxEntries?: number;
  payoutBps?: number[];
  refundAfterSeconds?: number;
  authorizerPublicKey: string | null;
  assetId: string | null;
}): TournamentView {
  if (!input.authorizerPublicKey) {
    throw new TournamentError(
      "Set TOURNAMENT_AUTHORIZER_PUBLIC_KEY (or DAT_ALLOW_DEV_BUYIN for a local key)",
      503,
    );
  }
  const format = input.format ?? "sng";
  if (format !== "sng" && format !== "mtt") {
    throw new TournamentError("format must be sng or mtt", 400);
  }
  const variant = (input.variant ?? "nlhe") as PokerVariant;
  if (!getVariantMeta(variant)) throw new TournamentError("Unknown variant", 400);
  const maxEntries = input.maxEntries ?? (format === "sng" ? 6 : 18);
  if (!Number.isInteger(maxEntries) || maxEntries < 2 || maxEntries > 500) {
    throw new TournamentError("maxEntries must be an integer from 2 to 500", 400);
  }
  const payoutBps = input.payoutBps ?? (maxEntries <= 2 ? [10_000] : [5000, 3000, 2000]);
  if (
    payoutBps.length < 1 ||
    payoutBps.length > 16 ||
    payoutBps.some((bps) => !Number.isInteger(bps) || bps <= 0) ||
    payoutBps.reduce((sum, bps) => sum + bps, 0) !== 10_000
  ) {
    throw new TournamentError("payoutBps must be positive integers that sum to 10000", 400);
  }
  const refundAfterSeconds = input.refundAfterSeconds ?? 86_400;
  if (!Number.isInteger(refundAfterSeconds) || refundAfterSeconds < 60 || refundAfterSeconds > 2_592_000) {
    throw new TournamentError("refundAfterSeconds must be from 60 to 2592000", 400);
  }
  const buyInMojos = parsePositiveMojos(input.buyInMojos ?? "1000000", "buyInMojos");
  const id = randomUUID();
  const tournament: StoredTournament = {
    id,
    format,
    variant,
    buyInMojos,
    maxEntries,
    payoutBps,
    refundAfterSeconds,
    authorizerPublicKey: input.authorizerPublicKey,
    chainTournamentId: chainTournamentId(id),
    assetId: input.assetId,
    status: "registering",
    entries: [],
    createdAt: new Date().toISOString(),
  };
  tournaments.set(id, tournament);
  return toView(tournament);
}

export function listTournaments(): TournamentView[] {
  return [...tournaments.values()].map(toView);
}

export function getTournament(id: string): TournamentView {
  return toView(requireTournament(id));
}

export function joinMessage(id: string, address: string, custody: EntryCustody): {
  message: string;
  puzzleHash: string;
  buyInMojos: string;
  custody: EntryCustody;
} {
  const tournament = requireTournament(id);
  if (custody !== "pool_coin" && custody !== "site_ledger") {
    throw new TournamentError("custody must be pool_coin or site_ledger", 400);
  }
  let puzzleHash: string;
  try {
    puzzleHash = decodeChiaPuzzleHash(address);
  } catch (error) {
    throw new TournamentError((error as Error).message, 400);
  }
  return {
    message: buildTournamentJoinMessage({
      tournamentId: id,
      address,
      puzzleHash,
      buyInMojos: tournament.buyInMojos.toString(),
      custody,
    }),
    puzzleHash,
    buyInMojos: tournament.buyInMojos.toString(),
    custody,
  };
}

export function joinTournament(
  id: string,
  input: { address: string; custody: EntryCustody; proof: WalletProof },
): TournamentView {
  const tournament = requireTournament(id);
  if (tournament.status !== "registering") {
    throw new TournamentError("Tournament is not open for registration", 400);
  }
  if (tournament.entries.length >= tournament.maxEntries) {
    throw new TournamentError("Tournament is full", 400);
  }
  if (input.custody !== "pool_coin" && input.custody !== "site_ledger") {
    throw new TournamentError("custody must be pool_coin or site_ledger", 400);
  }
  let puzzleHash: string;
  try {
    puzzleHash = decodeChiaPuzzleHash(input.address);
  } catch (error) {
    throw new TournamentError((error as Error).message, 400);
  }
  if (tournament.entries.some((entry) => entry.address === input.address)) {
    throw new TournamentError("Address already entered this tournament", 400);
  }
  const expected = buildTournamentJoinMessage({
    tournamentId: id,
    address: input.address,
    puzzleHash,
    buyInMojos: tournament.buyInMojos.toString(),
    custody: input.custody,
  });
  requireProof(input.proof, expected);

  const entry: StoredEntry = {
    entryId: randomUUID(),
    address: input.address,
    puzzleHash,
    custody: input.custody,
    status: input.custody === "site_ledger" ? "seated" : "awaiting_lock",
    signature: input.proof.signature,
    pubkey: input.proof.pubkey,
    createdAt: new Date().toISOString(),
  };

  if (input.custody === "site_ledger") {
    if (getSiteDatBalance(input.address) < tournament.buyInMojos) {
      throw new TournamentError(
        "Insufficient site DAT. Free redeems stay on the site ledger and do not lock a pool coin.",
        400,
      );
    }
    debitSiteDat(input.address, tournament.buyInMojos);
  } else {
    const params = coinParams(tournament, puzzleHash);
    entry.innerPuzzleHash = tournamentPoolPuzzleHash(params);
    entry.catPuzzleHash = tournament.assetId
      ? tournamentCatPuzzleHash(params, tournament.assetId, readCatModHash())
      : null;
  }

  tournament.entries.push(entry);
  return toView(tournament);
}

export function lockMessage(id: string, entryId: string, coinId: string): { message: string } {
  const tournament = requireTournament(id);
  const entry = tournament.entries.find((item) => item.entryId === entryId);
  if (!entry) throw new TournamentError("Entry not found", 404);
  if (!/^[0-9a-fA-F]{64}$/.test(coinId)) {
    throw new TournamentError("coinId must be 64 hex characters", 400);
  }
  return {
    message: buildTournamentLockMessage({
      tournamentId: id,
      entryId,
      coinId: coinId.toLowerCase(),
    }),
  };
}

export function lockPoolCoin(
  id: string,
  entryId: string,
  input: { coinId: string; proof: WalletProof },
): TournamentView {
  const tournament = requireTournament(id);
  if (tournament.status !== "registering") {
    throw new TournamentError("Tournament is not open for registration", 400);
  }
  const entry = tournament.entries.find((item) => item.entryId === entryId);
  if (!entry) throw new TournamentError("Entry not found", 404);
  if (entry.custody !== "pool_coin" || entry.status !== "awaiting_lock") {
    throw new TournamentError("Entry is not waiting for a pool coin", 400);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(input.coinId)) {
    throw new TournamentError("coinId must be 64 hex characters", 400);
  }
  const coinId = input.coinId.toLowerCase();
  requireProof(
    input.proof,
    buildTournamentLockMessage({ tournamentId: id, entryId, coinId }),
  );
  entry.coinId = coinId;
  entry.status = "locked";
  return toView(tournament);
}

function assertStillOpen(tournament: StoredTournament): void {
  if (tournament.status !== "registering") {
    throw new TournamentError("Tournament is already closed", 400);
  }
}

export function cancelTournament(id: string): TournamentView {
  const tournament = requireTournament(id);
  assertStillOpen(tournament);
  const spends: EntrySpendView[] = [];
  for (const entry of tournament.entries) {
    if (entry.custody === "site_ledger" && entry.status === "seated") {
      creditSiteDat(entry.address, tournament.buyInMojos);
      entry.status = "refunded";
      continue;
    }
    if (entry.status === "awaiting_lock") {
      entry.status = "refunded";
      continue;
    }
    if (entry.status === "locked" && entry.innerPuzzleHash) {
      const params = coinParams(tournament, entry.puzzleHash);
      const timeoutRefund = buildRefundSpend(params);
      const immediateRefund = buildSettleSpend(params, [
        { puzzleHash: entry.puzzleHash, amountMojos: tournament.buyInMojos },
      ]);
      spends.push({
        entryId: entry.entryId,
        address: entry.address,
        coinId: entry.coinId,
        innerPuzzleHash: entry.innerPuzzleHash,
        catPuzzleHash: entry.catPuzzleHash ?? null,
        timeoutRefund: spendView(timeoutRefund),
        immediateRefund: spendView(immediateRefund),
      });
      entry.status = "refund_pending";
    }
  }
  tournament.status = "cancelled";
  tournament.spends = spends;
  return toView(tournament);
}

function resolvePayouts(
  tournament: StoredTournament,
  input: {
    finishOrder?: string[];
    payouts?: Array<{ address: string; amountMojos: string; puzzleHash?: string }>;
  },
): PrizePayout[] {
  const paid = paidEntries(tournament);
  const byAddress = new Map(paid.map((entry) => [entry.address, entry]));
  if (input.finishOrder && input.payouts) {
    throw new TournamentError("Pass finishOrder or payouts, not both", 400);
  }
  if (input.finishOrder) {
    const finish = input.finishOrder.map((address) => {
      const entry = byAddress.get(address);
      if (!entry) throw new TournamentError(`No paid entry for ${address}`, 400);
      return { address, puzzleHash: entry.puzzleHash };
    });
    const total = tournament.buyInMojos * BigInt(paid.length);
    try {
      return prizesForFinish(total, tournament.payoutBps, finish);
    } catch (error) {
      throw new TournamentError((error as Error).message, 400);
    }
  }
  if (!input.payouts?.length) {
    throw new TournamentError("finishOrder or payouts required", 400);
  }
  return input.payouts.map((payout) => {
    const entry = byAddress.get(payout.address);
    const puzzleHash = (payout.puzzleHash ?? entry?.puzzleHash)?.toLowerCase();
    if (!puzzleHash || !/^[0-9a-f]{64}$/.test(puzzleHash)) {
      throw new TournamentError(`No puzzle hash for payout to ${payout.address}`, 400);
    }
    return {
      address: payout.address,
      puzzleHash,
      amountMojos: parsePositiveMojos(payout.amountMojos, "amountMojos"),
    };
  });
}

export function settleTournament(
  id: string,
  input: {
    finishOrder?: string[];
    payouts?: Array<{ address: string; amountMojos: string; puzzleHash?: string }>;
  },
): TournamentView {
  const tournament = requireTournament(id);
  assertStillOpen(tournament);
  const waiting = tournament.entries.filter((entry) => entry.status === "awaiting_lock");
  if (waiting.length > 0) {
    throw new TournamentError("Lock or remove entries still awaiting a pool coin before settling", 400);
  }
  const paid = paidEntries(tournament);
  if (paid.length === 0) throw new TournamentError("No paid entries to settle", 400);
  const prizes = resolvePayouts(tournament, input);
  const poolEntries = paid.filter((entry) => entry.custody === "pool_coin");
  const siteEntries = paid.filter((entry) => entry.custody === "site_ledger");
  let plan;
  try {
    plan = planTournamentDisbursement({
      buyInMojos: tournament.buyInMojos,
      poolPlayerPuzzleHashes: poolEntries.map((entry) => entry.puzzleHash),
      siteMojos: tournament.buyInMojos * BigInt(siteEntries.length),
      payouts: prizes,
    });
  } catch (error) {
    throw new TournamentError((error as Error).message, 400);
  }

  const spends: EntrySpendView[] = [];
  poolEntries.forEach((entry, index) => {
    const slice = plan.coinSpends[index];
    if (!slice || !entry.innerPuzzleHash) {
      throw new TournamentError("Missing pool coin spend", 500);
    }
    const params = coinParams(tournament, entry.puzzleHash);
    const settle = buildSettleSpend(params, slice.outputs);
    spends.push({
      entryId: entry.entryId,
      address: entry.address,
      coinId: entry.coinId,
      innerPuzzleHash: entry.innerPuzzleHash,
      catPuzzleHash: entry.catPuzzleHash ?? null,
      settle: spendView(settle),
    });
    entry.status = "settled";
  });

  const credits: Array<{ address: string; amountMojos: string }> = [];
  for (const credit of plan.siteCredits) {
    creditSiteDat(credit.address, credit.amountMojos);
    credits.push({ address: credit.address, amountMojos: credit.amountMojos.toString() });
  }
  for (const entry of siteEntries) entry.status = "settled";

  tournament.status = "settled";
  tournament.spends = spends;
  tournament.siteCredits = credits;
  return toView(tournament);
}

export function siteRedeemMessage(address: string, amountMojos: string, nonce: string): { message: string } {
  try {
    decodeChiaPuzzleHash(address);
  } catch (error) {
    throw new TournamentError((error as Error).message, 400);
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) {
    throw new TournamentError("nonce must be 1-64 url-safe characters", 400);
  }
  parsePositiveMojos(amountMojos, "amountMojos");
  return { message: buildSiteRedeemMessage({ address, amountMojos, nonce }) };
}

export function redeemSiteDat(input: {
  address: string;
  amountMojos: string;
  nonce: string;
  proof: WalletProof;
  enabled: boolean;
  maxMojos: bigint;
  capMojos: bigint;
}): { balanceMojos: string } {
  if (!input.enabled) {
    throw new TournamentError(
      "Site DAT redeems are disabled. Set DAT_ALLOW_SITE_REDEEM=true for the local faucet.",
      403,
    );
  }
  const amount = parsePositiveMojos(input.amountMojos, "amountMojos");
  const expected = siteRedeemMessage(input.address, input.amountMojos, input.nonce).message;
  requireProof(input.proof, expected);
  try {
    assertRedeemAllowed({
      address: input.address,
      amount,
      nonce: input.nonce,
      maxMojos: input.maxMojos,
      capMojos: input.capMojos,
    });
  } catch (error) {
    throw new TournamentError((error as Error).message, 400);
  }
  const balance = commitRedeem(input.address, amount, input.nonce);
  return { balanceMojos: balance.toString() };
}
