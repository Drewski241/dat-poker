import { walletRpcRequest, type ChiaWalletRpcConfig, type CreateOfferForIdsResponse } from "./chia-wallet-rpc.js";

export interface CatPayoutOfferParams {
  assetId: string;
  amountMojos: bigint;
  feeMojos?: bigint;
}

export function buildCatGiftOfferRequest(params: CatPayoutOfferParams): Record<string, unknown> {
  const assetKey = params.assetId.replace(/^0x/, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(assetKey)) {
    throw new Error("Invalid CAT asset id (expected 64 hex chars)");
  }
  if (params.amountMojos <= 0n) {
    throw new Error("Payout amount must be positive");
  }
  const amount = Number(params.amountMojos);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Payout amount too large for wallet RPC");
  }

  return {
    offer: {
      [assetKey]: -amount,
    },
    fee: Number(params.feeMojos ?? 0n),
    validate_only: false,
  };
}

export async function createCatPayoutOffer(
  rpc: ChiaWalletRpcConfig,
  params: CatPayoutOfferParams,
): Promise<string> {
  const request = buildCatGiftOfferRequest(params);
  const response = await walletRpcRequest<CreateOfferForIdsResponse>(
    rpc,
    "create_offer_for_ids",
    request,
  );
  const offer = response.offer?.trim();
  if (!offer) {
    throw new Error("Treasury wallet did not return an offer");
  }
  return offer;
}
