import { CASINO_LOSS_LIMIT_CHOICES_MOJOS, formatDatMojos } from "@dat-poker/shared";

export function SessionReminder({
  resultMojos,
  lossLimitMojos,
  limitReached,
  canEdit,
  busy,
  ticker,
  onSetLimit,
}: {
  resultMojos: string;
  lossLimitMojos: string | null;
  limitReached: boolean;
  canEdit: boolean;
  busy: boolean;
  ticker?: string;
  onSetLimit: (lossLimitMojos: string | null) => void;
}) {
  const result = BigInt(resultMojos);
  const down = result < 0n ? (-result).toString() : "0";
  const limit = lossLimitMojos === null ? null : BigInt(lossLimitMojos);
  const sentence = limitReached
    ? `Session limit reached. You're down ${formatDatMojos(down, ticker)}.`
    : result === 0n
      ? "Even this session"
      : result < 0n
        ? `Down ${formatDatMojos(down, ticker)} this session`
        : `Up ${formatDatMojos(result.toString(), ticker)} this session`;

  return (
    <div className="session-block">
      <p className={`session-reminder ${limitReached ? "limit" : result < 0n ? "down" : result > 0n ? "up" : ""}`}>
        {sentence}
        {limit !== null && !limitReached ? ` · loss limit ${formatDatMojos(limit.toString(), ticker)}` : ""}
      </p>
      {canEdit && (
        <div className="actions">
          {CASINO_LOSS_LIMIT_CHOICES_MOJOS.map((choice) => (
            <button
              key={choice.toString()}
              type="button"
              className={limit === choice ? "primary-bet" : "secondary"}
              disabled={busy}
              onClick={() => onSetLimit(choice.toString())}
            >
              {formatDatMojos(choice.toString(), ticker)}
            </button>
          ))}
          <button
            type="button"
            className={limit === null ? "primary-bet" : "secondary"}
            disabled={busy}
            onClick={() => onSetLimit(null)}
          >
            No limit
          </button>
        </div>
      )}
    </div>
  );
}
