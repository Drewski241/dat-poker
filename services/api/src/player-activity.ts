const lastActiveMs = new Map<string, number>();

/** Minimum 10s; default 2 minutes without polls/actions before unseating between hands. */
export function inactiveUnseatMs(): number {
  const n = Number(process.env.DAT_PLAYER_INACTIVE_UNSEAT_MS ?? 120_000);
  return Number.isFinite(n) && n >= 10_000 ? n : 120_000;
}

export function touchPlayerActivity(playerId: string, nowMs = Date.now()): void {
  lastActiveMs.set(playerId, nowMs);
}

export function getLastPlayerActivity(playerId: string): number | undefined {
  return lastActiveMs.get(playerId);
}

export function clearPlayerActivity(playerId: string): void {
  lastActiveMs.delete(playerId);
}

export function resetPlayerActivityForTests(): void {
  lastActiveMs.clear();
}

/** Test helper — backdate a seated player's last activity. */
export function setPlayerActivityForTests(playerId: string, lastMs: number): void {
  lastActiveMs.set(playerId, lastMs);
}
