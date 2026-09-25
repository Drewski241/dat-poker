import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
  formatXchMojos,
  resolveSageMakeOfferFeeMojos,
  resolveSageTakeOfferFeeMojos,
} from "./withdraw-fee.js";

describe("resolveSageMakeOfferFeeMojos", () => {
  it("uses 0.000001 XCH when unset or zero so treasury pays the Accept fee", () => {
    expect(resolveSageMakeOfferFeeMojos(undefined)).toBe(DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS);
    expect(resolveSageMakeOfferFeeMojos("0")).toBe(1_000_000n);
    expect(formatXchMojos(DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS)).toBe("0.000001 XCH");
  });

  it("keeps an operator override", () => {
    expect(resolveSageMakeOfferFeeMojos("5000000")).toBe(5_000_000n);
    expect(formatXchMojos(5_000_000n)).toBe("0.000005 XCH");
  });
});

describe("resolveSageTakeOfferFeeMojos", () => {
  it("stays 0 so Sage Accept does not ask the player for XCH", () => {
    expect(resolveSageTakeOfferFeeMojos(undefined)).toBe(0n);
    expect(resolveSageTakeOfferFeeMojos("0")).toBe(0n);
  });

  it("keeps an operator override", () => {
    expect(resolveSageTakeOfferFeeMojos("1000000")).toBe(1_000_000n);
  });
});
