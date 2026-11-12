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

export function exportBuyIns(): { tableId: string; playerId: string; record: BuyInRecord }[] {
  return [...verifiedBuyIns.entries()].map(([key, record]) => {
    const splitAt = key.indexOf(":");
    return { tableId: key.slice(0, splitAt), playerId: key.slice(splitAt + 1), record };
  });
}

export function replaceBuyIns(entries: { tableId: string; playerId: string; record: BuyInRecord }[]): void {
  verifiedBuyIns.clear();
  for (const entry of entries) {
    verifiedBuyIns.set(buyInKey(entry.tableId, entry.playerId), entry.record);
  }
}
