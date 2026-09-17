import { describe, expect, it } from "vitest";
import { playerIdFromPubkey, signChip0002ForTests, verifyChip0002Signature } from "./chip0002.js";

describe("CHIP-0002 signatures", () => {
  it(
    "round-trips a UTF-8 login message",
    () => {
    const message = "dat-poker:v1:session:abc:xch1alice";
    const signed = signChip0002ForTests(new Uint8Array(32).fill(3), message);
    expect(verifyChip0002Signature(signed.pubkey, message, signed.signature)).toBe(true);
    expect(verifyChip0002Signature(signed.pubkey, message + "x", signed.signature)).toBe(false);
    },
    15_000,
  );

  it("rejects truncated signatures", () => {
    const message = "hello";
    const signed = signChip0002ForTests(new Uint8Array(32).fill(9), message);
    expect(verifyChip0002Signature(signed.pubkey, message, signed.signature.slice(0, 16))).toBe(false);
  });

  it("derives a stable playerId from a pubkey", () => {
    const signed = signChip0002ForTests(new Uint8Array(32).fill(1), "m");
    expect(playerIdFromPubkey(signed.pubkey)).toMatch(/^pk_[0-9a-f]{40}$/);
    expect(playerIdFromPubkey(signed.pubkey)).toBe(playerIdFromPubkey(`0x${signed.pubkey}`));
  });
});
