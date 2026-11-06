import { openDatHeadsUpSession, toGameRelayUrl, type DatHeadsUpSession } from "@dat-poker/chia-bridge";
import type { TableEngine } from "@dat-poker/game-engine";
import { isHousePlayerId } from "@dat-poker/shared";
import { HOUSE_PLAYER_ID } from "./house-id.js";
import { houseLockView, lockHouseBuyIn, settleHouseTable } from "./house-lock.js";

const tableIds = new Set<string>();
const lockedTables = new Set<string>();
const sessions = new Map<string, DatHeadsUpSession>();

export function markHeadsUpTable(tableId: string): void {
  tableIds.add(tableId);
}

export function forgetHeadsUpTable(tableId: string): void {
  tableIds.delete(tableId);
  lockedTables.delete(tableId);
  sessions.delete(tableId);
}

export function isHeadsUpChannel(tableId: string): boolean {
  return tableIds.has(tableId);
}

export function resetHeadsUpChannelsForTests(): void {
  tableIds.clear();
  lockedTables.clear();
  sessions.clear();
}

export function headsUpSessionPublic(tableId: string): {
  rules: string;
  variant: string;
  gameRelayUrl: string;
  xchWagerMojos: "0";
  wagerAsset: "dat";
  houseLocked: boolean;
} | null {
  const session = sessions.get(tableId);
  if (!session) return null;
  return {
    rules: session.rules,
    variant: session.variant,
    gameRelayUrl: session.gameRelayUrl,
    xchWagerMojos: "0",
    wagerAsset: "dat",
    houseLocked: lockedTables.has(tableId),
  };
}

/** Lock the house buy-in, seat the house, and open the DAT channel record. */
export async function openHeadsUpChannel(params: {
  tableId: string;
  table: TableEngine;
  playerId: string;
  buyInMojos: bigint;
  assetId: string | null;
}): Promise<{ locked: boolean }> {
  const locked = (await lockHouseBuyIn(params.tableId, params.buyInMojos)) !== null;
  if (locked) lockedTables.add(params.tableId);
  try {
    if (!params.table.hasPlayer(HOUSE_PLAYER_ID)) {
      const seat = params.table.emptySeatIndex();
      if (seat === null) throw new Error("No seat for the house");
      params.table.seatPlayer(HOUSE_PLAYER_ID, seat, params.buyInMojos);
    }
    const lobby = process.env.CHIA_GAMING_LOBBY_URL ?? "http://localhost:3001";
    const seated = params.table.getSeatedPlayers();
    const human = seated.find((seat) => seat.playerId === params.playerId);
    const house = seated.find((seat) => isHousePlayerId(seat.playerId));
    const session = openDatHeadsUpSession({
      tableId: params.tableId,
      variant: params.table.getConfig().variant,
      playerA: params.playerId,
      playerB: house?.playerId ?? HOUSE_PLAYER_ID,
      playerAStakeMojos: human?.stackMojos ?? params.buyInMojos,
      playerBStakeMojos: house?.stackMojos ?? params.buyInMojos,
      assetId: params.assetId,
      hubPageUrl: lobby.endsWith("/") ? lobby : `${lobby}/`,
      gameRelayUrl: toGameRelayUrl(lobby),
      unit: "dat",
    });
    sessions.set(params.tableId, session);
  } catch (error) {
    if (locked) {
      lockedTables.delete(params.tableId);
      await settleHouseTable(params.tableId, 0n);
    }
    throw error;
  }
  return { locked };
}

/** Return the house reservation after the tester leaves. */
export async function releaseHeadsUpHouse(tableId: string, table: TableEngine): Promise<void> {
  if (!tableIds.has(tableId)) return;
  const house = table.getSeatedPlayers().find((seat) => isHousePlayerId(seat.playerId));
  const remaining = house?.stackMojos ?? 0n;
  const view = await houseLockView(tableId);
  const locked = BigInt(view.tableLockedMojos ?? "0");
  const spent = locked > remaining ? locked - remaining : 0n;
  if (house) {
    try {
      table.cashOutPlayer(house.playerId);
    } catch {
      // The house seat is already empty.
    }
  }
  await settleHouseTable(tableId, spent);
  forgetHeadsUpTable(tableId);
}
