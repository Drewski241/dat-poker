const DEFAULT_COINSET = "https://coinset.org";

export interface CoinsetNftMeta {
  nftId: string;
  description: string | null;
  edition: string | null;
  imageUrl: string | null;
}

function coinsetBase(): string {
  return (process.env.COINSET_URL?.trim() || DEFAULT_COINSET).replace(/\/$/, "");
}

export async function fetchCoinsetNftMeta(nftId: string): Promise<CoinsetNftMeta | null> {
  const id = nftId.trim();
  if (!id.startsWith("nft1")) return null;
  const res = await fetch(`${coinsetBase()}/nft/${encodeURIComponent(id)}`, {
    headers: { accept: "text/markdown" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const md = await res.text();
  return parseCoinsetNftMarkdown(id, md, coinsetBase());
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
