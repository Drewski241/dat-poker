import { formatDatMojos } from "@dat-poker/shared";

export function ChipStack({ mojos, ticker }: { mojos: string | bigint; ticker?: string }) {
  return <p className="bj-label">Bet {formatDatMojos(mojos, ticker)}</p>;
}
