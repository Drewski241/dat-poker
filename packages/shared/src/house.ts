/** Single-seat house actor used by cash heads-up tables. */
export const HOUSE_PLAYER_ID = "dat-poker:house";

/** Prefix for per-seat house bots filling tournament / SNG seats. */
export const HOUSE_PLAYER_PREFIX = "dat-poker:house:";

export function isHousePlayerId(playerId: string): boolean {
  return playerId === HOUSE_PLAYER_ID || playerId.startsWith(HOUSE_PLAYER_PREFIX);
}

export function houseSeatPlayerId(seatIndex: number): string {
  return `${HOUSE_PLAYER_PREFIX}${seatIndex}`;
}

export type HousePolicy = "passive" | "folding" | "mixed";
