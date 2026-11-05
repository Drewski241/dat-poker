import { createHash } from "node:crypto";
import {
  clvmInt,
  clvmList,
  curryAtomsTreeHash,
  curryTreeHash,
  parseClvm,
  serializeClvm,
  sha256tree,
  type Clvm,
} from "./clvm.js";

/**
 * Tree hash of puzzles/tournament_pool.clsp (see puzzles/tournament_pool.hex).
 * One DAT CAT per tournament entry. The inner puzzle does not merge buy-ins
 * into a single coin: CAT parents cannot emit more than they hold.
 */
export const TOURNAMENT_POOL_MOD_HASH =
  "6e28b139a89c029cd0ea2caf8ee3bd9c08241e4315b336220bacfb9d28540c44";

/** Standard Chia CAT v2 outer puzzle (`cat_v2.clsp` from chia-blockchain 1.8.2+). */
export const CAT_V2_MOD_HASH =
  "37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a";

export const SETTLE_DOMAIN = "DAT_POKER_TOURNAMENT_SETTLE";
export const MAX_PAYOUTS = 16;

export type EntryCustody = "pool_coin" | "site_ledger";

export interface PoolCoinParams {
  /** 32-byte tournament id (sha256 of the off-chain tournament id). */
  chainTournamentId: string;
  buyInMojos: bigint;
  /** 32-byte wallet puzzle hash that receives a refund. */
  playerPuzzleHash: string;
  /** 48-byte BLS G1 authorizer key, hex. */
  authorizerPublicKey: string;
  refundAfterSeconds: number;
}

export interface PrizeOutput {
  puzzleHash: string;
  amountMojos: bigint;
}

export interface PrizePayout extends PrizeOutput {
  address: string;
}

export interface PoolCoinSpend {
  mode: "refund" | "settle";
  solutionHex: string;
  /** Hex sha256tree the authorizer must AGG_SIG_ME. Null for the timeout refund. */
  authorizerMessage: string | null;
  outputs: PrizeOutput[];
}

function hexBytes(hex: string, label: string, size?: number): Buffer {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${label} must be hex`);
  }
  if (size !== undefined && normalized.length !== size * 2) {
    throw new Error(`${label} must be ${size} bytes`);
  }
  return Buffer.from(normalized, "hex");
}

function paramsAtoms(params: PoolCoinParams): Buffer[] {
  return [
    hexBytes(params.chainTournamentId, "chainTournamentId", 32),
    clvmInt(params.buyInMojos),
    hexBytes(params.playerPuzzleHash, "playerPuzzleHash", 32),
    hexBytes(params.authorizerPublicKey, "authorizerPublicKey", 48),
    clvmInt(BigInt(params.refundAfterSeconds)),
  ];
}

export function chainTournamentId(tournamentId: string): string {
  return createHash("sha256").update(tournamentId, "utf8").digest("hex");
}

/** Inner puzzle hash locked by this entry's DAT CAT. */
export function tournamentPoolPuzzleHash(params: PoolCoinParams): string {
  if (params.buyInMojos <= 0n) throw new Error("buyInMojos must be positive");
  if (!Number.isInteger(params.refundAfterSeconds) || params.refundAfterSeconds < 0) {
    throw new Error("refundAfterSeconds must be a non-negative integer");
  }
  return curryAtomsTreeHash(Buffer.from(TOURNAMENT_POOL_MOD_HASH, "hex"), paramsAtoms(params)).toString(
    "hex",
  );
}

/**
 * Puzzle hash of the CAT coin that holds the entry.
 * `assetId` is the DAT TAIL hash. The outer puzzle is CAT v2 curried with
 * (mod hash, asset id, inner puzzle).
 */
export function tournamentCatPuzzleHash(
  params: PoolCoinParams,
  assetId: string,
  catModHash = CAT_V2_MOD_HASH,
): string {
  const inner = Buffer.from(tournamentPoolPuzzleHash(params), "hex");
  const mod = hexBytes(catModHash, "catModHash", 32);
  const asset = hexBytes(assetId, "assetId", 32);
  return curryTreeHash(mod, [sha256tree(mod), sha256tree(asset), inner]).toString("hex");
}

function payoutTree(outputs: PrizeOutput[]): Clvm {
  return clvmList(
    outputs.map((output) => {
      if (output.amountMojos <= 0n) throw new Error("Payout amounts must be positive");
      return [
        hexBytes(output.puzzleHash, "puzzleHash", 32),
        clvmInt(output.amountMojos),
      ] as Clvm;
    }),
  );
}

/** Message atom signed with AGG_SIG_ME. The coin id and genesis are added by consensus. */
export function settleAuthorizerMessage(params: PoolCoinParams, outputs: PrizeOutput[]): string {
  const tree: Clvm = [
    Buffer.from(SETTLE_DOMAIN, "utf8"),
    [
      hexBytes(params.chainTournamentId, "chainTournamentId", 32),
      [hexBytes(params.playerPuzzleHash, "playerPuzzleHash", 32), payoutTree(outputs)],
    ],
  ];
  return sha256tree(tree).toString("hex");
}

function assertOutputsSum(params: PoolCoinParams, outputs: PrizeOutput[]): void {
  if (outputs.length === 0 || outputs.length > MAX_PAYOUTS) {
    throw new Error(`Settle requires 1 to ${MAX_PAYOUTS} outputs`);
  }
  let sum = 0n;
  for (const output of outputs) {
    if (output.amountMojos <= 0n) throw new Error("Payout amounts must be positive");
    sum += output.amountMojos;
  }
  if (sum !== params.buyInMojos) {
    throw new Error("Entry coin outputs must sum to the buy-in");
  }
}

export function buildRefundSpend(params: PoolCoinParams): PoolCoinSpend {
  const solution = clvmList([clvmInt(0n), Buffer.alloc(0)]);
  return {
    mode: "refund",
    solutionHex: serializeClvm(solution).toString("hex"),
    authorizerMessage: null,
    outputs: [{ puzzleHash: params.playerPuzzleHash, amountMojos: params.buyInMojos }],
  };
}

export function buildSettleSpend(params: PoolCoinParams, outputs: PrizeOutput[]): PoolCoinSpend {
  assertOutputsSum(params, outputs);
  const solution = clvmList([clvmInt(1n), payoutTree(outputs)]);
  return {
    mode: "settle",
    solutionHex: serializeClvm(solution).toString("hex"),
    authorizerMessage: settleAuthorizerMessage(params, outputs),
    outputs,
  };
}

export function buildTournamentJoinMessage(params: {
  tournamentId: string;
  address: string;
  puzzleHash: string;
  buyInMojos: string;
  custody: EntryCustody;
}): string {
  return `dat-poker:v1:tournament-join:${params.tournamentId}:${params.address}:${params.puzzleHash}:${params.buyInMojos}:${params.custody}`;
}

export function buildTournamentLockMessage(params: {
  tournamentId: string;
  entryId: string;
  coinId: string;
}): string {
  return `dat-poker:v1:tournament-lock:${params.tournamentId}:${params.entryId}:${params.coinId}`;
}

export function buildSiteRedeemMessage(params: {
  address: string;
  amountMojos: string;
  nonce: string;
}): string {
  return `dat-poker:v1:site-dat-redeem:${params.address}:${params.amountMojos}:${params.nonce}`;
}

/** Sit-and-gos are these two fields. Anything else is an open tournament. */
export const SNG_FIELD_SIZES = [8, 16] as const;

/**
 * Paid places are the top 20% of the field, at least one.
 * `round` is half away from zero, done in integers so 0.2's binary
 * expansion cannot move a boundary.
 */
export function paidPlaceCount(field: number): number {
  if (!Number.isInteger(field) || field < 1) {
    throw new Error("Field size must be a positive integer");
  }
  return Math.max(1, Math.floor((field * 2 + 5) / 10));
}

/**
 * Linear weights `places … 1`, scaled to 10_000 bps.
 * Leftover bps go to first so the table sums to exactly 10_000.
 * An 8-max pays 2 places (6667 / 3333). A 16-max pays 3 (5001 / 3333 / 1666).
 */
export function payoutBpsForField(field: number): number[] {
  const places = paidPlaceCount(field);
  const weightSum = (places * (places + 1)) / 2;
  const bps: number[] = [];
  let assigned = 0;
  for (let index = 0; index < places; index += 1) {
    const share = Math.floor(((places - index) * 10_000) / weightSum);
    bps.push(share);
    assigned += share;
  }
  bps[0] = (bps[0] ?? 0) + (10_000 - assigned);
  return bps;
}

/** Operator seat used to fill a field when no other player is available. */
export function houseEntryAddress(tournamentId: string, index: number): string {
  return `dat-poker:house:${tournamentId}:${index}`;
}

/** Not a wallet puzzle hash. House prizes must not be the on-chain output. */
export function housePuzzleHash(address: string): string {
  return createHash("sha256").update(address, "utf8").digest("hex");
}

export function prizesForFinish(
  totalMojos: bigint,
  payoutBps: number[],
  finish: Array<{ address: string; puzzleHash: string }>,
): PrizePayout[] {
  if (payoutBps.length !== finish.length) {
    throw new Error("Finish order must have one player per payout place");
  }
  if (payoutBps.length === 0) throw new Error("Payout table is empty");
  const amounts = payoutBps.map((bps) => (totalMojos * BigInt(bps)) / 10_000n);
  const paid = amounts.reduce((sum, amount) => sum + amount, 0n);
  amounts[0] = (amounts[0] ?? 0n) + (totalMojos - paid);
  const prizes: PrizePayout[] = [];
  for (let i = 0; i < amounts.length; i += 1) {
    const amount = amounts[i]!;
    if (amount <= 0n) continue;
    const place = finish[i]!;
    prizes.push({
      address: place.address,
      puzzleHash: place.puzzleHash,
      amountMojos: amount,
    });
  }
  return prizes;
}

export interface DisbursementPlan {
  coinSpends: Array<{ playerPuzzleHash: string; outputs: PrizeOutput[] }>;
  siteCredits: PrizePayout[];
}

/**
 * Pay prizes from pool coins first, then from site-ledger collateral.
 * Each pool coin's outputs sum to `buyInMojos`, so the coin can be spent on its own.
 */
export function planTournamentDisbursement(input: {
  buyInMojos: bigint;
  poolPlayerPuzzleHashes: string[];
  siteMojos: bigint;
  payouts: PrizePayout[];
}): DisbursementPlan {
  if (input.buyInMojos <= 0n) throw new Error("buyInMojos must be positive");
  const onChainTotal = input.buyInMojos * BigInt(input.poolPlayerPuzzleHashes.length);
  if (input.siteMojos < 0n) throw new Error("site collateral cannot be negative");
  const collateral = onChainTotal + input.siteMojos;
  let payoutTotal = 0n;
  for (const payout of input.payouts) {
    if (payout.amountMojos <= 0n) throw new Error("Prize amounts must be positive");
    payoutTotal += payout.amountMojos;
  }
  if (payoutTotal !== collateral) {
    throw new Error("Prizes must equal locked pool coins plus site-ledger entries");
  }

  let onChainLeft = onChainTotal;
  let siteLeft = input.siteMojos;
  const onChainPayouts: PrizeOutput[] = [];
  const siteCredits: PrizePayout[] = [];
  for (const payout of input.payouts) {
    const fromChain = payout.amountMojos < onChainLeft ? payout.amountMojos : onChainLeft;
    const fromSite = payout.amountMojos - fromChain;
    if (fromSite > siteLeft) throw new Error("Site ledger cannot cover the remaining prizes");
    onChainLeft -= fromChain;
    siteLeft -= fromSite;
    if (fromChain > 0n) {
      onChainPayouts.push({ puzzleHash: payout.puzzleHash, amountMojos: fromChain });
    }
    if (fromSite > 0n) {
      siteCredits.push({
        address: payout.address,
        puzzleHash: payout.puzzleHash,
        amountMojos: fromSite,
      });
    }
  }

  const coins = input.poolPlayerPuzzleHashes.map((playerPuzzleHash) => ({
    playerPuzzleHash,
    remaining: input.buyInMojos,
    outputs: [] as PrizeOutput[],
  }));
  let coinIndex = 0;
  for (const payout of onChainPayouts) {
    let left = payout.amountMojos;
    while (left > 0n) {
      const coin = coins[coinIndex];
      if (!coin || coin.remaining <= 0n) {
        throw new Error("On-chain prizes do not fit in the entry coins");
      }
      const pay = left < coin.remaining ? left : coin.remaining;
      const last = coin.outputs[coin.outputs.length - 1];
      if (last && last.puzzleHash === payout.puzzleHash) {
        last.amountMojos += pay;
      } else {
        coin.outputs.push({ puzzleHash: payout.puzzleHash, amountMojos: pay });
      }
      coin.remaining -= pay;
      left -= pay;
      if (coin.remaining === 0n) coinIndex += 1;
    }
  }
  if (coins.some((coin) => coin.remaining !== 0n)) {
    throw new Error("Entry coins were not fully paid out");
  }

  return {
    coinSpends: coins.map((coin) => ({
      playerPuzzleHash: coin.playerPuzzleHash,
      outputs: coin.outputs,
    })),
    siteCredits,
  };
}

/** Tree hash of the checked-in compiled puzzle. */
export function compiledPuzzleModHash(serializedHex: string): string {
  const bytes = Buffer.from(serializedHex.trim(), "hex");
  const parsedProgram = parseClvm(bytes);
  if (parsedProgram.offset !== bytes.length) {
    throw new Error("Compiled puzzle hex has trailing bytes");
  }
  return sha256tree(parsedProgram.value).toString("hex");
}
