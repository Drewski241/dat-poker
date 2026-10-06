const DEFAULT_COINSET = "https://coinset.org";
const MINTGARDEN_NFT_API = "https://api.mintgarden.io/nfts";

export interface CoinsetNftMeta {
  nftId: string;
  description: string | null;
  edition: string | null;
  /** Upstream image URL (IPFS gateway or CDN) for the API proxy to fetch. */
  imageUrl: string | null;
}

function coinsetBase(): string {
  return (process.env.COINSET_URL?.trim() || DEFAULT_COINSET).replace(/\/$/, "");
}

interface CoinsetNftJson {
  data?: {
    description?: string | null;
    series_number?: number | null;
    series_total?: number | null;
  };
}

interface MintGardenNftJson {
  data?: {
    thumbnail_uri?: string | null;
    preview_uri?: string | null;
    data_uris?: string[] | null;
  };
}

export async function fetchMintGardenNftImage(nftId: string): Promise<string | null> {
  const res = await fetch(`${MINTGARDEN_NFT_API}/${encodeURIComponent(nftId)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as MintGardenNftJson;
  const data = body.data;
  if (!data) return null;
  const httpsUri = data.data_uris?.find((uri) => uri.startsWith("https://"));
  return data.thumbnail_uri ?? data.preview_uri ?? httpsUri ?? null;
}

async function fetchCoinsetNftJson(nftId: string): Promise<CoinsetNftJson | null> {
  const res = await fetch(`${coinsetBase()}/nft/${encodeURIComponent(nftId)}.json`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as CoinsetNftJson;
}

export async function fetchCoinsetNftMeta(nftId: string): Promise<CoinsetNftMeta | null> {
  const id = nftId.trim();
  if (!id.startsWith("nft1")) return null;

  const [jsonDoc, mintGardenImage] = await Promise.all([
    fetchCoinsetNftJson(id),
    fetchMintGardenNftImage(id),
  ]);

  if (jsonDoc?.data) {
    const seriesNumber = jsonDoc.data.series_number;
    const seriesTotal = jsonDoc.data.series_total;
    const edition =
      seriesNumber != null && seriesTotal != null ? `${seriesNumber} / ${seriesTotal}` : null;
    return {
      nftId: id,
      description: jsonDoc.data.description?.trim() || null,
      edition,
      imageUrl: mintGardenImage,
    };
  }

  const res = await fetch(`${coinsetBase()}/nft/${encodeURIComponent(id)}`, {
    headers: { accept: "text/markdown" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    return mintGardenImage
      ? { nftId: id, description: null, edition: null, imageUrl: mintGardenImage }
      : null;
  }
  const md = await res.text();
  const parsed = parseCoinsetNftMarkdown(id, md, coinsetBase());
  if (!parsed) return null;
  return {
    ...parsed,
    imageUrl: mintGardenImage ?? parsed.imageUrl,
  };
}

export function parseCoinsetNftMarkdown(
  nftId: string,
  md: string,
  baseUrl: string,
): CoinsetNftMeta | null {
  const description = md.match(/^\-\s+\*\*Description:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;
  const edition = md.match(/^\-\s+\*\*Edition:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;
  const mediaPath =
    md.match(/^\-\s+\*\*Media URL:\*\*\s*(.+)$/m)?.[1]?.trim() ??
    md.match(/\|\s*data\s*\|\s*image\/[^|]*\|\s*\[link\]\((\/content\/[^)]+)\)/)?.[1]?.trim();
  const base = baseUrl.replace(/\/$/, "");
  const imageUrl = mediaPath
    ? mediaPath.startsWith("http")
      ? mediaPath
      : `${base}${mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`}`
    : null;
  return { nftId, description, edition, imageUrl };
}
