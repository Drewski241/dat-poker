import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS,
  SAGE_CAT_SPEND_COST_UNITS,
  chiaDustStormFeeMojos,
  formatXchMojos,
  resolveSageCancelFeeMojos,
  resolveSageMakeOfferFeeMojos,
  resolveSageTakeOfferFeeMojos,
} from "./withdraw-fee.js";

describe("chiaDustStormFeeMojos", () => {
  it("is ceil(cost × 0.09) so CAT spends clear the dust-storm mempool", () => {
    expect(chiaDustStormFeeMojos(SAGE_CAT_SPEND_COST_UNITS)).toBe(9_000_000n);
    expect(chiaDustStormFeeMojos(50_000_000)).toBe(4_500_000n);
    expect(chiaDustStormFeeMojos(1)).toBe(1n);
    expect(chiaDustStormFeeMojos(0)).toBe(DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS);
  });
});

describe("resolveSageMakeOfferFeeMojos", () => {
  it("uses 0.000009 XCH when unset or below the dust-storm floor", () => {
    expect(resolveSageMakeOfferFeeMojos(undefined)).toBe(DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS);
    expect(resolveSageMakeOfferFeeMojos("0")).toBe(9_000_000n);
    expect(resolveSageMakeOfferFeeMojos("1000000")).toBe(9_000_000n);
    expect(formatXchMojos(DEFAULT_SAGE_MAKE_OFFER_FEE_MOJOS)).toBe("0.000009 XCH");
  });

  it("keeps an operator override above the dust-storm floor", () => {
    expect(resolveSageMakeOfferFeeMojos("20000000")).toBe(20_000_000n);
    expect(formatXchMojos(20_000_000n)).toBe("0.00002 XCH");
  });
});

describe("resolveSageCancelFeeMojos", () => {
  it("scales the dust-storm floor by leftover offer count", () => {
    expect(resolveSageCancelFeeMojos(undefined, 1)).toBe(9_000_000n);
    expect(resolveSageCancelFeeMojos("1000000", 2)).toBe(18_000_000n);
    expect(resolveSageCancelFeeMojos("30000000", 2)).toBe(30_000_000n);
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
