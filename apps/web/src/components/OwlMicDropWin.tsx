import { useEffect, useRef } from "react";

export function OwlMicDropWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin owl-mic-win" role="img" aria-label="An owl drops the mic under a spotlight for your big win">
      <div className="bigwin-scrim owl-mic-scrim" aria-hidden="true" />
      <div className="owl-mic-spotlight" aria-hidden="true" />
      <div className="owl-mic-stage">
        <OwlSvg />
        <div className="owl-mic-drop" aria-hidden="true">
          <MicSvg />
        </div>
      </div>
      <div className="bigwin-sign owl-mic-sign" role="status">
        Mic drop!
      </div>
    </div>
  );
}

function OwlSvg() {
  return (
    <svg className="owl-mic-svg" viewBox="0 0 220 240" aria-hidden="true">
      <ellipse cx="110" cy="228" rx="52" ry="8" fill="rgba(0,0,0,0.35)" />
      <ellipse cx="110" cy="130" rx="62" ry="72" fill="#5d4e37" stroke="#fff" strokeWidth="3" />
      <circle cx="82" cy="112" r="26" fill="#f4efe3" stroke="#2c2c2c" strokeWidth="2.5" />
      <circle cx="138" cy="112" r="26" fill="#f4efe3" stroke="#2c2c2c" strokeWidth="2.5" />
      <circle cx="82" cy="114" r="10" fill="#1a1a1a" />
      <circle cx="138" cy="114" r="10" fill="#1a1a1a" />
      <path d="M110 128 L98 148 L122 148 Z" fill="#e67e22" />
      <path d="M36 108 Q110 52 184 108" fill="none" stroke="#5d4e37" strokeWidth="16" />
    </svg>
  );
}

function MicSvg() {
  return (
    <svg className="owl-mic-svg-mic" viewBox="0 0 80 120" aria-hidden="true">
      <rect x="28" y="8" width="24" height="48" rx="12" fill="#444" stroke="#ccc" strokeWidth="2" />
      <path d="M16 44 Q40 72 64 44" fill="none" stroke="#888" strokeWidth="4" />
      <rect x="36" y="56" width="8" height="36" fill="#666" />
      <ellipse cx="40" cy="98" rx="18" ry="6" fill="#333" />
    </svg>
  );
}
