import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCoinsetNftMeta, type CoinsetNftMeta } from "./coinset-nft-meta.js";
import { requestTreasuryNftOffer } from "./treasury-payout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_NFT_ID = "nft1mkl29gyx5z695mgkcmksezphpsnp70drl4dvpajh44z9kap4tgpqjt837h";

export interface Mtt16NftChallengeConfig {
  enabled: boolean;
  nftId: string;
  winsRequired: number;
  treasuryNftPayoutUrl: string | null;
}

interface StoredChallenge {
  winsByPlayer: Record<string, number>;
  winnerPlayerId: string | null;
  winnerAddress: string | null;
  offer: string | null;
  offerFeeMojos: string | null;
  awardedAt: string | null;
  offerError: string | null;
}

let state: StoredChallenge = {
  winsByPlayer: {},
  winnerPlayerId: null,
  winnerAddress: null,
  offer: null,
  offerFeeMojos: null,
  awardedAt: null,
  offerError: null,
};
let loaded = false;

let cachedMeta: { fetchedAt: number; meta: CoinsetNftMeta | null } | null = null;
const META_TTL_MS = 60 * 60 * 1000;

function storePath(): string | null {
  const raw = process.env.DAT_MTT16_NFT_CHALLENGE_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(__dirname, "../../../data/mtt16-nft-challenge.json");
}

function persist(): void {
  const path = storePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function loadMtt16NftChallengeStore(): void {
  if (loaded) return;
  loaded = true;
  const path = storePath();
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredChallenge>;
    state = {
      winsByPlayer: parsed.winsByPlayer ?? {},
      winnerPlayerId: parsed.winnerPlayerId ?? null,
      winnerAddress: parsed.winnerAddress ?? null,
      offer: parsed.offer ?? null,
      offerFeeMojos: parsed.offerFeeMojos ?? null,
      awardedAt: parsed.awardedAt ?? null,
      offerError: parsed.offerError ?? null,
    };
  } catch {
    /* fresh */
  }
}

export function resetMtt16NftChallengeForTests(): void {
  state = {
    winsByPlayer: {},
    winnerPlayerId: null,
    winnerAddress: null,
    offer: null,
    offerFeeMojos: null,
    awardedAt: null,
    offerError: null,
  };
  cachedMeta = null;
  loaded = true;
}

export function readMtt16NftChallengeConfig(): Mtt16NftChallengeConfig {
  const nftId = process.env.DAT_MTT16_NFT_REWARD_ID?.trim() || DEFAULT_NFT_ID;
  const winsRaw = Number(process.env.DAT_MTT16_NFT_WINS_REQUIRED ?? "5");
  const winsRequired = Number.isFinite(winsRaw) && winsRaw > 0 ? Math.floor(winsRaw) : 5;
  const disabled = process.env.DAT_MTT16_NFT_CHALLENGE_ENABLED === "false";
  const treasuryNftPayoutUrl = resolveTreasuryNftPayoutUrl();
  return {
    enabled: !disabled && Boolean(nftId),
    nftId,
    winsRequired,
    treasuryNftPayoutUrl,
  };
}

function resolveTreasuryNftPayoutUrl(): string | null {
  const explicit = process.env.DAT_TREASURY_NFT_PAYOUT_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.DAT_TREASURY_PAYOUT_URL?.trim();
  if (!base) return null;
  if (base.includes("/nft-payout")) return base;
  return base.replace(/\/payout\/?$/, "/nft-payout");
}

export async function getMtt16NftPromoMeta(): Promise<CoinsetNftMeta | null> {
  const cfg = readMtt16NftChallengeConfig();
  if (!cfg.enabled) return null;
  const now = Date.now();
  if (cachedMeta && now - cachedMeta.fetchedAt < META_TTL_MS) {
    return cachedMeta.meta;
  }
  const meta = await fetchCoinsetNftMeta(cfg.nftId);
  cachedMeta = { fetchedAt: now, meta };
  return meta;
}

function leaderBoard(): { playerId: string; wins: number }[] {
  return Object.entries(state.winsByPlayer)
    .map(([playerId, wins]) => ({ playerId, wins }))
    .filter((row) => row.wins > 0)
    .sort((a, b) => b.wins - a.wins || a.playerId.localeCompare(b.playerId));
}

export function mtt16NftChallengePublicView(viewerPlayerId?: string | null): {
  enabled: boolean;
  nftId: string;
  winsRequired: number;
  description: string | null;
  edition: string | null;
  imageUrl: string | null;
  winnerPlayerId: string | null;
  awarded: boolean;
  yourWins: number;
  winsToGo: number;
  leader: { playerId: string; wins: number } | null;
} {
  loadMtt16NftChallengeStore();
  const cfg = readMtt16NftChallengeConfig();
  const meta = cachedMeta?.meta;
  const yourWins = viewerPlayerId ? (state.winsByPlayer[viewerPlayerId] ?? 0) : 0;
  const leaders = leaderBoard();
  return {
    enabled: cfg.enabled,
    nftId: cfg.nftId,
    winsRequired: cfg.winsRequired,
    description: meta?.description ?? null,
    edition: meta?.edition ?? null,
    /** Same-origin proxy so HTTPS CSP (img-src 'self') can load the Coinset PNG. */
    imageUrl: meta?.imageUrl ? "/v1/lobby/mtt16-nft-image" : null,
    winnerPlayerId: state.winnerPlayerId,
    awarded: Boolean(state.winnerPlayerId),
    yourWins,
    winsToGo: cfg.enabled ? Math.max(0, cfg.winsRequired - yourWins) : 0,
    leader: leaders[0] ?? null,
  };
}

export function mtt16NftRewardForPlayer(playerId: string): {
  eligible: boolean;
  wins: number;
  winsRequired: number;
  offer: string | null;
  feeMojos: string | null;
  offerError: string | null;
  awardedAt: string | null;
} {
  loadMtt16NftChallengeStore();
  const cfg = readMtt16NftChallengeConfig();
  const wins = state.winsByPlayer[playerId] ?? 0;
  const isWinner = state.winnerPlayerId === playerId;
  return {
    eligible: isWinner,
    wins,
    winsRequired: cfg.winsRequired,
    offer: isWinner ? state.offer : null,
    feeMojos: isWinner ? state.offerFeeMojos : null,
    offerError: isWinner ? state.offerError : null,
    awardedAt: isWinner ? state.awardedAt : null,
  };
}

/** Record a 16-player SNG win (1st place). Returns true if this call claimed the NFT challenge. */
export function recordMtt16FirstPlaceWin(playerId: string, payoutAddress: string): boolean {
  loadMtt16NftChallengeStore();
  const cfg = readMtt16NftChallengeConfig();
  if (!cfg.enabled) return false;
  if (state.winnerPlayerId) return false;

  const next = (state.winsByPlayer[playerId] ?? 0) + 1;
  state.winsByPlayer[playerId] = next;
  persist();

  if (next < cfg.winsRequired) return false;

  state.winnerPlayerId = playerId;
  state.winnerAddress = payoutAddress.trim() || playerId;
  state.awardedAt = new Date().toISOString();
  persist();

  void queueNftOffer(cfg, state.winnerAddress);
  return true;
}

async function queueNftOffer(cfg: Mtt16NftChallengeConfig, address: string): Promise<void> {
  if (!cfg.treasuryNftPayoutUrl) {
    state.offerError = "Treasury NFT payout URL not configured (DAT_TREASURY_NFT_PAYOUT_URL)";
    persist();
    return;
  }
  try {
    const result = await requestTreasuryNftOffer({
      nftId: cfg.nftId,
      recipientAddress: address,
      treasuryNftPayoutUrl: cfg.treasuryNftPayoutUrl,
    });
    if (result?.offer) {
      state.offer = result.offer;
      state.offerFeeMojos = result.feeMojos ?? null;
      state.offerError = null;
    } else {
      state.offerError = "Treasury returned no NFT offer";
    }
  } catch (e) {
    state.offerError = (e as Error).message;
  }
  persist();
}

/** Test hook: await pending treasury offer creation. */
export async function flushMtt16NftOfferForTests(): Promise<void> {
  const cfg = readMtt16NftChallengeConfig();
  if (!state.winnerAddress || state.offer || !cfg.treasuryNftPayoutUrl) return;
  await queueNftOffer(cfg, state.winnerAddress);
}
