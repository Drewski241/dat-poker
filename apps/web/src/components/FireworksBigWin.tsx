import { useEffect, useRef, type CSSProperties } from "react";

const BURSTS = [
  { left: "18%", top: "22%", color: "#ff6b6b", delay: "0.2s" },
  { left: "72%", top: "18%", color: "#f4d03f", delay: "0.55s" },
  { left: "48%", top: "12%", color: "#5dade2", delay: "0.9s" },
  { left: "28%", top: "32%", color: "#bb8fce", delay: "1.25s" },
  { left: "62%", top: "28%", color: "#58d68d", delay: "1.6s" },
  { left: "42%", top: "24%", color: "#f39c12", delay: "2s" },
];

export function FireworksBigWin({ onFinished }: { onFinished?: () => void }) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const t = window.setTimeout(() => onFinishedRef.current?.(), 5800);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="bigwin fireworks-win" role="img" aria-label="Fireworks celebrate your big win">
      <div className="bigwin-scrim fireworks-win-scrim" aria-hidden="true" />
      {BURSTS.map((b, i) => (
        <div
          key={i}
          className="fireworks-burst"
          style={
            {
              left: b.left,
              top: b.top,
              "--burst-color": b.color,
              animationDelay: b.delay,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          {Array.from({ length: 12 }, (_, j) => (
            <span key={j} className="fireworks-spark" style={{ transform: `rotate(${j * 30}deg)` }} />
          ))}
        </div>
      ))}
      <div className="bigwin-sign fireworks-win-sign" role="status">
        Big win!
      </div>
    </div>
  );
}
