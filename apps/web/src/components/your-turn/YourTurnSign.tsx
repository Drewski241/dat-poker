export const YOUR_TURN_COPY = "It's your turn! No Rush!";

type Props = {
  tagline: string;
  secondsLeft?: number;
  signClassName?: string;
};

export function YourTurnSign({ tagline, secondsLeft, signClassName = "your-turn-sign" }: Props) {
  return (
    <p className={signClassName}>
      <strong>It&apos;s your turn!</strong>
      <span>
        {tagline}
        {secondsLeft != null && secondsLeft > 0 ? ` · ${secondsLeft}s left` : ""}
      </span>
    </p>
  );
}
