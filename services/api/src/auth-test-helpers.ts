import { COMPLIANCE_TEST_TOKEN } from "./play-compliance.js";

export function currentTermsVersionForTests(): string {
  return process.env.DAT_TERMS_VERSION?.trim() || "2026-09-17";
}

export function termsPayload() {
  return {
    termsAccepted: true,
    termsVersion: currentTermsVersionForTests(),
  };
}

export function authCompliancePayload(countryCode = "US") {
  return {
    countryCode,
    ageConfirmed: true,
    turnstileToken: COMPLIANCE_TEST_TOKEN,
    ...termsPayload(),
  };
}

export function authComplianceHeaders(countryCode = "US"): Record<string, string> {
  return { "cf-ipcountry": countryCode };
}
