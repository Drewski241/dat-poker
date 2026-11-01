import type { SlotGameId } from "@dat-poker/shared";

export type WinTier = "none" | "win" | "big" | "mega" | "jackpot";

export const CELEBRATION_VARIANT_COUNT = 5;

export type CelebrationVariantDef = {
  id: number;
  /** Short headline shown on the card (per-game override optional). */
  defaultHeadline: string;
  sparks: boolean;
  rays: boolean;
  confetti: boolean;
  aurora: boolean;
};

/** Five distinct full-screen styles (only one uses confetti). */
export const CELEBRATION_VARIANTS: readonly CelebrationVariantDef[] = [
  {
    id: 0,
    defaultHeadline: "COIN SHOWER",
    sparks: true,
    rays: true,
    confetti: false,
    aurora: false,
  },
  {
    id: 1,
    defaultHeadline: "LIGHTNING PAY",
    sparks: false,
    rays: true,
    confetti: false,
    aurora: true,
  },
  {
    id: 2,
    defaultHeadline: "CONFETTI BONUS",
    sparks: false,
    rays: false,
    confetti: true,
    aurora: false,
  },
  {
    id: 3,
    defaultHeadline: "NEON JACKPOT",
    sparks: true,
    rays: false,
    confetti: false,
    aurora: true,
  },
  {
    id: 4,
    defaultHeadline: "SPIRIT SURGE",
    sparks: true,
    rays: true,
    confetti: false,
    aurora: true,
  },
] as const;

/** Per game × variant headlines (5 each). Falls back to tier label + defaultHeadline. */
export const GAME_VARIANT_HEADLINES: Record<SlotGameId, readonly string[]> = {
  spirit: ["Spirit Shine", "Lucky Burst", "Confetti Spirits", "Neon Sevens", "Aura Spin"],
  "mine-mojo": ["Gold Rush", "Blast Wave", "Confetti Cave", "Crystal Glow", "Mojo Surge"],
  "poker-hands": ["Royal Rush", "Card Flash", "Confetti Flop", "Neon River", "Table Surge"],
  "spirit-stampede": ["Bison Run", "Dust Storm", "Confetti Prairie", "Moon Glow", "Stampede Surge"],
  "house-edge": ["House Take", "Vault Flash", "Confetti Floor", "Neon Dealer", "Edge Surge"],
};

export function tierLabel(tier: WinTier): string {
  switch (tier) {
    case "jackpot":
      return "PROGRESSIVE JACKPOT!";
    case "mega":
      return "MEGA WIN!";
    case "big":
      return "BIG WIN!";
    case "win":
      return "WINNER!";
    default:
      return "";
  }
}

export function grossWinRatio(grossMojos: bigint, betMojos: bigint): number {
  if (betMojos <= 0n) return 0;
  return Number((grossMojos * 100n) / betMojos) / 100;
}

/**
 * Overlay tier from payout vs wager only (ignore server winTier — it sums line multipliers and fires too often).
 */
export function resolveWinTier(
  grossMojos: bigint,
  betMojos: bigint,
  wonProgressive: boolean,
  _serverTier?: string,
  _gameId?: SlotGameId,
): WinTier {
  if (wonProgressive) return "jackpot";
  if (grossMojos <= 0n) return "none";

  const ratio = grossWinRatio(grossMojos, betMojos);

  if (ratio >= 30) return "mega";
  if (ratio >= 15) return "big";
  return "none";
}

/** Full-screen celebration only for large hits (not every 3–5× spin). */
export function shouldShowCelebration(tier: WinTier, grossMojos: bigint, betMojos: bigint): boolean {
  if (tier === "jackpot" || tier === "mega") return true;
  if (tier === "big") return grossWinRatio(grossMojos, betMojos) >= 15;
  return false;
}

export function pickCelebrationVariant(_gameId: SlotGameId, _tier: WinTier): number {
  return Math.floor(Math.random() * CELEBRATION_VARIANT_COUNT);
}

export function celebrationHeadline(
  gameId: SlotGameId,
  tier: WinTier,
  variant: number,
): string {
  const v = variant % CELEBRATION_VARIANT_COUNT;
  const custom = GAME_VARIANT_HEADLINES[gameId][v];
  if (tier === "jackpot") return tierLabel(tier);
  if (tier === "mega") return `${custom} · MEGA`;
  if (tier === "big") return `${custom} · BIG`;
  return custom ?? tierLabel(tier);
}

export function celebrationDurationMs(tier: WinTier): number {
  switch (tier) {
    case "jackpot":
      return 7000;
    case "mega":
      return 5500;
    case "big":
      return 4200;
    default:
      return 0;
  }
}

export const GAME_CELEBRATION_EMOJIS: Record<SlotGameId, readonly string[]> = {
  spirit: ["✨", "7️⃣", "🍒", "💎", "🎰"],
  "mine-mojo": ["⛏️", "💎", "🧨", "🪨", "🛤️"],
  "poker-hands": ["🂡", "♠️", "♥️", "🃏", "👑"],
  "spirit-stampede": ["🦬", "🌪️", "🌵", "🦅", "🌙"],
  "house-edge": ["🎩", "🎲", "🃏", "🏦", "🎰"],
};

export const GAME_DISPLAY_NAME: Record<SlotGameId, string> = {
  spirit: "Spirit Slots",
  "mine-mojo": "Mine the Mojo",
  "poker-hands": "Poker Hand Reels",
  "spirit-stampede": "Spirit Stampede",
  "house-edge": "The House Edge",
};
