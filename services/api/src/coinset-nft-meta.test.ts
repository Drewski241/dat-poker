import { describe, expect, it } from "vitest";
import { fetchMintGardenNftImage, parseCoinsetNftMarkdown } from "./coinset-nft-meta.js";

describe("parseCoinsetNftMarkdown", () => {
  it("reads description, edition, and media URL from Coinset markdown", () => {
    const md = `- **Description:** A cool NFT.
- **Edition:** 251 / 2000
- **Media URL:** /content/abc123`;
    const meta = parseCoinsetNftMarkdown("nft1test", md, "https://coinset.org");
    expect(meta?.description).toBe("A cool NFT.");
    expect(meta?.edition).toBe("251 / 2000");
    expect(meta?.imageUrl).toBe("https://coinset.org/content/abc123");
  });

  it("prefers MintGarden CDN over broken Coinset /content links", async () => {
    const nftId = "nft1mkl29gyx5z695mgkcmksezphpsnp70drl4dvpajh44z9kap4tgpqjt837h";
    const image = await fetchMintGardenNftImage(nftId);
    expect(image).toMatch(/^https:\/\//);
  });
});
