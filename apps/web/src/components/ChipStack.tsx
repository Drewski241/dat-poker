import { formatDatMojos } from "@dat-poker/shared";

const DENOMS: Array<{ mojos: bigint; label: string; color: string }> = [
  { mojos: 100_000n, label: "100", color: "black" },
  { mojos: 50_000n, label: "50", color: "blue" },
  { mojos: 25_000n, label: "25", color: "green" },
  { mojos: 10_000n, label: "10", color: "red" },
  { mojos: 5_000n, label: "5", color: "white" },
  { mojos: 1_000n, label: "1", color: "clay" },
];

function chipPile(amount: bigint): Array<{ label: string; color: string }> {
  const chips: Array<{ label: string; color: string }> = [];
  let left = amount > 0n ? amount : 0n;
  for (const denom of DENOMS) {
    let count = 0;
    while (left >= denom.mojos && count < 4 && chips.length < 6) {
      chips.push({ label: denom.label, color: denom.color });
      left -= denom.mojos;
      count += 1;
    }
  }
  if (chips.length === 0) chips.push({ label: "1", color: "clay" });
  return chips;
}

export function ChipStack({ mojos, ticker }: { mojos: string | bigint; ticker?: string }) {
  const amount = typeof mojos === "bigint" ? mojos : BigInt(mojos);
  const chips = chipPile(amount);
  return (
    <div className="casino-wager">
      <div className="casino-chips" aria-hidden="true">
        {chips.map((chip, index) => (
          <span key={`${chip.color}${index}`} className={`casino-chip ${chip.color}`}>
            {index === chips.length - 1 ? <span>{chip.label}</span> : null}
          </span>
        ))}
      </div>
      <p className="casino-wager-label">Bet {formatDatMojos(amount, ticker)}</p>
    </div>
  );
}
