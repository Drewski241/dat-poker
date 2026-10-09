import { DAT_MTT_DEFAULTS } from "@dat-poker/shared";

/** Classic two-table sit-n-go field (16 entries → 8-max final). */
export const MTT_SITNGO_FIELD_SIZE = DAT_MTT_DEFAULTS.fieldSize;

/** Total MTT field entries (one event spans ceil(field/8) tables). */
export function readMttFieldSize(): number {
  const explicit = process.env.DAT_MTT_FIELD_SIZE?.trim();
  if (explicit) {
    const raw = Number(explicit);
    if (Number.isFinite(raw) && raw >= DAT_MTT_DEFAULTS.startingTableSeats) {
      return Math.min(10_000, Math.floor(raw));
    }
  }
  if (process.env.DAT_POKER_STAGE?.trim().toLowerCase() === "beta") {
    return 500;
  }
  return DAT_MTT_DEFAULTS.fieldSize;
}

export function readMttMaxHumansForField(fieldSize: number): number {
  const raw = Number(process.env.DAT_MTT_MAX_HUMANS ?? DAT_MTT_DEFAULTS.maxHumans);
  if (!Number.isFinite(raw) || raw < 1) return DAT_MTT_DEFAULTS.maxHumans;
  return Math.min(fieldSize, Math.floor(raw));
}

export function readMttMaxHumans(): number {
  return readMttMaxHumansForField(readMttFieldSize());
}

/** Join only the configured large MTT or the 16-player sit-n-go field. */
export function normalizeJoinMttFieldSize(requested?: number): number {
  const largeField = readMttFieldSize();
  if (requested == null || requested === undefined) {
    return largeField;
  }
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n)) {
    throw new Error("Invalid MTT field size");
  }
  if (n === MTT_SITNGO_FIELD_SIZE || n === largeField) {
    return n;
  }
  throw new Error(
    `Unsupported MTT field size (${n}). Use ${MTT_SITNGO_FIELD_SIZE} for sit-n-go or ${largeField} for the main tournament.`,
  );
}
