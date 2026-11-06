import { useEffect, useRef } from "react";

export function ChampionshipBeltWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin belt-win" role="img" aria-label="A championship belt drops to celebrate your big win">
      <div className="bigwin-scrim" aria-hidden="true" />
      <div className="belt-win-drop">
        <svg className="belt-win-svg" viewBox="0 0 320 180" aria-hidden="true">
          <path d="M20 72 H300" stroke="#1a1a1a" strokeWidth="28" strokeLinecap="round" />
          <path d="M20 72 H300" stroke="#c0392b" strokeWidth="20" strokeLinecap="round" />
          <rect x="108" y="36" width="104" height="72" rx="8" fill="#ffd24a" stroke="#6b4f12" strokeWidth="4" />
          <text x="160" y="82" textAnchor="middle" fontSize="22" fontWeight="900" fill="#1a1208">
            CHAMP
          </text>
          <circle cx="48" cy="72" r="18" fill="#c9a227" stroke="#6b4f12" strokeWidth="3" />
          <circle cx="272" cy="72" r="18" fill="#c9a227" stroke="#6b4f12" strokeWidth="3" />
        </svg>
      </div>
      <div className="bigwin-sign belt-win-sign" role="status">
        You’re the champ!
      </div>
    </div>
  );
}
