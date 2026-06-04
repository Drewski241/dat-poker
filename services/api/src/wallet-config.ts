import { resolveDatMinBuyInMojos } from "@dat-poker/shared";

export interface DatTokenConfig {
  assetId: string | null;
  ticker: string;
  minBuyInMojos: string;
  devBuyInEnabled: boolean;
  buyInReady: boolean;
}

export function readDatTokenConfig(): DatTokenConfig {
  const assetId = process.env.DAT_GOVERNANCE_TOKEN_ASSET_ID?.trim() || undefined;
  const devBuyInEnabled = process.env.DAT_ALLOW_DEV_BUYIN === "true";
  const minBuyInMojos = resolveDatMinBuyInMojos(process.env.DAT_MIN_BUY_IN_MOJOS).toString();
  return {
    assetId: assetId ?? null,
    ticker: process.env.DAT_GOVERNANCE_TOKEN_TICKER ?? "DAT",
    minBuyInMojos,
    devBuyInEnabled,
    buyInReady: Boolean(assetId) || devBuyInEnabled,
  };
}

export function buildBuyInMessage(params: {
  tableId: string;
  seatIndex: number;
  buyInMojos: string;
  address: string;
}): string {
  return `dat-poker:v1:buy-in:${params.tableId}:${params.seatIndex}:${params.buyInMojos}:${params.address}`;
}

export function buildWithdrawMessage(params: {
  tableId: string;
  stackMojos: string;
  address: string;
}): string {
  return `dat-poker:v1:withdraw:${params.tableId}:${params.stackMojos}:${params.address}`;
}

export interface BuyInProof {
  address: string;
  message: string;
  signature: string;
  pubkey: string;
  datBalanceMojos?: string;
}

export type WithdrawProof = BuyInProof;

export function validateBuyInProof(
  proof: BuyInProof,
  params: { tableId: string; seatIndex: number; buyInMojos: string; playerId: string },
): string | null {
  if (proof.address !== params.playerId) {
    return "Buy-in address must match playerId";
  }
  const expected = buildBuyInMessage({
    tableId: params.tableId,
    seatIndex: params.seatIndex,
    buyInMojos: params.buyInMojos,
    address: proof.address,
  });
  if (proof.message !== expected) {
    return "Invalid buy-in message";
  }
  if (!proof.signature || !proof.pubkey) {
    if (proof.datBalanceMojos && BigInt(proof.datBalanceMojos) >= BigInt(params.buyInMojos)) {
      return null;
    }
    return "Buy-in signature required (approve in Sage) or provide balance attestation";
  }
  if (params.playerId !== proof.address) {
    return "Player id must be wallet address";
  }
  return null;
}

export function validateWithdrawProof(
  proof: WithdrawProof,
  params: { tableId: string; stackMojos: string; playerId: string },
): string | null {
  if (proof.address !== params.playerId) {
    return "Withdraw address must match playerId";
  }
  const expected = buildWithdrawMessage({
    tableId: params.tableId,
    stackMojos: params.stackMojos,
    address: proof.address,
  });
  if (proof.message !== expected) {
    return "Invalid withdraw message";
  }
  if (!proof.signature || !proof.pubkey) {
    return "Withdraw signature required (approve in Sage)";
  }
  if (params.playerId !== proof.address) {
    return "Player id must be wallet address";
  }
  return null;
}
