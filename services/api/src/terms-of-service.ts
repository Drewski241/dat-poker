import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TermsDocument {
  version: string;
  effectiveDate: string;
  acceptanceValidDays: number;
  content: string;
}

let cachedContent: string | null | undefined;

function termsVersion(): string {
  return process.env.DAT_TERMS_VERSION?.trim() || "2026-09-17";
}

function termsEffectiveDate(): string {
  return process.env.DAT_TERMS_EFFECTIVE_DATE?.trim() || termsVersion();
}

export function termsAcceptanceValidDays(): number {
  const n = Number(process.env.DAT_TERMS_ACCEPTANCE_DAYS ?? 365);
  return Number.isFinite(n) && n >= 1 && n <= 3650 ? Math.floor(n) : 365;
}

export function termsAcceptanceTtlMs(): number {
  return termsAcceptanceValidDays() * 24 * 60 * 60 * 1000;
}

function termsFilePath(): string {
  const raw = process.env.DAT_TERMS_PATH?.trim();
  if (raw) return resolve(raw);
  return resolve(__dirname, "../content/terms.md");
}

async function loadTermsMarkdown(): Promise<string> {
  if (cachedContent !== undefined) return cachedContent ?? "";
  try {
    cachedContent = await readFile(termsFilePath(), "utf8");
  } catch {
    cachedContent = "";
  }
  return cachedContent;
}

export async function getCurrentTermsDocument(): Promise<TermsDocument> {
  const version = termsVersion();
  const effectiveDate = termsEffectiveDate();
  let content = await loadTermsMarkdown();
  content = content
    .replace(/\{\{VERSION\}\}/g, version)
    .replace(/\{\{EFFECTIVE_DATE\}\}/g, effectiveDate);
  return {
    version,
    effectiveDate,
    acceptanceValidDays: termsAcceptanceValidDays(),
    content,
  };
}

export function assertTermsAccepted(params: {
  termsAccepted?: boolean;
  termsVersion?: string;
}): void {
  const current = termsVersion();
  if (!params.termsAccepted) {
    throw new Error("You must accept the current Terms and Conditions");
  }
  const offered = params.termsVersion?.trim();
  if (!offered || offered !== current) {
    throw new Error("Terms have been updated — review and accept the current version");
  }
}

export function resetTermsContentCacheForTests(): void {
  cachedContent = undefined;
}
