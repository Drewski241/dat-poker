import { cardFace, isRedSuit, playingCardLabel, rankFace, suitMark, type PlayingCardData } from "../playing-card.js";

export function PlayingCard({
  card,
  size = "md",
}: {
  card: PlayingCardData;
  size?: "sm" | "md" | "lg";
}) {
  const red = isRedSuit(card.suit);
  const face = cardFace(card.rank);
  const mark = suitMark(card.suit);
  const rank = rankFace(card.rank);
  return (
    <span
      className={`playing-card playing-card-${size} ${red ? "playing-card-red" : "playing-card-black"} ${face.kind === "court" ? "playing-card-court" : ""}`}
      aria-label={playingCardLabel(card)}
    >
      <span className="playing-card-corner" aria-hidden="true">
        <span className="playing-card-rank">{rank}</span>
        <span className="playing-card-mini-suit">{mark}</span>
      </span>
      <span className="playing-card-corner playing-card-corner-br" aria-hidden="true">
        <span className="playing-card-rank">{rank}</span>
        <span className="playing-card-mini-suit">{mark}</span>
      </span>
      {face.kind === "ace" ? (
        <span className="ace-pip" aria-hidden="true">
          {mark}
        </span>
      ) : face.kind === "court" ? (
        <span className="court" aria-hidden="true">
          <span className="court-letter">{rank}</span>
          <span className="court-suit">{mark}</span>
          <span className="court-letter court-flip">{rank}</span>
        </span>
      ) : (
        <span className={`playing-card-pips pips-n${face.pips.length}`} aria-hidden="true">
          {face.pips.map((spot, index) => (
            <span
              key={index}
              className={spot.flip ? "pip flip" : "pip"}
              style={{ ["--x" as string]: `${spot.x}%`, ["--y" as string]: `${spot.y}%` }}
            >
              {mark}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function CardRow({
  cards,
  size = "md",
  label,
}: {
  cards: PlayingCardData[];
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  if (cards.length === 0) return null;
  return (
    <div className={`card-row card-row-${size}`}>
      {label ? <span className="card-row-label">{label}</span> : null}
      <span className="card-row-faces">
        {cards.map((card, i) => (
          <PlayingCard key={`${card.rank}${card.suit}-${i}`} card={card} size={size} />
        ))}
      </span>
    </div>
  );
}
