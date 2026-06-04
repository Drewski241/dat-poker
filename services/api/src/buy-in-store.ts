import type { BuyInProof } from "./wallet-config.js";

export interface BuyInRecord {
  buyInMojos: string;
  proof: BuyInProof;
  recordedAt: string;
}

const verifiedBuyIns = new Map<string, BuyInRecord>();

function buyInKey(tableId: string, playerId: string): string {
  return `${tableId}:${playerId}`;
}

export function recordBuyIn(
  tableId: string,
  playerId: string,
  proof: BuyInProof,
  buyInMojos: string,
): void {
  verifiedBuyIns.set(buyInKey(tableId, playerId), {
    buyInMojos,
    proof,
    recordedAt: new Date().toISOString(),
  });
}

export function hasBuyIn(tableId: string, playerId: string): boolean {
  return verifiedBuyIns.has(buyInKey(tableId, playerId));
}

export function getBuyInRecord(tableId: string, playerId: string): BuyInRecord | undefined {
  return verifiedBuyIns.get(buyInKey(tableId, playerId));
}

export function clearBuyIn(tableId: string, playerId: string): void {
  verifiedBuyIns.delete(buyInKey(tableId, playerId));
}
