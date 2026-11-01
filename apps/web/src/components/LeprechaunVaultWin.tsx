import { useEffect, useRef, type CSSProperties } from "react";

const COINS = Array.from({ length: 16 }, (_, i) => ({
  dx: (i % 5) * 18 - 36,
  dy: 40 + (i % 4) * 22,
  delay: `${1.1 + i * 0.06}s`,
}));

export function LeprechaunVaultWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin vault-win" role="img" aria-label="A leprechaun vault opens and gold spills for your big win">
      <div className="bigwin-scrim" aria-hidden="true" />
      <div className="vault-win-door-wrap">
        <div className="vault-win-door vault-win-door--left" />
        <div className="vault-win-door vault-win-door--right" />
        <div className="vault-win-glow" aria-hidden="true" />
        <div className="vault-win-spill">
          {COINS.map((c, i) => (
            <span
              key={i}
              className="vault-win-coin"
              style={
                {
                  "--dx": `${c.dx}px`,
                  "--dy": `${c.dy}px`,
                  animationDelay: c.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
      <svg className="vault-win-lep" viewBox="0 0 160 180" aria-hidden="true">
        <circle cx="80" cy="52" r="24" fill="#f1c27d" />
        <path d="M48 40 L80 8 L112 40 Z" fill="#1f8a4c" />
        <path d="M58 72 C50 78 48 108 56 122 L104 122 C114 104 112 76 102 70 Z" fill="#1f8a4c" />
        <rect x="62" y="96" width="36" height="8" fill="#c9a227" />
      </svg>
      <div className="bigwin-sign vault-win-sign" role="status">
        Vault opened!
      </div>
    </div>
  );
}
