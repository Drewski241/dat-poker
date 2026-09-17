import { useEffect, useRef, type CSSProperties } from "react";

const CHIPS = Array.from({ length: 24 }, (_, i) => ({
  dx: (i % 2 === 0 ? 1 : -1) * (20 + (i % 8) * 14),
  dy: 60 + (i % 6) * 28,
  rot: i * 37,
  delay: `${0.85 + (i % 12) * 0.05}s`,
  hue: i % 3 === 0 ? "#c41e3a" : i % 3 === 1 ? "#ffd24a" : "#3498db",
}));

export function PinataChipWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin pinata-win" role="img" aria-label="A pinata breaks and poker chips rain down for your big win">
      <div className="bigwin-scrim" aria-hidden="true" />
      <div className="pinata-win-string" aria-hidden="true" />
      <div className="pinata-win-body">
        <svg className="pinata-win-svg" viewBox="0 0 140 160" aria-hidden="true">
          <path
            className="pinata-win-shape"
            d="M70 20 L110 48 L100 130 L40 130 L30 48 Z"
            fill="#e74c3c"
            stroke="#c0392b"
            strokeWidth="4"
          />
          <path d="M70 20 L70 8" stroke="#6b4f12" strokeWidth="4" />
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} cx={45 + i * 12} cy={70 + (i % 2) * 20} r="6" fill="#f4d03f" />
          ))}
        </svg>
      </div>
      <div className="pinata-win-confetti">
        {CHIPS.map((c, i) => (
          <span
            key={i}
            className="pinata-win-chip"
            style={
              {
                "--dx": `${c.dx}px`,
                "--dy": `${c.dy}px`,
                "--rot": `${c.rot}deg`,
                background: c.hue,
                animationDelay: c.delay,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="bigwin-sign pinata-win-sign" role="status">
        Chip shower!
      </div>
    </div>
  );
}
