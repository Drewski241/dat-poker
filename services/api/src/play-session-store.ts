export interface PlaySession {
  playerId: string;
  tableId: string;
  redeemUtcDay: string;
  redeemMojos: string;
}

const sessions = new Map<string, PlaySession>();

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getPlaySession(playerId: string): PlaySession | undefined {
  return sessions.get(playerId);
}

export function setPlaySession(session: PlaySession): void {
  sessions.set(session.playerId, session);
}

export function clearPlaySession(playerId: string): void {
  sessions.delete(playerId);
}
