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
  return {
    assetId: assetId ?? null,
    ticker: process.env.DAT_GOVERNANCE_TOKEN_TICKER ?? "DAT",
    minBuyInMojos: process.env.DAT_MIN_BUY_IN_MOJOS ?? "1000000",
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

export interface BuyInProof {
  address: string;
  message: string;
  signature: string;
  pubkey: string;
  datBalanceMojos?: string;
}

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
    return "Buy-in signature required";
  }
  if (params.playerId !== proof.address) {
    return "Player id must be wallet address";
  }
  return null;
}
