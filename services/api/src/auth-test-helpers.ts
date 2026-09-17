import { COMPLIANCE_TEST_TOKEN } from "./play-compliance.js";

export function authCompliancePayload(countryCode = "US") {
  return {
    countryCode,
    ageConfirmed: true,
    turnstileToken: COMPLIANCE_TEST_TOKEN,
  };
}

export function authComplianceHeaders(countryCode = "US"): Record<string, string> {
  return { "cf-ipcountry": countryCode };
}
