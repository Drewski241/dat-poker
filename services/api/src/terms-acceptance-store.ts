import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { termsAcceptanceTtlMs } from "./terms-of-service.js";

export interface TermsAcceptanceRecord {
  playerId: string;
  termsVersion: string;
  acceptedAt: string;
}

const byPlayerId = new Map<string, TermsAcceptanceRecord>();
let loaded = false;

function storePath(): string | null {
  const raw = process.env.DAT_TERMS_ACCEPTANCE_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(process.cwd(), "data/terms-acceptances.json");
}

async function persist(): Promise<void> {
  const path = storePath();
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify({ acceptances: [...byPlayerId.values()] }, null, 2);
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
}

export async function loadTermsAcceptances(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const path = storePath();
  if (!path) return;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { acceptances?: TermsAcceptanceRecord[] };
    for (const row of parsed.acceptances ?? []) {
      byPlayerId.set(row.playerId, row);
    }
  } catch {
    /* first run */
  }
}

export async function recordTermsAcceptance(playerId: string, termsVersion: string): Promise<void> {
  await loadTermsAcceptances();
  const row: TermsAcceptanceRecord = {
    playerId,
    termsVersion,
    acceptedAt: new Date().toISOString(),
  };
  byPlayerId.set(playerId, row);
  await persist();
}

export async function getTermsAcceptance(playerId: string): Promise<TermsAcceptanceRecord | undefined> {
  await loadTermsAcceptances();
  return byPlayerId.get(playerId);
}

export async function isTermsAcceptanceOnFile(params: {
  playerId: string;
  termsVersion: string;
  nowMs?: number;
}): Promise<boolean> {
  const rec = await getTermsAcceptance(params.playerId);
  if (!rec) return false;
  if (rec.termsVersion !== params.termsVersion) return false;
  const at = Date.parse(rec.acceptedAt);
  if (!Number.isFinite(at)) return false;
  const now = params.nowMs ?? Date.now();
  return now - at <= termsAcceptanceTtlMs();
}

export function resetTermsAcceptancesForTests(): void {
  byPlayerId.clear();
  loaded = true;
}

/** Test helper — pin acceptance timestamp. */
export function setTermsAcceptanceForTests(
  playerId: string,
  termsVersion: string,
  acceptedAt: string,
): void {
  byPlayerId.set(playerId, { playerId, termsVersion, acceptedAt });
}
