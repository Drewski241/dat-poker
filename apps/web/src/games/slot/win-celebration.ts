import type { SlotGameId } from "@dat-poker/shared";

export type WinTier = "none" | "win" | "big" | "mega" | "jackpot";

export const CELEBRATION_VARIANT_COUNT = 5;

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

/** Blend server tier with payout vs wager so huge net wins (e.g. 243-ways) always celebrate. */
export function resolveWinTier(
  grossMojos: bigint,
  betMojos: bigint,
  wonProgressive: boolean,
  serverTier?: string,
): WinTier {
  if (wonProgressive || serverTier === "jackpot") return "jackpot";
  if (grossMojos <= 0n) return "none";

  const ratio = betMojos > 0n ? Number((grossMojos * 100n) / betMojos) / 100 : 0;

  if (ratio >= 15 || serverTier === "mega" || serverTier === "jackpot") return "mega";
  if (ratio >= 5 || serverTier === "big") return "big";
  if (ratio >= 1.5 || serverTier === "win") return "win";
  if (grossMojos > 0n) return "win";
  return "none";
}

export function shouldShowCelebration(tier: WinTier): boolean {
  return tier !== "none";
}

export function pickCelebrationVariant(gameId: SlotGameId, tier: WinTier): number {
  const base = Math.floor(Math.random() * CELEBRATION_VARIANT_COUNT);
  const gameSalt = gameId.length + gameId.charCodeAt(0);
  return (base + tier.charCodeAt(0) + gameSalt) % CELEBRATION_VARIANT_COUNT;
}

export function celebrationDurationMs(tier: WinTier): number {
  switch (tier) {
    case "jackpot":
      return 7000;
    case "mega":
      return 5200;
    case "big":
      return 4000;
    case "win":
      return 2600;
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
