import { isRedSuit, playingCardLabel, rankFace, suitGlyph, type PlayingCardData } from "../playing-card.js";

export function PlayingCard({
  card,
  size = "md",
}: {
  card: PlayingCardData;
  size?: "sm" | "md" | "lg";
}) {
  const red = isRedSuit(card.suit);
  return (
    <span
      className={`playing-card playing-card-${size} ${red ? "playing-card-red" : "playing-card-black"}`}
      aria-label={playingCardLabel(card)}
    >
      <span className="playing-card-corner" aria-hidden="true">
        <span className="playing-card-rank">{rankFace(card.rank)}</span>
        <span className="playing-card-mini-suit">{suitGlyph(card.suit)}</span>
      </span>
      <span className="playing-card-center" aria-hidden="true">
        {suitGlyph(card.suit)}
      </span>
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
