import type { CardFace } from "../api.js";

const SUIT: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function PlayingCard({
  card,
  faceDown = false,
  delayMs = 0,
}: {
  card?: CardFace;
  faceDown?: boolean;
  delayMs?: number;
}) {
  const style = { animationDelay: `${delayMs}ms` };
  if (faceDown || !card) {
    return <div className="pcard back" style={style} aria-hidden="true" />;
  }
  const red = card.suit === "h" || card.suit === "d";
  const suit = SUIT[card.suit] ?? card.suit;
  const rank = card.rank === "T" ? "10" : card.rank;
  return (
    <div className={`pcard ${red ? "red" : "black"}`} style={style} aria-label={`${rank}${suit}`}>
      <span className="pcard-rank">{rank}</span>
      <span className="pcard-suit">{suit}</span>
    </div>
  );
}
