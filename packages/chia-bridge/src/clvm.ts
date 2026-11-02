import { createHash } from "node:crypto";

/** A CLVM atom, or a cons pair. The empty atom is both nil and integer 0. */
export type Clvm = Buffer | [Clvm, Clvm];

export function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

export function sha256tree(value: Clvm): Buffer {
  if (Buffer.isBuffer(value)) {
    return sha256(Buffer.concat([Buffer.from([0x01]), value]));
  }
  return sha256(Buffer.concat([Buffer.from([0x02]), sha256tree(value[0]), sha256tree(value[1])]));
}

/** Minimal big-endian CLVM integer atom. 0 is the empty atom. */
export function clvmInt(value: bigint): Buffer {
  if (value < 0n) {
    throw new Error("Negative CLVM integers are not used by the tournament pool");
  }
  if (value === 0n) return Buffer.alloc(0);
  const hex = value.toString(16);
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  let bytes = Buffer.from(padded, "hex");
  if (bytes[0]! >= 0x80) {
    bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  }
  return bytes;
}

export function clvmList(items: Clvm[]): Clvm {
  let node: Clvm = Buffer.alloc(0);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    node = [items[i]!, node];
  }
  return node;
}

function serializeAtom(atom: Buffer): Buffer {
  if (atom.length === 0) return Buffer.from([0x80]);
  if (atom.length === 1 && atom[0]! < 0x80) return Buffer.from([atom[0]!]);
  if (atom.length < 0x40) {
    return Buffer.concat([Buffer.from([0x80 | atom.length]), atom]);
  }
  if (atom.length < 0x2000) {
    return Buffer.concat([
      Buffer.from([0xc0 | (atom.length >> 8), atom.length & 0xff]),
      atom,
    ]);
  }
  if (atom.length < 0x100000) {
    return Buffer.concat([
      Buffer.from([0xe0 | (atom.length >> 16), (atom.length >> 8) & 0xff, atom.length & 0xff]),
      atom,
    ]);
  }
  throw new Error("CLVM atom is too large to serialize");
}

export function serializeClvm(value: Clvm): Buffer {
  if (Buffer.isBuffer(value)) return serializeAtom(value);
  return Buffer.concat([Buffer.from([0xff]), serializeClvm(value[0]), serializeClvm(value[1])]);
}

export function parseClvm(buf: Buffer, offset = 0): { value: Clvm; offset: number } {
  const prefix = buf[offset];
  if (prefix === undefined) throw new Error("Truncated CLVM");
  if (prefix === 0xff) {
    const left = parseClvm(buf, offset + 1);
    const right = parseClvm(buf, left.offset);
    return { value: [left.value, right.value], offset: right.offset };
  }
  if (prefix < 0x80) {
    return { value: Buffer.from([prefix]), offset: offset + 1 };
  }
  let length = 0;
  let start = offset + 1;
  if (prefix <= 0xbf) {
    length = prefix & 0x3f;
  } else if (prefix <= 0xdf) {
    length = ((prefix & 0x1f) << 8) | (buf[offset + 1] ?? 0);
    start = offset + 2;
  } else if (prefix <= 0xef) {
    length = ((prefix & 0x0f) << 16) | ((buf[offset + 1] ?? 0) << 8) | (buf[offset + 2] ?? 0);
    start = offset + 3;
  } else {
    throw new Error("Unsupported CLVM size prefix");
  }
  const atom = Buffer.from(buf.subarray(start, start + length));
  if (atom.length !== length) throw new Error("Truncated CLVM atom");
  return { value: atom, offset: start + length };
}

const ONE = sha256tree(Buffer.from([0x01]));
const TWO = sha256tree(Buffer.from([0x02]));
const FOUR = sha256tree(Buffer.from([0x04]));
const NIL = sha256tree(Buffer.alloc(0));

function pairHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x02]), left, right]));
}

/**
 * Tree hash of `(a (q . MOD) (c (q . arg1) (c (q . arg2) ... 1)))`.
 * `a` and `c` are proper lists. `(q . value)` is a cons pair.
 * `argTreeHashes` are sha256tree of each curried argument.
 */
export function curryTreeHash(modHash: Buffer, argTreeHashes: Buffer[]): Buffer {
  let env = ONE;
  for (let i = argTreeHashes.length - 1; i >= 0; i -= 1) {
    const quoted = pairHash(ONE, argTreeHashes[i]!);
    env = pairHash(FOUR, pairHash(quoted, pairHash(env, NIL)));
  }
  const quotedMod = pairHash(ONE, modHash);
  return pairHash(TWO, pairHash(quotedMod, pairHash(env, NIL)));
}

export function curryAtomsTreeHash(modHash: Buffer, atoms: Buffer[]): Buffer {
  return curryTreeHash(
    modHash,
    atoms.map((atom) => sha256tree(atom)),
  );
}
