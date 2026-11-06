import { useEffect, useRef } from "react";

export function UfoBeamWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin ufo-win" role="img" aria-label="A UFO beams up the pot for your big win">
      <div className="bigwin-scrim ufo-win-scrim" aria-hidden="true" />
      <div className="ufo-win-beam" aria-hidden="true" />
      <div className="ufo-win-pot">
        <svg viewBox="0 0 80 60" aria-hidden="true">
          <ellipse cx="40" cy="48" rx="32" ry="10" fill="#2b2b2b" />
          <path d="M12 28 C12 18 68 18 68 28 L64 44 C64 54 16 54 12 44 Z" fill="#2b2b2b" />
          <ellipse cx="40" cy="28" rx="28" ry="9" fill="#ffd24a" />
        </svg>
      </div>
      <div className="ufo-win-ship">
        <svg className="ufo-win-svg" viewBox="0 0 200 100" aria-hidden="true">
          <ellipse cx="100" cy="58" rx="78" ry="22" fill="#95a5a6" stroke="#ecf0f1" strokeWidth="3" />
          <ellipse cx="100" cy="48" rx="36" ry="20" fill="#5dade2" stroke="#fff" strokeWidth="2" opacity="0.9" />
          <circle cx="72" cy="58" r="6" fill="#f4d03f" />
          <circle cx="100" cy="62" r="6" fill="#f4d03f" />
          <circle cx="128" cy="58" r="6" fill="#f4d03f" />
        </svg>
      </div>
      <div className="bigwin-sign ufo-win-sign" role="status">
        Beam me the pot!
      </div>
    </div>
  );
}
