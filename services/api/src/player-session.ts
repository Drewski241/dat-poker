import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { playerIdFromPubkey, verifyChip0002Signature } from "./chip0002.js";

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

interface Challenge {
  address: string;
  nonce: string;
  expiresAt: number;
}

interface TokenPayload {
  v: 1;
  sub: string;
  addr: string;
  pk: string;
  exp: number;
  nonce: string;
}

export interface PlayerSession {
  playerId: string;
  displayAddress: string;
  pubkey: string;
}

const challenges = new Map<string, Challenge>();
const addressToPubkey = new Map<string, string>();
const pubkeyToAddress = new Map<string, string>();

let cachedSecret: Buffer | null = null;

export function sessionTtlSeconds(): number {
  const raw = Number(process.env.DAT_SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 60 ? raw : DEFAULT_TTL_SECONDS;
}

function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.DAT_SESSION_SECRET?.trim();
  cachedSecret = fromEnv ? Buffer.from(fromEnv, "utf8") : randomBytes(32);
  return cachedSecret;
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

function hmac(input: string): Buffer {
  return createHmac("sha256", sessionSecret()).update(input).digest();
}

function normalizeAddress(address: string): string {
  return address.trim();
}

function normalizePubkey(pubkey: string): string {
  return pubkey.trim().replace(/^0x/i, "").toLowerCase();
}

export function buildSessionMessage(params: { nonce: string; address: string }): string {
  return `dat-poker:v1:session:${params.nonce}:${params.address}`;
}

export function createSessionChallenge(address: string): { nonce: string; message: string; expiresAt: string } {
  const trimmed = normalizeAddress(address);
  if (!trimmed || trimmed.length < 8) {
    throw new Error("Valid Chia address required");
  }
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(nonce, { address: trimmed, nonce, expiresAt });
  return {
    nonce,
    message: buildSessionMessage({ nonce, address: trimmed }),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function signSessionToken(session: PlayerSession, ttlSeconds = sessionTtlSeconds()): string {
  const payload: TokenPayload = {
    v: 1,
    sub: session.playerId,
    addr: session.displayAddress,
    pk: session.pubkey,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomBytes(8).toString("hex"),
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(hmac(body));
  return `${body}.${sig}`;
}

function parseToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = hmac(body);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (payload.v !== 1 || !payload.sub || !payload.addr || !payload.pk) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueSessionFromProof(params: {
  address: string;
  nonce: string;
  signature: string;
  pubkey: string;
}): { token: string; session: PlayerSession } {
  const address = normalizeAddress(params.address);
  const pubkey = normalizePubkey(params.pubkey);
  const challenge = challenges.get(params.nonce);
  challenges.delete(params.nonce);
  if (!challenge || challenge.expiresAt < Date.now()) {
    throw new Error("Session challenge expired — request a new one");
  }
  if (challenge.address !== address) {
    throw new Error("Session address does not match challenge");
  }
  const expected = buildSessionMessage({ nonce: params.nonce, address });
  if (!params.signature || !pubkey) {
    throw new Error("Sage session signature required");
  }
  if (!verifyChip0002Signature(pubkey, expected, params.signature)) {
    throw new Error("Invalid Sage session signature");
  }

  const boundPk = addressToPubkey.get(address.toLowerCase());
  if (boundPk && boundPk !== pubkey) {
    throw new Error("This Chia address is already linked to another key. Ask the operator if that is not you.");
  }
  const boundAddr = pubkeyToAddress.get(pubkey);
  if (boundAddr && boundAddr !== address) {
    throw new Error("This wallet key is already linked to another address.");
  }
  addressToPubkey.set(address.toLowerCase(), pubkey);
  pubkeyToAddress.set(pubkey, address);

  const session: PlayerSession = {
    playerId: playerIdFromPubkey(pubkey),
    displayAddress: address,
    pubkey,
  };
  return { token: signSessionToken(session), session };
}

function fakePubkeyForAddress(address: string): string {
  const digest = createHash("sha256").update(address, "utf8").digest("hex");
  return (digest + digest + digest).slice(0, 96);
}

/** Test helper — mints a verified session without BLS (production routes still verify). */
export function issueTestSession(address: string, pubkeyHex?: string): {
  token: string;
  session: PlayerSession;
} {
  const pubkey = normalizePubkey(pubkeyHex ?? fakePubkeyForAddress(address));
  const session: PlayerSession = {
    playerId: playerIdFromPubkey(pubkey),
    displayAddress: address,
    pubkey,
  };
  addressToPubkey.set(address.toLowerCase(), pubkey);
  pubkeyToAddress.set(pubkey, address);
  return { token: signSessionToken(session), session };
}

export function readPlayerSession(req: FastifyRequest): PlayerSession | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice("bearer ".length).trim();
  const payload = parseToken(token);
  if (!payload) return null;
  return {
    playerId: payload.sub,
    displayAddress: payload.addr,
    pubkey: payload.pk,
  };
}

export function requirePlayer(req: FastifyRequest, reply: FastifyReply): PlayerSession | null {
  const session = readPlayerSession(req);
  if (!session) {
    void reply.status(401).send({
      error: "Connect Sage and approve the login signature first. This site cannot move coins; it only signs a login.",
    });
    return null;
  }
  return session;
}

export function sessionMatchesClaim(session: PlayerSession, claimed?: string): boolean {
  if (!claimed) return true;
  const value = claimed.trim();
  return value === session.playerId || value === session.displayAddress;
}

export function resetPlayerSessionsForTests(): void {
  challenges.clear();
  addressToPubkey.clear();
  pubkeyToAddress.clear();
  cachedSecret = null;
}
