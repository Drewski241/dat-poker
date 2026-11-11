import { formatDatMojos } from "@dat-poker/shared";

const DENOMS: { dat: number; tone: string }[] = [
  { dat: 1000, tone: "d1000" },
  { dat: 100, tone: "d100" },
  { dat: 25, tone: "d25" },
  { dat: 5, tone: "d5" },
  { dat: 1, tone: "d1" },
];

function pilesFor(mojos: bigint): { tone: string; count: number }[] {
  let dat = mojos / 1000n;
  if (dat <= 0n) return [];
  const piles: { tone: string; count: number }[] = [];
  for (const denom of DENOMS) {
    const unit = BigInt(denom.dat);
    const count = dat / unit;
    dat %= unit;
    if (count > 0n) {
      piles.push({ tone: denom.tone, count: Number(count > 6n ? 6n : count) });
    }
  }
  return piles;
}

export function ChipStack({
  mojos,
  ticker,
}: {
  mojos: string;
  ticker?: string;
}) {
  const amount = BigInt(mojos || "0");
  const piles = pilesFor(amount);
  const label = formatDatMojos(amount, ticker);
  if (amount <= 0n) return null;
  return (
    <div className="chip-stack" aria-label={label}>
      <div className="chip-piles">
        {piles.map((pile) => (
          <div
            key={pile.tone}
            className="chip-pile"
            style={{ height: 16 + (pile.count - 1) * 4 }}
          >
            {Array.from({ length: pile.count }, (_, index) => (
              <span key={index} className={`chip ${pile.tone}`} style={{ bottom: index * 4 }} />
            ))}
          </div>
        ))}
      </div>
      <span className="chip-label">{label}</span>
    </div>
  );
}
