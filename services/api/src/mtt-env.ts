import { DAT_MTT_DEFAULTS } from "@dat-poker/shared";

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

export function readMttMaxHumans(): number {
  const fieldSize = readMttFieldSize();
  const raw = Number(process.env.DAT_MTT_MAX_HUMANS ?? DAT_MTT_DEFAULTS.maxHumans);
  if (!Number.isFinite(raw) || raw < 1) return DAT_MTT_DEFAULTS.maxHumans;
  return Math.min(fieldSize, Math.floor(raw));
}

/** 16-player sit-n-go (two 8-max tables, then final) — separate from the large MTT field. */
export function readMtt16FieldSize(): number {
  return DAT_MTT_DEFAULTS.fieldSize;
}

export function readMtt16MaxHumans(): number {
  const fieldSize = readMtt16FieldSize();
  const raw = Number(
    process.env.DAT_MTT16_MAX_HUMANS ?? process.env.DAT_MTT_MAX_HUMANS ?? DAT_MTT_DEFAULTS.maxHumans,
  );
  if (!Number.isFinite(raw) || raw < 1) return DAT_MTT_DEFAULTS.maxHumans;
  return Math.min(fieldSize, Math.floor(raw));
}
