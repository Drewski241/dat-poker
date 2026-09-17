/** Side-mounted “your turn” reminders (after 15s on the action clock). */
export type YourTurnCue =
  | "sloth"
  | "leprechaun"
  | "hunter"
  | "hero"
  | "paddle"
  | "floor"
  | "chips"
  | "terrier"
  | "owl";

export const YOUR_TURN_CUE_CYCLE: YourTurnCue[] = [
  "sloth",
  "leprechaun",
  "hunter",
  "hero",
  "paddle",
  "floor",
  "chips",
  "terrier",
  "owl",
];

export type YourTurnCueSide = "left" | "right" | "bottom-right";

const CUE_SIDE: Record<YourTurnCue, YourTurnCueSide> = {
  sloth: "right",
  leprechaun: "left",
  hunter: "right",
  hero: "left",
  paddle: "right",
  floor: "left",
  chips: "bottom-right",
  terrier: "right",
  owl: "left",
};

export function yourTurnCueSide(cue: YourTurnCue): YourTurnCueSide {
  return CUE_SIDE[cue];
}

const CUE_TAGLINE: Record<YourTurnCue, string> = {
  sloth: "No Rush!",
  leprechaun: "Don't leave the pot!",
  hunter: "Take the shot.",
  hero: "Hero needed.",
  paddle: "Action on you.",
  floor: "Floor says: act.",
  chips: "Your move.",
  terrier: "GO — ok, no rush.",
  owl: "Hoot — you're up.",
};

export function yourTurnCueTagline(cue: YourTurnCue): string {
  return CUE_TAGLINE[cue];
}

const STORAGE_KEY = "dat-poker:last-your-turn-cue";

export function readStoredYourTurnCue(): YourTurnCue | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    if (value && YOUR_TURN_CUE_CYCLE.includes(value as YourTurnCue)) {
      return value as YourTurnCue;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function storeYourTurnCue(cue: YourTurnCue): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cue);
  } catch {
    /* ignore */
  }
}

export function pickYourTurnCue(previous: YourTurnCue | null): YourTurnCue {
  const last = previous ?? readStoredYourTurnCue();
  const idx = last ? YOUR_TURN_CUE_CYCLE.indexOf(last) : -1;
  const next = YOUR_TURN_CUE_CYCLE[(idx + 1) % YOUR_TURN_CUE_CYCLE.length]!;
  storeYourTurnCue(next);
  return next;
}

const PREVIEW_ALIASES: Record<string, YourTurnCue> = {
  sloth: "sloth",
  leprechaun: "leprechaun",
  hunter: "hunter",
  hero: "hero",
  paddle: "paddle",
  floor: "floor",
  chips: "chips",
  terrier: "terrier",
  owl: "owl",
};

/** Preview a cue from `#sloth` or `#turn-<name>`. */
export function parseYourTurnCueHash(hash: string): YourTurnCue | null {
  const h = hash.replace(/^#/, "").replace(/\/$/, "");
  if (h === "sloth") return "sloth";
  if (h.startsWith("turn-")) {
    const name = h.slice("turn-".length);
    return PREVIEW_ALIASES[name] ?? null;
  }
  return null;
}

export const YOUR_TURN_HEADLINE = "It's your turn!";
