import { useEffect, useRef } from "react";

export function SlothChampagneWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin sloth-champagne-win" role="img" aria-label="A sloth pops champagne to celebrate your big win">
      <div className="bigwin-scrim" aria-hidden="true" />
      <div className="sloth-champagne-stage">
        <svg className="sloth-champagne-svg" viewBox="0 0 240 280" aria-hidden="true">
          <ellipse cx="120" cy="268" rx="56" ry="8" fill="rgba(0,0,0,0.35)" />
          <g className="sloth-champagne-sloth">
            <ellipse cx="120" cy="168" rx="58" ry="72" fill="#8b5e3c" />
            <circle cx="120" cy="98" r="42" fill="#8b5e3c" />
            <ellipse cx="120" cy="108" rx="34" ry="28" fill="#e8d5b7" />
            <circle cx="102" cy="104" r="5" fill="#1a1208" />
            <circle cx="138" cy="104" r="5" fill="#1a1208" />
            <path d="M108 118 Q120 128 132 118" fill="none" stroke="#1a1208" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <g className="sloth-champagne-bottle">
            <rect x="168" y="120" width="28" height="88" rx="6" fill="#1a5276" stroke="#fff" strokeWidth="2" />
            <rect x="174" y="108" width="16" height="16" rx="3" fill="#6b4f12" />
            <circle className="sloth-champagne-cork" cx="182" cy="104" r="10" fill="#c9a227" stroke="#6b4f12" strokeWidth="2" />
          </g>
        </svg>
        <div className="sloth-champagne-bubbles" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} className="sloth-champagne-bubble" style={{ animationDelay: `${1.2 + i * 0.12}s` }} />
          ))}
        </div>
      </div>
      <div className="bigwin-sign sloth-champagne-sign" role="status">
        Slow celebration!
      </div>
    </div>
  );
}
