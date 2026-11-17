import { randomUUID } from "node:crypto";

const PENDING_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingCloudWalletOAuth {
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

export interface CloudWalletSessionRecord {
  sessionId: string;
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number;
  walletId?: string;
  createdAt: number;
  updatedAt: number;
}

const pendingByState = new Map<string, PendingCloudWalletOAuth>();
const sessionsById = new Map<string, CloudWalletSessionRecord>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [state, pending] of pendingByState) {
    if (now - pending.createdAt > PENDING_TTL_MS) pendingByState.delete(state);
  }
  for (const [id, session] of sessionsById) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessionsById.delete(id);
  }
}

export function savePendingOAuth(pending: PendingCloudWalletOAuth): void {
  pruneExpired();
  pendingByState.set(pending.state, pending);
}

export function takePendingOAuth(state: string): PendingCloudWalletOAuth | undefined {
  pruneExpired();
  const pending = pendingByState.get(state);
  if (!pending) return undefined;
  pendingByState.delete(state);
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) return undefined;
  return pending;
}

export function createCloudWalletSession(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresInSec?: number;
}): CloudWalletSessionRecord {
  pruneExpired();
  const now = Date.now();
  const session: CloudWalletSessionRecord = {
    sessionId: randomUUID(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now + (tokens.expiresInSec ?? 3600) * 1000,
    createdAt: now,
    updatedAt: now,
  };
  sessionsById.set(session.sessionId, session);
  return session;
}

export function getCloudWalletSession(sessionId: string): CloudWalletSessionRecord | undefined {
  pruneExpired();
  return sessionsById.get(sessionId);
}

export function updateCloudWalletSession(
  sessionId: string,
  patch: Partial<Pick<CloudWalletSessionRecord, "accessToken" | "refreshToken" | "accessExpiresAt" | "walletId">>,
): CloudWalletSessionRecord | undefined {
  const existing = sessionsById.get(sessionId);
  if (!existing) return undefined;
  const updated: CloudWalletSessionRecord = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  sessionsById.set(sessionId, updated);
  return updated;
}

export function deleteCloudWalletSession(sessionId: string): void {
  sessionsById.delete(sessionId);
}

/** Test-only reset */
export function clearCloudWalletSessionStore(): void {
  pendingByState.clear();
  sessionsById.clear();
}