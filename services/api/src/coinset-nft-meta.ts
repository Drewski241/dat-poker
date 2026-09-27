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
  const description = md.match(/^\-\s+\*\*Description:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;
  const edition = md.match(/^\-\s+\*\*Edition:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;
  const mediaPath = md.match(/^\-\s+\*\*Media URL:\*\*\s*(.+)$/m)?.[1]?.trim();
  const imageUrl = mediaPath
    ? mediaPath.startsWith("http")
      ? mediaPath
      : `${coinsetBase()}${mediaPath.startsWith("/") ? mediaPath : `/${mediaPath}`}`
    : null;
  return { nftId: id, description, edition, imageUrl };
}
