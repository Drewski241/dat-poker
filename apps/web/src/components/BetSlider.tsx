import { formatDatMojos } from "@dat-poker/shared";

export interface BetSliderProps {
  minMojos: bigint;
  maxMojos: bigint;
  stepMojos: bigint;
  valueMojos: bigint;
  ticker?: string;
  disabled?: boolean;
  label: string;
  onChange: (mojos: bigint) => void;
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
  ticker,
  disabled,
  label,
  onChange,
}: BetSliderProps) {
  const min = Number(minMojos);
  const max = Number(maxMojos);
  const step = Number(stepMojos);
  const rangeSteps = step > 0 ? Math.max(0, Math.floor((max - min) / step)) : 0;
  const sliderValue = mojosToSlider(minMojos, valueMojos, stepMojos);

  if (maxMojos <= minMojos || rangeSteps === 0) {
    return null;
  }

  return (
    <div className="bet-slider">
      <div className="bet-slider-header">
        <span>{label}</span>
        <strong>{formatDatMojos(valueMojos.toString(), ticker)}</strong>
      </div>
      <input
        type="range"
        className="bet-slider-input"
        min={0}
        max={rangeSteps}
        step={1}
        value={Math.min(sliderValue, rangeSteps)}
        disabled={disabled}
        onChange={(e) => {
          const next = sliderToMojos(minMojos, Number(e.target.value), stepMojos);
          onChange(next > maxMojos ? maxMojos : next);
        }}
      />
      <div className="bet-slider-bounds">
        <span>{formatDatMojos(minMojos.toString(), ticker)}</span>
        <span>{formatDatMojos(maxMojos.toString(), ticker)}</span>
      </div>
    </div>
  );
}
