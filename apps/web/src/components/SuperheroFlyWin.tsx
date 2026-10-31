import { useEffect, useRef } from "react";

export function SuperheroFlyWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 6400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="superhero-win"
      role="img"
      aria-label="A superhero in a cape flies across the screen to celebrate your big win"
    >
      <div className="superhero-win-scrim" aria-hidden="true" />
      <div className="superhero-win-sky" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="superhero-win-streak" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div className="superhero-win-hero-wrap">
        <span className="superhero-win-trail" aria-hidden="true" />
        <SuperheroSvg />
      </div>
      <div className="superhero-win-sign" role="status">
        Heroic win!
      </div>
    </div>
  );
}

function SuperheroSvg() {
  return (
    <svg className="superhero-win-svg" viewBox="0 0 200 160" aria-hidden="true">
      <defs>
        <linearGradient id="superhero-cape" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff6b6b" />
          <stop offset="100%" stopColor="#c0392b" />
        </linearGradient>
        <linearGradient id="superhero-suit" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#5dade2" />
          <stop offset="100%" stopColor="#2471a3" />
        </linearGradient>
        <filter id="superhero-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#fff" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>
      <g filter="url(#superhero-glow)">
      <path
        className="superhero-win-cape"
        d="M118 52 C140 68 168 88 188 120 C160 108 132 98 108 92 C112 78 114 64 118 52 Z"
        fill="url(#superhero-cape)"
        stroke="#fff"
        strokeWidth="3"
      />
      <path
        className="superhero-win-cape-back"
        d="M92 48 C72 72 58 98 48 132 C78 118 98 102 108 88 C102 74 96 60 92 48 Z"
        fill="#c0392b"
        opacity="0.85"
      />
      <ellipse cx="100" cy="88" rx="28" ry="34" fill="url(#superhero-suit)" stroke="#fff" strokeWidth="2.5" />
      <path d="M72 88 C68 108 66 128 70 142 L130 142 C134 128 132 108 128 88 Z" fill="url(#superhero-suit)" stroke="#fff" strokeWidth="2.5" />
      <path d="M58 78 L42 62 L52 54 L68 72 Z" fill="#f1c27d" />
      <path d="M142 78 L158 62 L148 54 L132 72 Z" fill="#f1c27d" />
      <circle cx="100" cy="52" r="22" fill="#f1c27d" />
      <path d="M78 44 L100 28 L122 44 L118 52 L82 52 Z" fill="#c0392b" />
      <path d="M88 38 L100 32 L112 38 L100 46 Z" fill="#f4d03f" />
      <rect x="92" y="48" width="16" height="6" rx="2" fill="#1a1a1a" opacity="0.7" />
      <circle cx="92" cy="50" r="3" fill="#1a1a1a" />
      <circle cx="108" cy="50" r="3" fill="#1a1a1a" />
      <path d="M94 58 Q100 62 106 58" fill="none" stroke="#3d2b1f" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M128 76 L168 58 L176 66 L136 88 Z"
        fill="#f1c27d"
        stroke="#c0392b"
        strokeWidth="2"
      />
      <ellipse cx="100" cy="98" rx="10" ry="12" fill="#f4d03f" />
      <path d="M88 108 H112 V118 H88 Z" fill="#1a5276" />
      </g>
    </svg>
  );
}
