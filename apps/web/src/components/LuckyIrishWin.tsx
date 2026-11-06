import { useEffect, useRef, type CSSProperties } from "react";

const COINS = [
  { dx: -18, dy: 64, delay: "0s", dur: "0.9s" },
  { dx: 8, dy: 72, delay: "0.08s", dur: "1s" },
  { dx: -36, dy: 58, delay: "0.16s", dur: "0.85s" },
  { dx: 22, dy: 80, delay: "0.22s", dur: "1.1s" },
  { dx: -8, dy: 90, delay: "0.3s", dur: "0.95s" },
  { dx: 40, dy: 66, delay: "0.38s", dur: "1.05s" },
  { dx: -48, dy: 78, delay: "0.45s", dur: "0.9s" },
  { dx: 14, dy: 96, delay: "0.52s", dur: "1.15s" },
  { dx: -28, dy: 88, delay: "0.6s", dur: "1s" },
  { dx: 32, dy: 54, delay: "0.68s", dur: "0.88s" },
  { dx: -4, dy: 70, delay: "0.76s", dur: "1.08s" },
  { dx: 48, dy: 84, delay: "0.84s", dur: "0.92s" },
];

export function LuckyIrishWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 4200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="lucky-irish"
      role="img"
      aria-label="A lucky Irish man runs across the screen spilling a pot of gold"
    >
      <div className="lucky-irish-rainbow" />
      <div className="lucky-irish-runner">
        <LeprechaunSvg />
        <div className="lucky-irish-spill">
          {COINS.map((coin, i) => (
            <span
              key={i}
              className="lucky-coin"
              style={
                {
                  "--dx": `${coin.dx}px`,
                  "--dy": `${coin.dy}px`,
                  animationDelay: coin.delay,
                  animationDuration: coin.dur,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LeprechaunSvg() {
  return (
    <svg className="lucky-irish-svg" viewBox="0 0 160 180" aria-hidden="true">
      <ellipse cx="78" cy="168" rx="42" ry="8" fill="rgba(0,0,0,0.35)" />
      <g className="lucky-irish-legs">
        <path d="M70 118 L58 158 L72 158 L80 122 Z" fill="#1a1a1a" />
        <path className="lucky-irish-stride" d="M88 118 L118 148 L128 140 L98 114 Z" fill="#1a1a1a" />
        <rect x="52" y="154" width="22" height="10" rx="3" fill="#3d2b1f" />
        <rect x="118" y="136" width="18" height="10" rx="3" fill="#3d2b1f" transform="rotate(28 127 141)" />
      </g>
      <path d="M58 72 C50 78 48 108 56 122 L104 122 C114 104 112 76 102 70 Z" fill="#1f8a4c" />
      <path d="M62 96 H100 V108 H62 Z" fill="#c9a227" />
      <circle cx="81" cy="102" r="5" fill="#f4e27a" stroke="#6b4f12" strokeWidth="1.2" />
      <path d="M48 86 C40 92 36 108 44 118 L58 112 L62 90 Z" fill="#157a42" />
      <g className="lucky-irish-pot-arm">
        <path d="M100 88 C118 84 128 96 124 112" fill="none" stroke="#f1c27d" strokeWidth="8" strokeLinecap="round" />
        <ellipse cx="128" cy="128" rx="22" ry="10" fill="#2b2b2b" />
        <path d="M108 118 C108 108 148 108 148 118 L144 136 C144 146 112 146 108 136 Z" fill="#2b2b2b" />
        <ellipse cx="128" cy="118" rx="20" ry="7" fill="#c9a227" />
        <circle cx="120" cy="116" r="3.2" fill="#ffe566" />
        <circle cx="128" cy="114" r="3.5" fill="#ffd24a" />
        <circle cx="136" cy="117" r="3" fill="#ffe566" />
      </g>
      <circle cx="80" cy="52" r="22" fill="#f1c27d" />
      <path d="M62 58 Q80 78 100 60 Q92 86 80 88 Q66 84 62 58 Z" fill="#e07a1f" />
      <path d="M68 54 Q80 62 92 54" fill="none" stroke="#3d2b1f" strokeWidth="2" strokeLinecap="round" />
      <circle cx="72" cy="48" r="3" fill="#1a1a1a" />
      <circle cx="90" cy="48" r="3" fill="#1a1a1a" />
      <path d="M48 40 L80 8 L112 40 Z" fill="#1f8a4c" />
      <rect x="44" y="36" width="72" height="10" rx="3" fill="#157a42" />
      <rect x="58" y="34" width="44" height="6" fill="#c9a227" />
      <circle cx="80" cy="18" r="5" fill="#c9a227" />
    </svg>
  );
}
