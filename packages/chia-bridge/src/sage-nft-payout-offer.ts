import {
  ensureSageTreasuryLoggedIn,
  treasuryWalletRpcRequest,
  type SageMakeOfferResponse,
  type TreasuryWalletRpcConfig,
} from "./sage-wallet-rpc.js";

export interface NftPayoutOfferParams {
  nftId: string;
  /** Player Sage / XCH address that should receive the NFT when they take the offer. */
  receiveAddress: string;
  feeMojos?: bigint;
}

const NFT_ID_RE = /^nft1[a-z0-9]+$/i;

export function buildSageNftGiftOfferRequest(params: NftPayoutOfferParams): Record<string, unknown> {
  const nftId = params.nftId.trim();
  if (!NFT_ID_RE.test(nftId)) {
    throw new Error("Invalid NFT id (expected nft1… bech32 id)");
  }
  const receiveAddress = params.receiveAddress.trim();
  if (!receiveAddress.startsWith("xch") || receiveAddress.length < 62) {
    throw new Error("Valid receive_address (xch1…) required for NFT gift offer");
  }
  const fee = Number(params.feeMojos ?? 0n);
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error("Invalid offer fee");
  }

  // Sage make_offer expects OfferAmount[] sequences (same shape as CAT gifts),
  // not the older { xch, cats, nfts } map.
  return {
    offered_assets: [{ asset_id: nftId, amount: 1 }],
    requested_assets: [],
    fee,
    expires_at_second: null,
    auto_import: false,
    receive_address: receiveAddress,
  };
}

export async function createSageNftPayoutOffer(
  rpc: TreasuryWalletRpcConfig,
  params: NftPayoutOfferParams,
): Promise<string> {
  await ensureSageTreasuryLoggedIn(rpc);
  const request = buildSageNftGiftOfferRequest(params);
  const response = await treasuryWalletRpcRequest<SageMakeOfferResponse>(rpc, "make_offer", request);
  const offer = response.offer?.trim();
  if (!offer) {
    throw new Error("Sage treasury wallet did not return an NFT offer");
  }
  return offer;
}
