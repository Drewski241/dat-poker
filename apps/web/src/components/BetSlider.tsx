import { useEffect, useState } from "react";
import {
  betSizePresets,
  formatDatAmount,
  formatDatMojos,
  parseDatTokensToMojos,
  snapRaiseTo,
} from "@dat-poker/shared";

export interface BetSliderProps {
  minMojos: bigint;
  maxMojos: bigint;
  stepMojos: bigint;
  valueMojos: bigint;
  bigBlindMojos: bigint;
  ticker?: string;
  disabled?: boolean;
  label: string;
  onChange: (mojos: bigint) => void;
  /** Tighter layout for the fixed-viewport table screen. */
  compact?: boolean;
}

function mojosToSlider(min: bigint, value: bigint, step: bigint): number {
  if (step <= 0n) return 0;
  return Number((value - min) / step);
}

function sliderToMojos(min: bigint, index: number, step: bigint): bigint {
  return min + BigInt(index) * step;
}

export function BetSlider({
  minMojos,
  maxMojos,
  stepMojos,
  valueMojos,
  bigBlindMojos,
  ticker = "DAT",
  disabled,
  label,
  onChange,
  compact,
}: BetSliderProps) {
  const [draft, setDraft] = useState(() => formatDatAmount(valueMojos));
  const min = Number(minMojos);
  const max = Number(maxMojos);
  const step = Number(stepMojos);
  const rangeSteps = step > 0 ? Math.max(0, Math.floor((max - min) / step)) : 0;
  const sliderValue = mojosToSlider(minMojos, valueMojos, stepMojos);
  const presets = betSizePresets(bigBlindMojos, minMojos, maxMojos);

  useEffect(() => {
    setDraft(formatDatAmount(valueMojos));
  }, [valueMojos]);

  if (maxMojos <= minMojos || rangeSteps === 0) {
    return null;
  }

  const commitDraft = () => {
    const parsed = parseDatTokensToMojos(draft);
    if (parsed == null) {
      setDraft(formatDatAmount(valueMojos));
      return;
    }
    const snapped = snapRaiseTo(parsed, minMojos, maxMojos, stepMojos);
    onChange(snapped);
    setDraft(formatDatAmount(snapped));
  };

  return (
    <div className={compact ? "bet-slider bet-slider-compact" : "bet-slider"}>
      {!compact && <span className="bet-slider-label">{label}</span>}
      <input
        type="range"
        className="bet-slider-input"
        min={0}
        max={rangeSteps}
        step={1}
        value={Math.min(sliderValue, rangeSteps)}
        disabled={disabled}
        aria-label={`${label} slider`}
        onChange={(e) => {
          const next = sliderToMojos(minMojos, Number(e.target.value), stepMojos);
          onChange(next > maxMojos ? maxMojos : next);
        }}
      />
      {!compact && (
        <div className="bet-slider-bounds">
          <span>{formatDatMojos(minMojos.toString(), ticker)}</span>
          <span>{formatDatMojos(maxMojos.toString(), ticker)}</span>
        </div>
      )}
      <div className="bet-presets-row">
        {presets.length > 0 && (
          <div className="bet-presets" role="group" aria-label="Preset bet sizes">
            {presets.map((amount) => (
              <button
                key={amount.toString()}
                type="button"
                className={amount === valueMojos ? "bet-preset active" : "bet-preset"}
                disabled={disabled}
                onClick={() => onChange(amount)}
              >
                {formatDatAmount(amount)}
              </button>
            ))}
          </div>
        )}
        <label className="bet-amount-field">
          <span className="visually-hidden">{label} amount</span>
          <input
            type="text"
            inputMode="decimal"
            className="bet-amount-input"
            value={draft}
            disabled={disabled}
            aria-label={`${label} in ${ticker}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
          />
          <span className="bet-amount-ticker">{ticker}</span>
        </label>
      </div>
    </div>
  );
}
