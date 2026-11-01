import { PAYLINE_NAMES, PAYLINES } from "@dat-poker/slot-engine";

const COLS = 5;
const ROWS = 3;

function paylinePoints(pattern: number[]): string {
  return pattern
    .map((row, reel) => {
      const x = ((reel + 0.5) / COLS) * 100;
      const y = ((row + 0.5) / ROWS) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

export function SlotPaylineOverlay({
  showLines,
  winningLineIndices,
}: {
  showLines: boolean;
  winningLineIndices: ReadonlySet<number>;
}) {
  if (!showLines && winningLineIndices.size === 0) {
    return null;
  }

  const hasWin = winningLineIndices.size > 0;

  return (
    <svg
      className="slot-paylines-svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden={!showLines}
    >
      {PAYLINES.map((pattern, lineIndex) => {
        const isWin = winningLineIndices.has(lineIndex);
        if (!showLines && !isWin) return null;
        const dim = hasWin && !isWin;
        return (
          <polyline
            key={lineIndex}
            points={paylinePoints(pattern)}
            className={`slot-payline${isWin ? " win" : ""}${dim ? " dim" : ""}`}
          />
        );
      })}
    </svg>
  );
}

export function paylineDisplayName(lineIndex: number): string {
  return PAYLINE_NAMES[lineIndex] ?? `Line ${lineIndex + 1}`;
}
