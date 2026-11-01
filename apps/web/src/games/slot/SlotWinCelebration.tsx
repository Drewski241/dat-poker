import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { formatDatMojos } from "@dat-poker/shared";
import type { SlotGameId } from "@dat-poker/shared";
import {
  celebrationDurationMs,
  GAME_CELEBRATION_EMOJIS,
  GAME_DISPLAY_NAME,
  tierLabel,
  type WinTier,
} from "./win-celebration.js";

export function SlotWinCelebration({
  gameId,
  tier,
  variant,
  payoutMojos,
  ticker = "DAT",
  onDone,
}: {
  gameId: SlotGameId;
  tier: WinTier;
  variant: number;
  payoutMojos: bigint;
  ticker?: string;
  onDone: () => void;
}) {
  const emojis = GAME_CELEBRATION_EMOJIS[gameId];
  const v = variant % 5;

  useEffect(() => {
    const ms = celebrationDurationMs(tier);
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [tier, onDone]);

  const floats = useMemo(
    () =>
      Array.from({ length: tier === "jackpot" ? 40 : tier === "mega" ? 32 : 24 }).map((_, i) => ({
        i,
        emoji: emojis[i % emojis.length]!,
      })),
    [emojis, tier],
  );

  if (tier === "none") return null;

  return createPortal(
    <div
      className={`slot-win-overlay tier-${tier} game-${gameId} celeb-v${v}`}
      role="status"
      aria-live="polite"
      data-game={gameId}
      data-variant={v}
    >
      <div className="slot-win-rays" />
      <div className="slot-win-aurora" aria-hidden />
      <div className="slot-win-sparks" aria-hidden>
        {floats.map(({ i, emoji }) => (
          <span key={i} className="spark emoji-spark" style={{ ["--i" as string]: i }}>
            {emoji}
          </span>
        ))}
      </div>
      <div className="slot-win-confetti" aria-hidden>
        {Array.from({ length: 20 }).map((_, i) => (
          <span key={i} className="confetti-piece" style={{ ["--i" as string]: i }} />
        ))}
      </div>
      <div className="slot-win-card">
        <p className="slot-win-kicker">{GAME_DISPLAY_NAME[gameId]}</p>
        <h2 className="slot-win-title">{tierLabel(tier)}</h2>
        <p className="slot-win-amount">+{formatDatMojos(payoutMojos.toString(), ticker)}</p>
        <p className="slot-win-variant-hint muted small" aria-hidden>
          {emojis.join(" ")}
        </p>
      </div>
    </div>,
    document.body,
  );
}
