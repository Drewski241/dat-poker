import { useEffect, useRef } from "react";

export function HunterBullseyeWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      className="hunter-win"
      role="img"
      aria-label="A hunter shoots a bullseye. The target falls, and a sign says You won bigtime!"
    >
      <div className="hunter-win-stage">
        <div className="hunter-win-hunter">
          <HunterSvg />
          <span className="hunter-win-muzzle" />
        </div>
        <span className="hunter-win-shot" />
        <div className="hunter-win-target-wrap">
          <div className="hunter-win-target">
            <BullseyeSvg />
          </div>
          <span className="hunter-win-post" />
        </div>
      </div>
      <div className="hunter-win-sign" role="status">
        You won bigtime!
      </div>
    </div>
  );
}

function HunterSvg() {
  return (
    <svg className="hunter-win-svg" viewBox="0 0 180 200" aria-hidden="true">
      <ellipse cx="78" cy="188" rx="40" ry="8" fill="rgba(0,0,0,0.35)" />
      <path d="M62 118 L54 172 L70 174 L78 120 Z" fill="#3d4a2e" />
      <path d="M86 118 L108 168 L124 164 L100 116 Z" fill="#3d4a2e" />
      <rect x="50" y="168" width="22" height="10" rx="3" fill="#3d2b1f" />
      <rect x="108" y="162" width="22" height="10" rx="3" fill="#3d2b1f" />
      <path d="M58 72 C50 80 50 112 60 122 L108 122 C118 108 116 78 104 70 Z" fill="#6b8f3a" />
      <path d="M64 92 H106 V108 H64 Z" fill="#c45c26" />
      <circle cx="85" cy="100" r="4" fill="#f4e27a" />
      <circle cx="78" cy="50" r="22" fill="#f1c27d" />
      <path d="M60 44 Q78 22 98 46 L96 58 Q78 48 62 56 Z" fill="#5c3d1e" />
      <path d="M58 48 Q78 38 100 50" fill="none" stroke="#3d2b1f" strokeWidth="6" strokeLinecap="round" />
      <circle cx="70" cy="48" r="3" fill="#1a1a1a" />
      <circle cx="88" cy="48" r="3" fill="#1a1a1a" />
      <path d="M70 58 Q78 64 88 58" fill="none" stroke="#3d2b1f" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 96 C128 90 148 94 170 92" fill="none" stroke="#2c2c2c" strokeWidth="7" strokeLinecap="round" />
      <path d="M96 102 L118 98 L122 108 L98 112 Z" fill="#6b4f2a" />
      <circle cx="170" cy="92" r="3.5" fill="#888" />
      <path d="M48 86 C40 94 38 112 50 118 L64 108 Z" fill="#4e6e2c" />
    </svg>
  );
}

function BullseyeSvg() {
  return (
    <svg className="hunter-win-bullseye" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="#f4efe3" stroke="#3d2b1f" strokeWidth="4" />
      <circle cx="60" cy="60" r="44" fill="#c41e3a" />
      <circle cx="60" cy="60" r="32" fill="#f4efe3" />
      <circle cx="60" cy="60" r="20" fill="#c41e3a" />
      <circle cx="60" cy="60" r="8" fill="#1a1a1a" />
    </svg>
  );
}
