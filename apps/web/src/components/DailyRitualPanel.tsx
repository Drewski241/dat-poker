import { formatDatMojos } from "@dat-poker/shared";

export type DailyRitualInfo = {
  freerollAvailable: boolean;
  freerollEnteredToday: boolean;
  streakDays: number;
  freerollWins: number;
  badge: string | null;
  redeemedToday: boolean;
  freeroll: {
    maxSeats: number;
    prizePoolMojos: string;
  };
};

type Props = {
  ritual: DailyRitualInfo | null;
  busy: boolean;
  buyInReady: boolean;
  ticker?: string;
  dailyRedeemMojos: string;
  onRedeem: () => void;
  onPlayFreeroll: () => void;
};

/** Redeem + once-a-day freeroll habit block for the signed-in lobby. */
export function DailyRitualPanel({
  ritual,
  busy,
  buyInReady,
  ticker,
  dailyRedeemMojos,
  onRedeem,
  onPlayFreeroll,
}: Props) {
  const prize = ritual?.freeroll.prizePoolMojos ?? "3000000";
  const seats = ritual?.freeroll.maxSeats ?? 6;
  const entered = Boolean(ritual?.freerollEnteredToday);
  const canFreeroll = Boolean(ritual?.freerollAvailable) && buyInReady;

  return (
    <section className="panel lobby-daily-ritual">
      <h2>Daily ritual</h2>
      <p className="muted small">
        Practice stakes · free 6-max freeroll once per UTC day. Prizes are DAT chips for more play —
        not cash value.
      </p>
      {ritual?.badge && <p className="lobby-ritual-badge">{ritual.badge}</p>}
      <p className="muted small lobby-ritual-stats">
        Streak <strong>{ritual?.streakDays ?? 0}</strong>
        {" · "}
        Freeroll wins <strong>{ritual?.freerollWins ?? 0}</strong>
        {" · "}
        Prize pool {formatDatMojos(prize, ticker)} · {seats}-max
      </p>
      <div className="lobby-ritual-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || !buyInReady || Boolean(ritual?.redeemedToday)}
          onClick={onRedeem}
        >
          {ritual?.redeemedToday
            ? "Redeem done today"
            : `Redeem ${formatDatMojos(dailyRedeemMojos, ticker)}`}
        </button>
        <button
          type="button"
          className="lobby-ritual-freeroll-btn"
          disabled={busy || !canFreeroll}
          onClick={onPlayFreeroll}
        >
          {entered ? "Freeroll done today" : "Play daily freeroll"}
        </button>
      </div>
    </section>
  );
}
