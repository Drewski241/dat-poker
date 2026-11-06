import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";

/** Empty atom, or a pair. Atoms keep their raw CLVM bytes (0 is empty). */
export type Clvm = Uint8Array | [Clvm, Clvm];

const puzzleDir = join(dirname(fileURLToPath(import.meta.url)), "../puzzles");

let channelModHashCache: Uint8Array | undefined;
let unrollModHashCache: Uint8Array | undefined;

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function sha256Bytes(...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(...parts));
}

/** Minimal signed CLVM integer encoding. Matches `clvm.casts.int_to_bytes`. */
export function intToBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array();
  const magnitude = value < 0n ? -value : value;
  const bitLength = magnitude.toString(2).length;
  const byteCount = (bitLength + 8) >> 3;
  const bytes = new Uint8Array(byteCount);
  let remaining = value;
  for (let i = byteCount - 1; i >= 0; i -= 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === ((bytes[start + 1] & 0x80) !== 0 ? 0xff : 0)) {
    start += 1;
  }
  return bytes.subarray(start);
}

export function treeHash(node: Clvm): Uint8Array {
  if (node instanceof Uint8Array) {
    return sha256Bytes(new Uint8Array([1]), node);
  }
  return sha256Bytes(new Uint8Array([2]), treeHash(node[0]), treeHash(node[1]));
}

export function properList(items: Clvm[]): Clvm {
  let node: Clvm = new Uint8Array();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    node = [items[i], node];
  }
  return node;
}

export function utf8Atom(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Tree hash of a serialized CLVM program (the compiler's `run -d` hex). */
export function treeHashHexProgram(hex: string): Uint8Array {
  const bytes = hexToBytes(hex.trim());
  const cursor = { offset: 0 };
  const program = deserialize(bytes, cursor);
  if (cursor.offset !== bytes.length) {
    throw new Error("Trailing bytes in CLVM program");
  }
  return treeHash(program);
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().replace(/^0x/, "");
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error("Invalid hex");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deserialize(bytes: Uint8Array, cursor: { offset: number }): Clvm {
  const marker = readByte(bytes, cursor);
  if (marker === 0xff) {
    const left = deserialize(bytes, cursor);
    const right = deserialize(bytes, cursor);
    return [left, right];
  }
  return readAtom(bytes, cursor, marker);
}

function readByte(bytes: Uint8Array, cursor: { offset: number }): number {
  const value = bytes[cursor.offset];
  if (value === undefined) throw new Error("Unexpected end of CLVM");
  cursor.offset += 1;
  return value;
}

function readAtom(bytes: Uint8Array, cursor: { offset: number }, marker: number): Uint8Array {
  if (marker === 0x80) return new Uint8Array();
  if (marker <= 0x7f) return new Uint8Array([marker]);
  let bitCount = 0;
  let sizePrefix = marker;
  let mask = 0x80;
  while ((sizePrefix & mask) !== 0) {
    bitCount += 1;
    sizePrefix &= 0xff ^ mask;
    mask >>= 1;
  }
  const sizeBytes = new Uint8Array(bitCount);
  sizeBytes[0] = sizePrefix;
  for (let i = 1; i < bitCount; i += 1) {
    sizeBytes[i] = readByte(bytes, cursor);
  }
  let size = 0;
  for (const byte of sizeBytes) size = (size << 8) + byte;
  const atom = bytes.subarray(cursor.offset, cursor.offset + size);
  if (atom.length !== size) throw new Error("Truncated CLVM atom");
  cursor.offset += size;
  return atom;
}

const NIL_HASH = treeHash(new Uint8Array());
const ONE_HASH = treeHash(new Uint8Array([1]));

function pairHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256Bytes(new Uint8Array([2]), left, right);
}

function quotedHash(argHash: Uint8Array): Uint8Array {
  return pairHash(treeHash(new Uint8Array([1])), argHash);
}

function consArgHash(argHash: Uint8Array, restHash: Uint8Array): Uint8Array {
  return pairHash(treeHash(new Uint8Array([4])), pairHash(quotedHash(argHash), pairHash(restHash, NIL_HASH)));
}

/** Tree hash of `(a (q . mod) (c (q . arg) ... 1))`, matching `Program.curry`. */
export function curryTreeHash(modHash: Uint8Array, argHashes: Uint8Array[]): Uint8Array {
  let envHash = ONE_HASH;
  for (let i = argHashes.length - 1; i >= 0; i -= 1) {
    envHash = consArgHash(argHashes[i], envHash);
  }
  return pairHash(treeHash(new Uint8Array([2])), pairHash(quotedHash(modHash), pairHash(envHash, NIL_HASH)));
}

export function channelModHash(): Uint8Array {
  channelModHashCache ??= treeHashHexProgram(readFileSync(join(puzzleDir, "dat_channel.hex"), "utf8"));
  return channelModHashCache;
}

export function unrollModHash(): Uint8Array {
  unrollModHashCache ??= treeHashHexProgram(readFileSync(join(puzzleDir, "dat_unroll.hex"), "utf8"));
  return unrollModHashCache;
}

/** Official CAT puzzle mod hash from chia_puzzles_py CAT_PUZZLE_HASH. */
export const CAT_MOD_HASH = hexToBytes(
  "37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a",
);

export function catPuzzleHash(tailHash: Uint8Array, innerPuzzleHash: Uint8Array): Uint8Array {
  if (tailHash.length !== 32 || innerPuzzleHash.length !== 32) {
    throw new Error("CAT tail and inner puzzle hash must be 32 bytes");
  }
  return curryTreeHash(CAT_MOD_HASH, [treeHash(CAT_MOD_HASH), treeHash(tailHash), innerPuzzleHash]);
}

export function channelPuzzleHash(params: {
  alicePk: Uint8Array;
  bobPk: Uint8Array;
  timeoutBlocks: number;
  nonce: Uint8Array;
}): Uint8Array {
  const unroll = unrollModHash();
  return curryTreeHash(channelModHash(), [
    treeHash(params.alicePk),
    treeHash(params.bobPk),
    treeHash(intToBytes(BigInt(params.timeoutBlocks))),
    treeHash(params.nonce),
    treeHash(unroll),
  ]);
}
