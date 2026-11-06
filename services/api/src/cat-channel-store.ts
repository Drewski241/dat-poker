import { createHash } from "node:crypto";
import {
  CatChannelSession,
  bytesToHex,
  generateChannelKey,
  runPuzzleSpend,
  type CatChannelSnapshot,
  type PuzzleSpendResult,
} from "@dat-poker/chia-bridge";
import { HOUSE_PLAYER_ID } from "./house-id.js";

interface ChannelRecord {
  session: CatChannelSession;
  houseSecret?: Uint8Array;
}

const marked = new Set<string>();
const channels = new Map<string, ChannelRecord>();

export function markCatChannelTable(tableId: string): void {
  marked.add(tableId);
}

export function isCatChannelTable(tableId: string): boolean {
  return marked.has(tableId);
}

/** Drop the in-memory channel after the table stack has been returned to the account. */
export function releaseCatChannel(tableId: string): void {
  marked.delete(tableId);
  channels.delete(tableId);
}

export function resetCatChannelsForTests(): void {
  marked.clear();
  channels.clear();
}

export function getCatChannelSnapshot(tableId: string): CatChannelSnapshot | null {
  return channels.get(tableId)?.session.snapshot() ?? null;
}

export function catChannelStartBlock(tableId: string): string | null {
  if (!marked.has(tableId)) return null;
  const session = channels.get(tableId)?.session;
  if (!session) return "Open the DAT channel before the first hand";
  if (session.status === "desynced") return session.desyncReason ?? "DAT channel is out of sync with the table";
  if (!session.signed) return "Both players must sign the current DAT channel balance";
  return null;
}

export interface OpenCatChannelInput {
  tableId: string;
  assetIdHex: string;
  network: "mainnet" | "testnet";
  timeoutBlocks: number;
  alice: { playerId: string; publicKeyHex: string; payoutPuzzleHashHex: string };
  bob: { playerId: string; publicKeyHex?: string; payoutPuzzleHashHex?: string };
  aliceAmount: bigint;
  bobAmount: bigint;
  parentCoinIdHex?: string;
}

export function openCatChannel(input: OpenCatChannelInput): CatChannelSnapshot {
  if (!marked.has(input.tableId)) {
    throw new Error("This table is not a heads-up DAT channel");
  }
  if (channels.has(input.tableId)) {
    throw new Error("Channel already open for this table");
  }
  let houseSecret: Uint8Array | undefined;
  let bobKey = input.bob.publicKeyHex;
  let bobPayout = input.bob.payoutPuzzleHashHex;
  if (input.bob.playerId === HOUSE_PLAYER_ID && !bobKey) {
    const generated = generateChannelKey();
    houseSecret = generated.secretKey;
    bobKey = bytesToHex(generated.publicKey);
    bobPayout = createHash("sha256").update(generated.publicKey).digest("hex");
  }
  if (!bobKey || !bobPayout) {
    throw new Error("Bob public key and payout puzzle hash are required");
  }
  const session = CatChannelSession.open({
    assetIdHex: input.assetIdHex,
    timeoutBlocks: input.timeoutBlocks,
    network: input.network,
    alice: input.alice,
    bob: { playerId: input.bob.playerId, publicKeyHex: bobKey, payoutPuzzleHashHex: bobPayout },
    aliceAmount: input.aliceAmount,
    bobAmount: input.bobAmount,
    parentCoinIdHex: input.parentCoinIdHex,
  });
  channels.set(input.tableId, { session, houseSecret });
  signHouseIfPresent(input.tableId);
  return session.snapshot();
}

export function submitCatChannelStateShare(
  tableId: string,
  playerId: string,
  signatureHex: string,
): CatChannelSnapshot {
  const session = requireSession(tableId);
  session.submitStateShare(playerId, signatureHex);
  return session.snapshot();
}

export function submitCatChannelCloseShare(
  tableId: string,
  playerId: string,
  signatureHex: string,
): CatChannelSnapshot {
  const session = requireSession(tableId);
  session.submitCloseShare(playerId, signatureHex);
  return session.snapshot();
}

export function syncCatChannelAfterHand(
  tableId: string,
  seats: { playerId: string; stackMojos: bigint }[],
): CatChannelSnapshot | null {
  const record = channels.get(tableId);
  if (!record) return null;
  const { session } = record;
  const alice = seats.find((seat) => seat.playerId === session.alice.playerId);
  const bob = seats.find((seat) => seat.playerId === session.bob.playerId);
  if (!alice || !bob) {
    session.status = "desynced";
    session.desyncReason = "A channel player left the table";
    return session.snapshot();
  }
  if (alice.stackMojos === session.aliceAmount && bob.stackMojos === session.bobAmount) {
    return session.snapshot();
  }
  try {
    session.propose(alice.stackMojos, bob.stackMojos);
    signHouseIfPresent(tableId);
  } catch (error) {
    if (session.status !== "desynced") {
      session.status = "desynced";
      session.desyncReason = (error as Error).message;
    }
  }
  return session.snapshot();
}

export function proveCatChannel(tableId: string, kind: "close" | "settle" | "preempt"): PuzzleSpendResult {
  const session = requireSession(tableId);
  const snap = session.snapshot();
  const curryBase = {
    alicePk: session.alice.publicKeyHex,
    bobPk: session.bob.publicKeyHex,
    timeout: session.timeoutBlocks,
    nonce: snap.nonceHex,
  };
  if (kind === "close") {
    return runPuzzleSpend({
      puzzle: "channel",
      curry: curryBase,
      solution: {
        mode: 0,
        sequence: snap.sequence,
        alicePh: session.alice.payoutPuzzleHashHex,
        aliceAmt: snap.aliceAmount,
        bobPh: session.bob.payoutPuzzleHashHex,
        bobAmt: snap.bobAmount,
      },
    });
  }
  if (kind === "settle") {
    return runPuzzleSpend({
      puzzle: "unroll",
      curry: {
        ...curryBase,
        sequence: snap.sequence,
        alicePh: session.alice.payoutPuzzleHashHex,
        aliceAmt: snap.aliceAmount,
        bobPh: session.bob.payoutPuzzleHashHex,
        bobAmt: snap.bobAmount,
      },
      solution: {
        mode: 0,
        newSequence: 0,
        newAlicePh: session.alice.payoutPuzzleHashHex,
        newAliceAmt: "0",
        newBobPh: session.bob.payoutPuzzleHashHex,
        newBobAmt: "0",
      },
    });
  }
  const fresh = session.latestOddState();
  if (!fresh) {
    return { ok: false, error: "Play a hand so the latest balance has the opposite parity from the opening state" };
  }
  const opening = session.openingState();
  return runPuzzleSpend({
    puzzle: "unroll",
    curry: {
      ...curryBase,
      sequence: opening.sequence,
      alicePh: session.alice.payoutPuzzleHashHex,
      aliceAmt: opening.aliceAmount.toString(),
      bobPh: session.bob.payoutPuzzleHashHex,
      bobAmt: opening.bobAmount.toString(),
    },
    solution: {
      mode: 1,
      newSequence: fresh.sequence,
      newAlicePh: session.alice.payoutPuzzleHashHex,
      newAliceAmt: fresh.aliceAmount.toString(),
      newBobPh: session.bob.payoutPuzzleHashHex,
      newBobAmt: fresh.bobAmount.toString(),
    },
  });
}

export function houseCloseSignature(tableId: string): string | null {
  const record = channels.get(tableId);
  if (!record?.houseSecret) return null;
  return bytesToHex(record.session.signClose(record.houseSecret));
}

function signHouseIfPresent(tableId: string): void {
  const record = channels.get(tableId);
  if (!record?.houseSecret) return;
  const signature = bytesToHex(record.session.signState(record.houseSecret));
  record.session.submitStateShare(HOUSE_PLAYER_ID, signature);
}

function requireSession(tableId: string): CatChannelSession {
  const session = channels.get(tableId)?.session;
  if (!session) throw new Error("DAT channel is not open");
  return session;
}
