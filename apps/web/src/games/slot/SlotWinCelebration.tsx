import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { formatDatMojos } from "@dat-poker/shared";
import type { SlotGameId } from "@dat-poker/shared";
import {
  CELEBRATION_VARIANTS,
  celebrationDurationMs,
  celebrationHeadline,
  GAME_CELEBRATION_EMOJIS,
  GAME_DISPLAY_NAME,
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
  const style = CELEBRATION_VARIANTS[variant % CELEBRATION_VARIANTS.length]!;
  const headline = celebrationHeadline(gameId, tier, variant);

  useEffect(() => {
    const ms = celebrationDurationMs(tier);
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [tier, onDone]);

  const sparkCount = tier === "jackpot" ? 36 : tier === "mega" ? 28 : 20;
  const floats = useMemo(
    () =>
      Array.from({ length: sparkCount }).map((_, i) => ({
        i,
        emoji: emojis[i % emojis.length]!,
      })),
    [emojis, sparkCount],
  );

  if (tier === "none") return null;

  return createPortal(
    <div
      className={`slot-win-overlay tier-${tier} game-${gameId} celeb-v${style.id}`}
      role="status"
      aria-live="polite"
      data-game={gameId}
      data-variant={style.id}
    >
      {style.rays && <div className="slot-win-rays" />}
      {style.aurora && <div className="slot-win-aurora" aria-hidden />}
      {style.sparks && (
        <div className="slot-win-sparks" aria-hidden>
          {floats.map(({ i, emoji }) => (
            <span key={i} className="spark emoji-spark" style={{ ["--i" as string]: i }}>
              {emoji}
            </span>
          ))}
        </div>
      )}
      {style.confetti && (
        <div className="slot-win-confetti" aria-hidden>
          {Array.from({ length: 28 }).map((_, i) => (
            <span key={i} className="confetti-piece" style={{ ["--i" as string]: i }} />
          ))}
        </div>
      )}
      <div className="slot-win-card">
        <p className="slot-win-kicker">{GAME_DISPLAY_NAME[gameId]}</p>
        <h2 className="slot-win-title">{headline}</h2>
        <p className="slot-win-amount">+{formatDatMojos(payoutMojos.toString(), ticker)}</p>
      </div>
    </div>,
    document.body,
  );
}
