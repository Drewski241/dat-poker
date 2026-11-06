import { aggregateAug, signAug, verifyAug } from "./bls.js";
import {
  bytesToHex,
  catPuzzleHash,
  channelPuzzleHash,
  concatBytes,
  hexToBytes,
  intToBytes,
  properList,
  sha256Bytes,
  treeHash,
  utf8Atom,
} from "./clvm.js";

export const MAINNET_GENESIS = hexToBytes(
  "ccd5bb71183532bff220ba46c268991a3ff07eb358e8255a65c30a2dce0e5fbb",
);
export const TESTNET11_GENESIS = hexToBytes(
  "37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615",
);

export type ChannelPartyName = "alice" | "bob";
export type ChannelStatus = "awaiting-signatures" | "active" | "desynced" | "closed";

export interface ChannelPlayer {
  playerId: string;
  publicKeyHex: string;
  payoutPuzzleHashHex: string;
}

export interface OpenCatChannelParams {
  assetIdHex: string;
  timeoutBlocks: number;
  network: "mainnet" | "testnet";
  alice: ChannelPlayer;
  bob: ChannelPlayer;
  aliceAmount: bigint;
  bobAmount: bigint;
  /** Parent of the funding coin. Omitted until the CAT spend is built. */
  parentCoinIdHex?: string;
}

export interface CatChannelSnapshot {
  status: ChannelStatus;
  sequence: number;
  timeoutBlocks: number;
  aliceAmount: string;
  bobAmount: string;
  lockedMojos: string;
  nonceHex: string;
  assetIdHex: string;
  innerPuzzleHashHex: string;
  catPuzzleHashHex: string;
  coinIdHex: string;
  coinIdSimulated: boolean;
  stateMessageHex: string;
  closeSigningHex: string;
  potato: ChannelPartyName;
  fullSigHolder: ChannelPartyName;
  signed: boolean;
  closeReady: boolean;
  alice: ChannelPlayer;
  bob: ChannelPlayer;
  shares: { alice?: string; bob?: string };
  closeShares: { alice?: string; bob?: string };
  desyncReason?: string;
}

interface Balance {
  sequence: number;
  aliceAmount: bigint;
  bobAmount: bigint;
}

function require32(hex: string, label: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes`);
  return bytes;
}

function require48(hex: string, label: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 48) throw new Error(`${label} must be 48 bytes`);
  return bytes;
}

function uint64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("Amount does not fit in a Chia coin amount");
  }
  const out = new Uint8Array(8);
  let remaining = value;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

export function potatoParty(sequence: number): ChannelPartyName {
  return sequence % 2 === 0 ? "alice" : "bob";
}

/** The other player finishes the aggregate and is the one who can publish it. */
export function fullSignatureHolder(sequence: number): ChannelPartyName {
  return sequence % 2 === 0 ? "bob" : "alice";
}

export function channelNonce(params: {
  assetId: Uint8Array;
  alicePk: Uint8Array;
  bobPk: Uint8Array;
  alicePh: Uint8Array;
  bobPh: Uint8Array;
  timeoutBlocks: number;
  aliceAmount: bigint;
  bobAmount: bigint;
}): Uint8Array {
  return sha256Bytes(
    utf8Atom("DAT/1/nonce"),
    params.assetId,
    params.alicePk,
    params.bobPk,
    params.alicePh,
    params.bobPh,
    uint64(BigInt(params.timeoutBlocks)),
    uint64(params.aliceAmount),
    uint64(params.bobAmount),
  );
}

export function hashBalanceMessage(
  domain: "DAT/1/state" | "DAT/1/close",
  nonce: Uint8Array,
  sequence: number | null,
  alicePh: Uint8Array,
  aliceAmount: bigint,
  bobPh: Uint8Array,
  bobAmount: bigint,
): Uint8Array {
  const items = [
    utf8Atom(domain),
    nonce,
    ...(sequence === null ? [] : [intToBytes(BigInt(sequence))]),
    alicePh,
    intToBytes(aliceAmount),
    bobPh,
    intToBytes(bobAmount),
  ];
  return treeHash(properList(items));
}

export function coinId(parentId: Uint8Array, puzzleHash: Uint8Array, amount: bigint): Uint8Array {
  return sha256Bytes(parentId, puzzleHash, uint64(amount));
}

/** AGG_SIG_ME signs the condition message concatenated with the coin id and genesis. */
export function aggSigMePayload(message: Uint8Array, id: Uint8Array, genesis: Uint8Array): Uint8Array {
  return concatBytes(message, id, genesis);
}

export class CatChannelSession {
  readonly assetId: Uint8Array;
  readonly timeoutBlocks: number;
  readonly network: "mainnet" | "testnet";
  readonly alice: ChannelPlayer;
  readonly bob: ChannelPlayer;
  readonly alicePk: Uint8Array;
  readonly bobPk: Uint8Array;
  readonly alicePh: Uint8Array;
  readonly bobPh: Uint8Array;
  readonly nonce: Uint8Array;
  readonly lockedMojos: bigint;
  readonly initialAlice: bigint;
  readonly initialBob: bigint;
  readonly innerPuzzleHash: Uint8Array;
  readonly wrappedPuzzleHash: Uint8Array;
  readonly parentCoinId: Uint8Array;
  readonly simulatedParent: boolean;
  status: ChannelStatus = "awaiting-signatures";
  sequence = 0;
  aliceAmount: bigint;
  bobAmount: bigint;
  desyncReason?: string;
  private readonly shares = new Map<ChannelPartyName, Uint8Array>();
  private readonly closeShares = new Map<ChannelPartyName, Uint8Array>();
  private readonly history: Balance[] = [];

  private constructor(params: OpenCatChannelParams) {
    if (params.aliceAmount <= 0n || params.bobAmount <= 0n) {
      throw new Error("Both players must lock a positive DAT amount");
    }
    if (!Number.isInteger(params.timeoutBlocks) || params.timeoutBlocks < 1 || params.timeoutBlocks > 5000) {
      throw new Error("Timeout must be between 1 and 5000 blocks");
    }
    this.assetId = require32(params.assetIdHex, "Asset id");
    this.timeoutBlocks = params.timeoutBlocks;
    this.network = params.network;
    this.alice = params.alice;
    this.bob = params.bob;
    this.alicePk = require48(params.alice.publicKeyHex, "Alice public key");
    this.bobPk = require48(params.bob.publicKeyHex, "Bob public key");
    this.alicePh = require32(params.alice.payoutPuzzleHashHex, "Alice payout puzzle hash");
    this.bobPh = require32(params.bob.payoutPuzzleHashHex, "Bob payout puzzle hash");
    this.aliceAmount = params.aliceAmount;
    this.bobAmount = params.bobAmount;
    this.initialAlice = params.aliceAmount;
    this.initialBob = params.bobAmount;
    this.lockedMojos = params.aliceAmount + params.bobAmount;
    this.nonce = channelNonce({
      assetId: this.assetId,
      alicePk: this.alicePk,
      bobPk: this.bobPk,
      alicePh: this.alicePh,
      bobPh: this.bobPh,
      timeoutBlocks: this.timeoutBlocks,
      aliceAmount: params.aliceAmount,
      bobAmount: params.bobAmount,
    });
    this.innerPuzzleHash = channelPuzzleHash({
      alicePk: this.alicePk,
      bobPk: this.bobPk,
      timeoutBlocks: this.timeoutBlocks,
      nonce: this.nonce,
    });
    this.wrappedPuzzleHash = catPuzzleHash(this.assetId, this.innerPuzzleHash);
    if (params.parentCoinIdHex) {
      this.parentCoinId = require32(params.parentCoinIdHex, "Parent coin id");
      this.simulatedParent = false;
    } else {
      this.parentCoinId = sha256Bytes(utf8Atom("DAT/1/sim-parent"), this.nonce);
      this.simulatedParent = true;
    }
    this.history.push({ sequence: 0, aliceAmount: this.aliceAmount, bobAmount: this.bobAmount });
  }

  static open(params: OpenCatChannelParams): CatChannelSession {
    return new CatChannelSession(params);
  }

  get signed(): boolean {
    return this.shares.has("alice") && this.shares.has("bob") && this.status !== "desynced" && this.status !== "closed";
  }

  get closeReady(): boolean {
    return this.closeShares.has("alice") && this.closeShares.has("bob");
  }

  stateMessage(): Uint8Array {
    return hashBalanceMessage(
      "DAT/1/state",
      this.nonce,
      this.sequence,
      this.alicePh,
      this.aliceAmount,
      this.bobPh,
      this.bobAmount,
    );
  }

  closeMessage(): Uint8Array {
    return hashBalanceMessage(
      "DAT/1/close",
      this.nonce,
      null,
      this.alicePh,
      this.aliceAmount,
      this.bobPh,
      this.bobAmount,
    );
  }

  genesis(): Uint8Array {
    return this.network === "testnet" ? TESTNET11_GENESIS : MAINNET_GENESIS;
  }

  currentCoinId(): Uint8Array {
    return coinId(this.parentCoinId, this.wrappedPuzzleHash, this.lockedMojos);
  }

  closeSigningMessage(): Uint8Array {
    return aggSigMePayload(this.closeMessage(), this.currentCoinId(), this.genesis());
  }

  partyOf(playerId: string): ChannelPartyName {
    if (playerId === this.alice.playerId) return "alice";
    if (playerId === this.bob.playerId) return "bob";
    throw new Error("Player is not on this channel");
  }

  submitStateShare(playerId: string, signatureHex: string): void {
    this.assertOpenForSignatures();
    const party = this.partyOf(playerId);
    const signature = hexToBytes(signatureHex);
    const pubkey = party === "alice" ? this.alicePk : this.bobPk;
    if (!verifyAug(pubkey, this.stateMessage(), signature)) {
      throw new Error("State signature does not match this channel balance");
    }
    this.shares.set(party, signature);
    if (this.signed) this.status = "active";
  }

  submitCloseShare(playerId: string, signatureHex: string): void {
    if (this.status === "desynced" || this.status === "closed") {
      throw new Error("Channel cannot close from this status");
    }
    if (!this.signed) throw new Error("Sign the current balance before closing");
    const party = this.partyOf(playerId);
    const signature = hexToBytes(signatureHex);
    const pubkey = party === "alice" ? this.alicePk : this.bobPk;
    if (!verifyAug(pubkey, this.closeSigningMessage(), signature)) {
      throw new Error("Close signature does not match this channel");
    }
    this.closeShares.set(party, signature);
  }

  propose(aliceAmount: bigint, bobAmount: bigint): void {
    if (this.status === "closed") throw new Error("Channel is closed");
    if (this.status === "desynced") throw new Error(this.desyncReason ?? "Channel is desynced");
    if (!this.signed) throw new Error("Both players must sign the current balance first");
    if (aliceAmount < 0n || bobAmount < 0n) throw new Error("Balances cannot be negative");
    if (aliceAmount + bobAmount !== this.lockedMojos) {
      this.status = "desynced";
      this.desyncReason = "Stack sum left the locked DAT pot";
      throw new Error(this.desyncReason);
    }
    this.sequence += 1;
    this.aliceAmount = aliceAmount;
    this.bobAmount = bobAmount;
    this.shares.clear();
    this.closeShares.clear();
    this.status = "awaiting-signatures";
    this.history.push({ sequence: this.sequence, aliceAmount, bobAmount });
  }

  /** Latest odd state, used to preempt a published opening (even) unroll. */
  latestOddState(): Balance | undefined {
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const entry = this.history[i];
      if (entry.sequence % 2 === 1) return entry;
    }
    return undefined;
  }

  openingState(): Balance {
    return this.history[0];
  }

  aggregateStateSignature(): Uint8Array {
    const alice = this.shares.get("alice");
    const bob = this.shares.get("bob");
    if (!alice || !bob) throw new Error("Both state signatures are required");
    return aggregateAug([alice, bob]);
  }

  snapshot(): CatChannelSnapshot {
    const shareHex = (party: ChannelPartyName) => {
      const share = this.shares.get(party);
      return share ? bytesToHex(share) : undefined;
    };
    const closeHex = (party: ChannelPartyName) => {
      const share = this.closeShares.get(party);
      return share ? bytesToHex(share) : undefined;
    };
    return {
      status: this.signed ? "active" : this.status,
      sequence: this.sequence,
      timeoutBlocks: this.timeoutBlocks,
      aliceAmount: this.aliceAmount.toString(),
      bobAmount: this.bobAmount.toString(),
      lockedMojos: this.lockedMojos.toString(),
      nonceHex: bytesToHex(this.nonce),
      assetIdHex: bytesToHex(this.assetId),
      innerPuzzleHashHex: bytesToHex(this.innerPuzzleHash),
      catPuzzleHashHex: bytesToHex(this.wrappedPuzzleHash),
      coinIdHex: bytesToHex(this.currentCoinId()),
      coinIdSimulated: this.simulatedParent,
      stateMessageHex: bytesToHex(this.stateMessage()),
      closeSigningHex: bytesToHex(this.closeSigningMessage()),
      potato: potatoParty(this.sequence),
      fullSigHolder: fullSignatureHolder(this.sequence),
      signed: this.signed,
      closeReady: this.closeReady,
      alice: this.alice,
      bob: this.bob,
      shares: { alice: shareHex("alice"), bob: shareHex("bob") },
      closeShares: { alice: closeHex("alice"), bob: closeHex("bob") },
      desyncReason: this.desyncReason,
    };
  }

  signState(secretKey: Uint8Array): Uint8Array {
    return signAug(secretKey, this.stateMessage());
  }

  signClose(secretKey: Uint8Array): Uint8Array {
    return signAug(secretKey, this.closeSigningMessage());
  }

  private assertOpenForSignatures(): void {
    if (this.status === "closed" || this.status === "desynced") {
      throw new Error("Channel is not accepting signatures");
    }
  }
}
