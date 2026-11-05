import { useEffect, useRef } from "react";

export function TerrierVictoryLapWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin terrier-lap-win" role="img" aria-label="A terrier runs a victory lap for your big win">
      <div className="bigwin-scrim" aria-hidden="true" />
      <div className="terrier-lap-track" aria-hidden="true" />
      <div className="terrier-lap-runner">
        <TerrierSvg />
      </div>
      <div className="bigwin-sign terrier-lap-sign" role="status">
        Victory lap!
      </div>
    </div>
  );
}

function TerrierSvg() {
  return (
    <svg className="terrier-lap-svg" viewBox="0 0 200 160" aria-hidden="true">
      <ellipse cx="100" cy="148" rx="48" ry="8" fill="rgba(0,0,0,0.3)" />
      <g className="terrier-lap-legs">
        <path d="M72 108 L58 142 L70 144 L78 112 Z" fill="#c4956a" />
        <path className="terrier-lap-stride" d="M118 108 L138 138 L152 130 L128 106 Z" fill="#c4956a" />
      </g>
      <ellipse cx="100" cy="118" rx="44" ry="32" fill="#d4a574" />
      <circle cx="100" cy="72" r="34" fill="#d4a574" />
      <ellipse cx="72" cy="62" rx="14" ry="22" fill="#c4956a" />
      <ellipse cx="128" cy="62" rx="14" ry="22" fill="#c4956a" />
      <rect x="72" y="36" width="56" height="14" rx="4" fill="#fff" stroke="#3498db" strokeWidth="2" />
      <text x="100" y="47" textAnchor="middle" fontSize="9" fontWeight="800" fill="#3498db">
        WINNER
      </text>
      <circle cx="88" cy="74" r="5" fill="#1a1a1a" />
      <circle cx="112" cy="74" r="5" fill="#1a1a1a" />
      <path d="M90 88 Q100 98 110 88" fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M128 78 L168 68" stroke="#f4d03f" strokeWidth="5" strokeLinecap="round" className="terrier-lap-flag" />
    </svg>
  );
}
