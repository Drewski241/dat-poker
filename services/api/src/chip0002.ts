import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const bls = createRequire(import.meta.url)("chia-bls") as typeof import("chia-bls");
const { AugSchemeMPL, JacobianPoint, PrivateKey, coreSignMpl, coreVerifyMpl } = bls;

/** CHIP-0002 prefix — a signed text cannot be reused as a coin spend. */
export const CHIP0002_PREFIX = "Chia Signed Message";

const CHIP0002_DST = Buffer.from("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG:CHIP-0002_");
const CHIP0002_HEX_DST = Buffer.from("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG:CHIP-0002_HEX");

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

/** CLVM sha256tree of an atom. */
function sha256treeAtom(atom: Uint8Array): Buffer {
  return sha256(Buffer.concat([Buffer.from([1]), Buffer.from(atom)]));
}

/** CLVM sha256tree of a cons pair of atoms: (prefix . message). */
export function chip0002TreeHash(message: Uint8Array): Buffer {
  const left = sha256treeAtom(Buffer.from(CHIP0002_PREFIX, "utf8"));
  const right = sha256treeAtom(message);
  return sha256(Buffer.concat([Buffer.from([2]), left, right]));
}

function stripHex(value: string): string {
  return value.trim().replace(/^0x/i, "");
}

function parseG1(pubkeyHex: string): InstanceType<typeof JacobianPoint> | null {
  try {
    return JacobianPoint.fromHexG1(stripHex(pubkeyHex));
  } catch {
    return null;
  }
}

function parseG2(signatureHex: string): InstanceType<typeof JacobianPoint> | null {
  try {
    return JacobianPoint.fromHexG2(stripHex(signatureHex));
  } catch {
    return null;
  }
}

function payloadsForMessage(message: string): Buffer[] {
  const utf8 = Buffer.from(message, "utf8");
  const hashes = [chip0002TreeHash(utf8)];
  const hex = stripHex(message);
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length > 0) {
    hashes.push(chip0002TreeHash(Buffer.from(hex, "hex")));
  }
  return hashes;
}

/**
 * Verify a Sage / CHIP-0002 `signMessage` or `chia_signMessageByAddress` proof.
 * Tries the CHIP-0002 ciphersuite and standard AugSchemeMPL because wallets differ.
 */
export function verifyChip0002Signature(pubkeyHex: string, message: string, signatureHex: string): boolean {
  const pk = parseG1(pubkeyHex);
  const sig = parseG2(signatureHex);
  if (!pk || !sig || !message || !stripHex(pubkeyHex) || !stripHex(signatureHex)) {
    return false;
  }
  const dsts = [CHIP0002_DST, CHIP0002_HEX_DST];
  for (const payload of payloadsForMessage(message)) {
    for (const dst of dsts) {
      try {
        if (coreVerifyMpl(pk, payload, sig, dst)) return true;
      } catch {
        /* invalid point or dst mismatch */
      }
    }
    try {
      if (AugSchemeMPL.verify(pk, payload, sig)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Test helper: CHIP-0002 ciphersuite over UTF-8 message bytes. */
export function signChip0002ForTests(seed: Uint8Array, message: string): { pubkey: string; signature: string } {
  const sk = PrivateKey.fromSeed(seed);
  const pk = sk.getG1();
  const payload = chip0002TreeHash(Buffer.from(message, "utf8"));
  const sig = coreSignMpl(sk, payload, CHIP0002_DST);
  return { pubkey: pk.toHex(), signature: sig.toHex() };
}

export function playerIdFromPubkey(pubkeyHex: string): string {
  const normalized = stripHex(pubkeyHex).toLowerCase();
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `pk_${digest.slice(0, 40)}`;
}
