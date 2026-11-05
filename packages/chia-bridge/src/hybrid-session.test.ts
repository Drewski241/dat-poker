import { describe, expect, it } from "vitest";
import { ChiaGamingClient } from "./chia-gaming-client.js";
import {
  freezeVaultForHeadsUp,
  hashStackVector,
  openDatHeadsUpSession,
  openTableVault,
  recordVaultConsent,
  toGameRelayUrl,
  withVaultSeats,
} from "./hybrid-session.js";

const seats = [
  { playerId: "alice", seatIndex: 0, stackMojos: 1_000_000n },
  { playerId: "bob", seatIndex: 1, stackMojos: 1_000_000n },
  { playerId: "cara", seatIndex: 2, stackMojos: 2_000_000n },
];

describe("DAT heads-up session", () => {
  it("builds a relay URL on the hub origin", () => {
    expect(toGameRelayUrl("http://localhost:3001")).toBe("ws://localhost:3001/ws/game");
    expect(toGameRelayUrl("https://hub.example/lobby")).toBe("wss://hub.example/ws/game");
  });

  it("opens every heads-up variant in DAT and refuses an XCH stake", () => {
    expect(() =>
      openDatHeadsUpSession({
        tableId: "t1",
        variant: "plo4",
        playerA: "alice",
        playerB: "bob",
        playerAStakeMojos: 1000n,
        playerBStakeMojos: 1000n,
        assetId: "dat-asset",
        hubPageUrl: "http://localhost:3001/",
        gameRelayUrl: "ws://localhost:3001/ws/game",
        unit: "xch",
      }),
    ).toThrow(/DAT governance token/);

    const plo = openDatHeadsUpSession({
      tableId: "t1",
      variant: "plo4",
      playerA: "alice",
      playerB: "bob",
      playerAStakeMojos: 1000n,
      playerBStakeMojos: 2500n,
      assetId: "dat-asset",
      hubPageUrl: "http://localhost:3001/",
      gameRelayUrl: "ws://localhost:3001/ws/game",
    });
    expect(plo.rules).toBe("engine-result-on-channel");
    expect(plo.xchWagerMojos).toBe(0n);
    expect(plo.wagerAsset).toBe("dat");
    expect(plo.playerBStakeMojos).toBe(2500n);

    const calpoker = openDatHeadsUpSession({
      tableId: "t2",
      variant: "calpoker",
      playerA: "alice",
      playerB: "bob",
      playerAStakeMojos: 1000n,
      playerBStakeMojos: 1000n,
      assetId: null,
      hubPageUrl: "http://localhost:3001/",
      gameRelayUrl: "ws://localhost:3001/ws/game",
    });
    expect(calpoker.rules).toBe("chia-gaming-referee");
  });

  it("does not call the hub when describing a room", async () => {
    const client = new ChiaGamingClient({
      network: "testnet",
      lobbyUrl: "http://localhost:3001",
      gameUrl: "http://localhost:3000",
      coinsetUrl: "https://testnet11.api.coinset.org",
    });
    const room = await client.createHeadToHeadRoom({
      variant: "nlhe",
      stakeMojos: 1_000_000n,
      playerA: "alice",
      playerB: "bob",
      assetId: "abc",
    });
    expect(room.wagerAsset).toBe("dat");
    expect(room.xchWagerMojos).toBe(0n);
    expect(room.gameRelayUrl).toBe("ws://localhost:3001/ws/game");
    await expect(
      client.createHeadToHeadRoom({ variant: "nlhe", stakeMojos: 1n, unit: "xch" }),
    ).rejects.toThrow(/DAT governance token/);
  });
});

describe("DAT table vault", () => {
  it("sticks a stack vector only after every seat co-signs", () => {
    let vault = openTableVault({ tableId: "ring", assetId: "dat-asset", seats });
    const stateRootHash = hashStackVector("ring", "hand-1", seats);
    vault = recordVaultConsent(vault, {
      playerId: "alice",
      handId: "hand-1",
      stateRootHash,
      stacks: seats,
    });
    expect(vault.lastCoSigned).toBeNull();
    expect(vault.pendingConsent?.signedBy).toEqual(["alice"]);

    vault = recordVaultConsent(vault, {
      playerId: "bob",
      handId: "hand-1",
      stateRootHash,
      stacks: seats,
    });
    vault = recordVaultConsent(vault, {
      playerId: "cara",
      handId: "hand-1",
      stateRootHash,
      stacks: seats,
    });
    expect(vault.pendingConsent).toBeNull();
    expect(vault.lastCoSigned?.stacks.cara).toBe(2_000_000n);
  });

  it("drops consent when the player set changes, then freezes for heads-up", () => {
    const signed = recordVaultConsent(
      openTableVault({ tableId: "ring", assetId: null, seats }),
      {
        playerId: "alice",
        handId: "hand-1",
        stateRootHash: hashStackVector("ring", "hand-1", seats),
        stacks: seats,
      },
    );
    const joined = withVaultSeats(signed, [
      ...seats,
      { playerId: "dee", seatIndex: 3, stackMojos: 1_000_000n },
    ]);
    expect(joined.pendingConsent).toBeNull();
    expect(joined.lastCoSigned).toBeNull();

    const frozen = freezeVaultForHeadsUp(signed);
    expect(frozen.status).toBe("frozen-for-heads-up");
    expect(() =>
      recordVaultConsent(frozen, {
        playerId: "alice",
        handId: "hand-2",
        stateRootHash: "abc",
        stacks: seats,
      }),
    ).toThrow(/frozen/);
  });
});
