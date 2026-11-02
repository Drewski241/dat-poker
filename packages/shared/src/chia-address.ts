const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= GENERATOR[i]!;
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (bits >= from) return null;
  if ((acc << (to - bits)) & max) return null;
  return out;
}

export function decodeBech32m(value: string): { hrp: string; data: Uint8Array } {
  if (value.length < 8 || value.length > 90) {
    throw new Error("Invalid bech32m string");
  }
  const lower = value.toLowerCase();
  const upper = value.toUpperCase();
  if (value !== lower && value !== upper) {
    throw new Error("Bech32m string mixes upper and lower case");
  }
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) {
    throw new Error("Invalid bech32m separator");
  }
  const hrp = lower.slice(0, pos);
  const data: number[] = [];
  for (const char of lower.slice(pos + 1)) {
    const index = CHARSET.indexOf(char);
    if (index === -1) throw new Error("Invalid bech32m character");
    data.push(index);
  }
  if (polymod(hrpExpand(hrp).concat(data)) !== BECH32M_CONST) {
    throw new Error("Invalid bech32m checksum");
  }
  const converted = convertBits(data.slice(0, -6), 5, 8);
  if (!converted) throw new Error("Invalid bech32m payload");
  return { hrp, data: Uint8Array.from(converted) };
}

/** Puzzle hash (64 hex chars) committed by an `xch1` or `txch1` address. */
export function decodeChiaPuzzleHash(address: string): string {
  const decoded = decodeBech32m(address.trim());
  if (decoded.hrp !== "xch" && decoded.hrp !== "txch") {
    throw new Error("Address must be an xch or txch puzzle hash");
  }
  if (decoded.data.length !== 32) {
    throw new Error("Address payload is not a 32-byte puzzle hash");
  }
  return [...decoded.data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
