import { bls12_381 } from "@noble/curves/bls12-381.js";

const bls = bls12_381.longSignatures;
const AUG_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_";

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export interface ChannelKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Chia AugSchemeMPL: sign `pk || message` with the AUG hash-to-curve DST. */
export function signAug(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  const publicKey = publicKeyFor(secretKey);
  const hashed = bls.hash(concatBytes(publicKey, message), AUG_DST);
  return bls.Signature.toBytes(bls.sign(hashed, secretKey));
}

export function verifyAug(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const hashed = bls.hash(concatBytes(publicKey, message), AUG_DST);
    return bls.verify(signature, hashed, publicKey);
  } catch {
    return false;
  }
}

export function publicKeyFor(secretKey: Uint8Array): Uint8Array {
  return bls.getPublicKey(secretKey).toBytes();
}

export function generateChannelKey(seed?: Uint8Array): ChannelKeyPair {
  const material = seed ?? crypto.getRandomValues(new Uint8Array(48));
  if (material.length !== 48) {
    throw new Error("Channel key seed must be 48 bytes");
  }
  const generated = bls.keygen(material);
  return {
    secretKey: generated.secretKey,
    publicKey: generated.publicKey.toBytes(),
  };
}

export function aggregateAug(signatures: Uint8Array[]): Uint8Array {
  if (signatures.length === 0) throw new Error("No signatures to aggregate");
  return bls.Signature.toBytes(bls.aggregateSignatures(signatures));
}
