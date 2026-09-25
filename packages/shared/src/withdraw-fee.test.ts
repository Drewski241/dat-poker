import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS,
  formatXchMojos,
  resolveSageTakeOfferFeeMojos,
} from "./withdraw-fee.js";

describe("resolveSageTakeOfferFeeMojos", () => {
  it("uses 0.000001 XCH when unset or zero", () => {
    expect(resolveSageTakeOfferFeeMojos(undefined)).toBe(DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS);
    expect(resolveSageTakeOfferFeeMojos("0")).toBe(1_000_000n);
    expect(formatXchMojos(DEFAULT_SAGE_TAKE_OFFER_FEE_MOJOS)).toBe("0.000001 XCH");
  });

  it("keeps an operator override", () => {
    expect(resolveSageTakeOfferFeeMojos("5000000")).toBe(5_000_000n);
    expect(formatXchMojos(5_000_000n)).toBe("0.000005 XCH");
  });
});
