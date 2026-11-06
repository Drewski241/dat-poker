import { useCallback, useEffect, useRef, useState } from "react";
import { generateChannelKey, publicKeyFor, signAug } from "@dat-poker/chia-bridge/bls";
import { api, type CatChannelSnapshot, type PuzzleCondition } from "./api.js";

const CHANNEL_KEY_STORAGE = "dat-poker-cat-channel-secret";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(digest));
}

export function useCatChannel(opts: {
  playerId: string | null;
  apiOk: boolean | null;
  buyIn: string;
  devAck: boolean;
  busy: boolean;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  onTable: (tableId: string) => void;
}) {
  const [channel, setChannel] = useState<CatChannelSnapshot | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [proof, setProof] = useState<{ kind: string; conditions: PuzzleCondition[] } | null>(null);
  const signedMessage = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const signBalance = useCallback(async () => {
    const current = optsRef.current;
    if (!tableId || !current.playerId || !channel || !secret) {
      throw new Error("Open a heads-up DAT channel first");
    }
    const signature = bytesToHex(signAug(secret, hexToBytes(channel.stateMessageHex)));
    const next = await api.signCatChannelState(tableId, current.playerId, signature);
    setChannel(next.channel);
  }, [tableId, channel, secret]);

  useEffect(() => {
    if (!channel || channel.signed || !secret || !tableId || !opts.playerId || opts.busy) return;
    if (signedMessage.current === channel.stateMessageHex) return;
    signedMessage.current = channel.stateMessageHex;
    void opts.run("Signing DAT channel balance…", signBalance);
  }, [channel, secret, tableId, opts, signBalance]);

  const play = () => {
    const current = optsRef.current;
    if (!current.playerId) return;
    void current.run("Opening DAT channel…", async () => {
      const stored = sessionStorage.getItem(CHANNEL_KEY_STORAGE);
      const key = stored
        ? { secretKey: hexToBytes(stored), publicKey: publicKeyFor(hexToBytes(stored)) }
        : generateChannelKey();
      sessionStorage.setItem(CHANNEL_KEY_STORAGE, bytesToHex(key.secretKey));
      setSecret(key.secretKey);
      const playerId = current.playerId;
      if (!playerId) return;
      const { tableId: created } = await api.createTable({ custody: "cat-channel", maxSeats: 2 });
      await api.seatPlayer(created, playerId, 0, current.buyIn, { devAck: current.devAck });
      await api.seatHouse(created, current.buyIn);
      const payout = await sha256Hex(key.publicKey);
      const opened = await api.openCatChannel(created, {
        alicePublicKey: bytesToHex(key.publicKey),
        alicePayoutPuzzleHash: payout,
      });
      setTableId(created);
      setChannel(opened.channel);
      signedMessage.current = null;
      current.onTable(created);
    });
  };

  const prove = (kind: "close" | "settle" | "preempt") => {
    if (!tableId) return;
    void optsRef.current.run(`Proving ${kind}…`, async () => {
      const result = await api.proveCatChannel(tableId, kind);
      setProof({ kind, conditions: result.conditions });
    });
  };

  const close = () => {
    const current = optsRef.current;
    if (!tableId || !current.playerId || !channel || !secret) return;
    void current.run("Signing cooperative close…", async () => {
      const signature = bytesToHex(signAug(secret, hexToBytes(channel.closeSigningHex)));
      const playerId = current.playerId;
      if (!playerId) return;
      const next = await api.signCatChannelClose(tableId, playerId, signature);
      setChannel(next.channel);
      if (next.channel.closeReady) {
        const result = await api.proveCatChannel(tableId, "close");
        setProof({ kind: "close", conditions: result.conditions });
      }
    });
  };

  return {
    channel,
    proof,
    noteChannel(next: CatChannelSnapshot | null | undefined) {
      if (next) setChannel(next);
    },
    clear() {
      setChannel(null);
      setProof(null);
      setTableId(null);
      signedMessage.current = null;
    },
    play,
    sign() {
      signedMessage.current = null;
      void optsRef.current.run("Signing DAT channel balance…", signBalance);
    },
    prove,
    close,
  };
}
