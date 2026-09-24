import type { FastifyRequest } from "fastify";
import { emailDeliversToInbox, emailDeliveryMode } from "./mail.js";

/** Cloudflare Turnstile always-pass test secret (for automated tests with live verify). */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
/** Token accepted when DAT_PLAY_COMPLIANCE_MODE=test (no HTTP verify). */
export const COMPLIANCE_TEST_TOKEN = "test-pass";

export interface PlayAttestation {
  countryCode?: string;
  ageConfirmed?: boolean;
  turnstileToken?: string;
}

export interface PlayRequirements {
  complianceRequired: boolean;
  turnstileSiteKey: string;
  minAge: number;
  blockedCountryCodes: string[];
  emailDeliveryMode: "memory" | "log" | "smtp";
  emailDeliversToInbox: boolean;
}

function complianceMode(): "off" | "test" | "required" {
  const raw = process.env.DAT_PLAY_COMPLIANCE_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "test" || raw === "required") return raw;
  return "required";
}

export function playComplianceEnabled(): boolean {
  return complianceMode() !== "off";
}

export function minPlayerAge(): number {
  const n = Number(process.env.DAT_MIN_PLAYER_AGE ?? 18);
  return Number.isFinite(n) && n >= 18 && n <= 120 ? Math.floor(n) : 18;
}

export function blockedCountryCodes(): Set<string> {
  const raw = process.env.DAT_BLOCKED_COUNTRY_CODES?.trim();
  const list = raw
    ? raw.split(/[\s,]+/)
    : [
        /* sanctioned / high-risk defaults — operators can override via env */
        "CU",
        "IR",
        "KP",
        "SY",
      ];
  return new Set(list.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)));
}

export function turnstileSecret(): string {
  return process.env.DAT_TURNSTILE_SECRET?.trim() ?? "";
}

export function turnstileSiteKey(): string {
  return process.env.DAT_TURNSTILE_SITE_KEY?.trim() ?? "";
}

export function turnstileRequired(): boolean {
  if (!playComplianceEnabled()) return false;
  if (complianceMode() === "test") return false;
  return Boolean(turnstileSecret());
}

export function readPlayRequirements(): PlayRequirements {
  const complianceRequired = playComplianceEnabled();
  let siteKey = turnstileSiteKey();
  if (complianceMode() === "test") {
    siteKey = TURNSTILE_TEST_SITE_KEY;
  }
  return {
    complianceRequired,
    turnstileSiteKey: complianceRequired && (turnstileRequired() || complianceMode() === "test") ? siteKey : "",
    minAge: minPlayerAge(),
    blockedCountryCodes: [...blockedCountryCodes()].sort(),
    emailDeliveryMode: emailDeliveryMode(),
    emailDeliversToInbox: emailDeliversToInbox(),
  };
}

export function resolveIpCountry(req: FastifyRequest): string | null {
  const cf = req.headers["cf-ipcountry"];
  if (typeof cf === "string" && cf.length === 2) {
    return cf.toUpperCase();
  }
  const dev = req.headers["x-dat-country"];
  if (typeof dev === "string" && dev.length === 2) {
    return dev.toUpperCase();
  }
  return null;
}

function normalizeCountry(code: string): string | null {
  const c = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

async function verifyTurnstileToken(token: string, remoteIp: string): Promise<void> {
  const mode = complianceMode();
  if (mode === "test") {
    if (token === COMPLIANCE_TEST_TOKEN || token === TURNSTILE_TEST_TOKEN) return;
    throw new Error("Bot check failed (test mode)");
  }
  const secret = turnstileSecret();
  if (!secret) {
    throw new Error("Bot check is not configured on the server");
  }
  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: remoteIp,
  });
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("Bot check unavailable — try again");
  }
  const parsed = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!parsed.success) {
    throw new Error("Bot check failed — refresh and try again");
  }
}

export async function assertPlayCompliance(
  req: FastifyRequest,
  attestation: PlayAttestation | undefined,
): Promise<{ countryCode: string }> {
  if (!playComplianceEnabled()) {
    return { countryCode: normalizeCountry(attestation?.countryCode ?? "US") ?? "US" };
  }

  const countryCode = normalizeCountry(attestation?.countryCode ?? "");
  if (!countryCode) {
    throw new Error("Select your country to confirm you may play real-money poker where you live");
  }
  if (!attestation?.ageConfirmed) {
    throw new Error(`You must confirm you are at least ${minPlayerAge()} and legally allowed to play`);
  }

  const blocked = blockedCountryCodes();
  if (blocked.has(countryCode)) {
    throw new Error("DAT Poker is not available in your selected country or region");
  }

  const ipCountry = resolveIpCountry(req);
  if (ipCountry && ipCountry !== "XX" && blocked.has(ipCountry)) {
    throw new Error("DAT Poker is not available from your network region");
  }
  if (
    ipCountry &&
    ipCountry !== "XX" &&
    ipCountry !== "T1" &&
    countryCode !== ipCountry
  ) {
    throw new Error(
      "Your selected country does not match your network location. Use the country where you are physically located.",
    );
  }

  if (turnstileRequired() || complianceMode() === "test") {
    const token = attestation?.turnstileToken?.trim() ?? "";
    if (!token) {
      throw new Error("Complete the bot check before continuing");
    }
    await verifyTurnstileToken(token, req.ip || "");
  }

  return { countryCode };
}
