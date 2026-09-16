import { describe, expect, it } from "vitest";
import {
  buildBuyInMessage,
  buildRedeemMessage,
  buildWithdrawMessage,
  validateBuyInProof,
  validateRedeemProof,
  validateWithdrawProof,
} from "./wallet-config.js";

describe("validateBuyInProof", () => {
  const params = {
    tableId: "table-1",
    seatIndex: 0,
    buyInMojos: "1000000",
    playerId: "xch1abc",
  };

  it("accepts balance attestation without signature when balance suffices", () => {
    const message = buildBuyInMessage({
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos,
      address: params.playerId,
    });
    expect(
      validateBuyInProof(
        {
          address: params.playerId,
          message,
          signature: "",
          pubkey: "",
          datBalanceMojos: "40000000",
        },
        params,
      ),
    ).toBeNull();
  });

  it("rejects missing signature when balance is insufficient", () => {
    const message = buildBuyInMessage({
      tableId: params.tableId,
      seatIndex: params.seatIndex,
      buyInMojos: params.buyInMojos,
      address: params.playerId,
    });
    expect(
      validateBuyInProof(
        {
          address: params.playerId,
          message,
          signature: "",
          pubkey: "",
          datBalanceMojos: "100",
        },
        params,
      ),
    ).toContain("signature");
  });
});

describe("validateWithdrawProof", () => {
  it("requires a Sage signature for withdraw", () => {
    const params = {
      tableId: "table-1",
      stackMojos: "1050000",
      playerId: "xch1abc",
    };
    const message = buildWithdrawMessage({
      tableId: params.tableId,
      stackMojos: params.stackMojos,
      address: params.playerId,
    });
    expect(
      validateWithdrawProof(
        {
          address: params.playerId,
          message,
          signature: "",
          pubkey: "",
        },
        params,
      ),
    ).toContain("signature");
  });
});

describe("validateRedeemProof", () => {
  it("requires a Sage signature for daily redeem", () => {
    const params = {
      utcDate: "2026-09-16",
      address: "xch1abc",
      amountMojos: "5000000",
      playerId: "xch1abc",
    };
    const message = buildRedeemMessage({
      utcDate: params.utcDate,
      address: params.address,
      amountMojos: params.amountMojos,
    });
    expect(
      validateRedeemProof(
        {
          address: params.playerId,
          message,
          signature: "",
          pubkey: "",
        },
        params,
      ),
    ).toContain("signature");
  });
});
