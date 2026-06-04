import type { BuyInProof } from "./wallet-config.js";

const verifiedBuyIns = new Set<string>();

function buyInKey(tableId: string, playerId: string): string {
  return `${tableId}:${playerId}`;
}

export function recordBuyIn(tableId: string, playerId: string, _proof: BuyInProof): void {
  verifiedBuyIns.add(buyInKey(tableId, playerId));
}

export function hasBuyIn(tableId: string, playerId: string): boolean {
  return verifiedBuyIns.has(buyInKey(tableId, playerId));
}
