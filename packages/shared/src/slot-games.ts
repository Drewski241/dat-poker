/** Identifiers for DAT slot machines (each has its own progressive jackpot). */
export const SLOT_GAME_IDS = [
  "spirit",
  "mine-mojo",
  "poker-hands",
  "spirit-stampede",
  "house-edge",
] as const;

export type SlotGameId = (typeof SLOT_GAME_IDS)[number];

export function isSlotGameId(raw: string): raw is SlotGameId {
  return (SLOT_GAME_IDS as readonly string[]).includes(raw);
}

export interface SlotGameMeta {
  id: SlotGameId;
  title: string;
  tagline: string;
  progressiveHint: string;
  emoji: string;
}

export const SLOT_GAMES: Record<SlotGameId, SlotGameMeta> = {
  spirit: {
    id: "spirit",
    title: "Spirit Slots",
    tagline: "Classic 9-line reels · wilds & scatters",
    progressiveHint: "5× Lucky 7 on the center payline",
    emoji: "✨",
  },
  "mine-mojo": {
    id: "mine-mojo",
    title: "Mine the Mojo",
    tagline: "Cascading gems · chain multipliers",
    progressiveHint: "5× Mother Lode on the center payline",
    emoji: "⛏️",
  },
  "poker-hands": {
    id: "poker-hands",
    title: "Poker Hand Reels",
    tagline: "Paylines pay poker hands · hold & draw",
    progressiveHint: "Royal flush on the center payline",
    emoji: "🂡",
  },
  "spirit-stampede": {
    id: "spirit-stampede",
    title: "Spirit Stampede",
    tagline: "243 ways · expanding wild respins",
    progressiveHint: "One wild on every reel in a single spin",
    emoji: "🦬",
  },
  "house-edge": {
    id: "house-edge",
    title: "The House Edge",
    tagline: "Boss fight · free-spin bonuses",
    progressiveHint: "5× The House on center line during boss bonus",
    emoji: "🎩",
  },
};
