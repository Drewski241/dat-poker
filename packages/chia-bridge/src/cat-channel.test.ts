import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { generateChannelKey, signAug, verifyAug } from "./bls.js";
import { CatChannelSession, hashBalanceMessage } from "./cat-channel.js";
import { bytesToHex, catPuzzleHash, channelModHash, channelPuzzleHash, hexToBytes, intToBytes, unrollModHash } from "./clvm.js";
import { runPuzzleSelfTest } from "./puzzle-prove.js";

describe("DAT CAT channel", () => {
  it("matches the Chialisp puzzles on messages, curry, and CAT wrap", () => {
    const report = runPuzzleSelfTest();
    expect(report.ok).toBe(true);

    const alicePh = sha256(new TextEncoder().encode("alice-ph"));
    const bobPh = sha256(new TextEncoder().encode("bob-ph"));
    const nonce = sha256(new TextEncoder().encode("nonce"));
    const tail = sha256(new TextEncoder().encode("dat-tail"));
    const close = hashBalanceMessage("DAT/1/close", nonce, null, alicePh, 60n, bobPh, 40n);
    const state = hashBalanceMessage("DAT/1/state", nonce, 0, alicePh, 60n, bobPh, 40n);
    expect(bytesToHex(close)).toBe(report.closeMessage);
    expect(bytesToHex(state)).toBe(report.stateMessage);
    expect(bytesToHex(channelModHash())).toBe(report.channelModHash);
    expect(bytesToHex(unrollModHash())).toBe(report.unrollModHash);

    const alicePk = Uint8Array.from({ length: 48 }, (_, i) => i);
    const bobPk = Uint8Array.from({ length: 48 }, (_, i) => i + 48);
    const inner = channelPuzzleHash({ alicePk, bobPk, timeoutBlocks: 32, nonce });
    expect(bytesToHex(catPuzzleHash(tail, inner))).toBe(report.catPuzzleHash);
    expect(intToBytes(0n).length).toBe(0);
    expect(bytesToHex(intToBytes(60n))).toBe("3c");
  });

  it("keeps a two-player pot conserved and co-signed", () => {
    const alice = generateChannelKey(new Uint8Array(48).fill(1));
    const bob = generateChannelKey(new Uint8Array(48).fill(2));
    const payout = (seed: number) => bytesToHex(sha256(Uint8Array.from([seed])));
    const session = CatChannelSession.open({
      assetIdHex: "11".repeat(32),
      timeoutBlocks: 32,
      network: "mainnet",
      alice: {
        playerId: "alice",
        publicKeyHex: bytesToHex(alice.publicKey),
        payoutPuzzleHashHex: payout(1),
      },
      bob: {
        playerId: "bob",
        publicKeyHex: bytesToHex(bob.publicKey),
        payoutPuzzleHashHex: payout(2),
      },
      aliceAmount: 1_000_000n,
      bobAmount: 1_000_000n,
    });

    expect(session.snapshot().fullSigHolder).toBe("bob");
    expect(session.snapshot().catPuzzleHashHex).toHaveLength(64);
    session.submitStateShare("alice", bytesToHex(session.signState(alice.secretKey)));
    expect(session.signed).toBe(false);
    session.submitStateShare("bob", bytesToHex(signAug(bob.secretKey, session.stateMessage())));
    expect(session.signed).toBe(true);
    expect(verifyAug(alice.publicKey, session.stateMessage(), hexToBytes(session.snapshot().shares.alice!))).toBe(
      true,
    );

    session.propose(995_000n, 1_005_000n);
    expect(session.sequence).toBe(1);
    expect(session.snapshot().fullSigHolder).toBe("alice");
    expect(() => session.propose(1n, 1n)).toThrow(/sign the current balance/);

    session.submitStateShare("alice", bytesToHex(session.signState(alice.secretKey)));
    session.submitStateShare("bob", bytesToHex(session.signState(bob.secretKey)));
    expect(() => session.propose(1n, 1n)).toThrow(/locked DAT pot/);
    expect(session.status).toBe("desynced");
  });

  it("rejects a state signature from the wrong key", () => {
    const alice = generateChannelKey(new Uint8Array(48).fill(3));
    const bob = generateChannelKey(new Uint8Array(48).fill(4));
    const stranger = generateChannelKey(new Uint8Array(48).fill(5));
    const payout = "ab".repeat(32);
    const session = CatChannelSession.open({
      assetIdHex: "22".repeat(32),
      timeoutBlocks: 8,
      network: "testnet",
      alice: { playerId: "alice", publicKeyHex: bytesToHex(alice.publicKey), payoutPuzzleHashHex: payout },
      bob: { playerId: "bob", publicKeyHex: bytesToHex(bob.publicKey), payoutPuzzleHashHex: "cd".repeat(32) },
      aliceAmount: 10n,
      bobAmount: 10n,
    });
    const forged = bytesToHex(signAug(stranger.secretKey, session.stateMessage()));
    expect(() => session.submitStateShare("alice", forged)).toThrow(/does not match/);
  });
});
