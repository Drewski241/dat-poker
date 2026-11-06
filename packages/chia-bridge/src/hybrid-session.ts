import { createHash } from "node:crypto";
import { assertDatOnlyWager, getVariantMeta, type PokerVariant } from "@dat-poker/shared";

export type HeadsUpRules = "chia-gaming-referee" | "engine-result-on-channel";

export interface DatHeadsUpSession {
  sessionId: string;
  tableId: string;
  variant: PokerVariant;
  rules: HeadsUpRules;
  playerA: string;
  playerB: string;
  playerAStakeMojos: bigint;
  playerBStakeMojos: bigint;
  assetId: string | null;
  wagerAsset: "dat";
  xchWagerMojos: 0n;
  hubPageUrl: string;
  /** chia-gaming hub game relay. Match messages travel here; the hub does not hold the pot. */
  gameRelayUrl: string;
  status: "ready" | "closed";
  openedAt: string;
}

export interface VaultSeat {
  playerId: string;
  seatIndex: number;
  bondMojos: bigint;
}

export interface StackVector {
  handId: string;
  stateRootHash: string;
  stacks: Record<string, bigint>;
}

export interface VaultConsent {
  handId: string;
  stateRootHash: string;
  signedBy: string[];
}

export interface TableVault {
  tableId: string;
  assetId: string | null;
  wagerAsset: "dat";
  xchWagerMojos: 0n;
  status: "open" | "frozen-for-heads-up";
  seats: VaultSeat[];
  pendingConsent: VaultConsent | null;
  /** Last stack vector every seated player co-signed. Dispute timeout returns here. */
  lastCoSigned: StackVector | null;
}

export interface SeatStack {
  playerId: string;
  seatIndex: number;
  stackMojos: bigint;
}

function samePlayers(left: VaultSeat[], right: SeatStack[]): boolean {
  const a = left.map((seat) => seat.playerId).sort();
  const b = right.map((seat) => seat.playerId).sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function toSeats(seats: SeatStack[]): VaultSeat[] {
  return seats
    .map((seat) => ({
      playerId: seat.playerId,
      seatIndex: seat.seatIndex,
      bondMojos: seat.stackMojos,
    }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

/** Hub origin → game relay WebSocket. `CHIA_GAMING_LOBBY_URL` is that origin. */
export function toGameRelayUrl(lobbyUrl: string): string {
  const url = new URL(lobbyUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/game";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function openDatHeadsUpSession(input: {
  tableId: string;
  variant: PokerVariant;
  playerA: string;
  playerB: string;
  playerAStakeMojos: bigint;
  playerBStakeMojos: bigint;
  assetId: string | null;
  hubPageUrl: string;
  gameRelayUrl: string;
  unit?: string | null;
  openedAt?: string;
}): DatHeadsUpSession {
  assertDatOnlyWager(input.unit);
  if (input.playerA === input.playerB) {
    throw new Error("Heads-up session needs two distinct players");
  }
  if (input.playerAStakeMojos <= 0n || input.playerBStakeMojos <= 0n) {
    throw new Error("DAT stake must be positive");
  }
  const meta = getVariantMeta(input.variant);
  if (!meta?.headsUpViaChiaGaming) {
    throw new Error(`${input.variant} cannot open a chia-gaming heads-up session`);
  }

  return {
    sessionId: `sc_${input.tableId}`,
    tableId: input.tableId,
    variant: input.variant,
    rules: meta.chiaGamingNative ? "chia-gaming-referee" : "engine-result-on-channel",
    playerA: input.playerA,
    playerB: input.playerB,
    playerAStakeMojos: input.playerAStakeMojos,
    playerBStakeMojos: input.playerBStakeMojos,
    assetId: input.assetId,
    wagerAsset: "dat",
    xchWagerMojos: 0n,
    hubPageUrl: input.hubPageUrl,
    gameRelayUrl: input.gameRelayUrl,
    status: "ready",
    openedAt: input.openedAt ?? new Date().toISOString(),
  };
}

export function openTableVault(input: {
  tableId: string;
  assetId: string | null;
  seats: SeatStack[];
}): TableVault {
  if (input.seats.length < 3) {
    throw new Error("DAT table vault requires at least 3 players");
  }
  return {
    tableId: input.tableId,
    assetId: input.assetId,
    wagerAsset: "dat",
    xchWagerMojos: 0n,
    status: "open",
    seats: toSeats(input.seats),
    pendingConsent: null,
    lastCoSigned: null,
  };
}

/** Refresh bonds after a seat change. A new player set drops an in-progress consent. */
export function withVaultSeats(vault: TableVault, seats: SeatStack[]): TableVault {
  if (seats.length < 3) {
    throw new Error("DAT table vault requires at least 3 players");
  }
  const same = samePlayers(vault.seats, seats);
  return {
    ...vault,
    status: "open",
    seats: toSeats(seats),
    pendingConsent: same ? vault.pendingConsent : null,
    lastCoSigned: same ? vault.lastCoSigned : null,
  };
}

export function freezeVaultForHeadsUp(vault: TableVault): TableVault {
  if (vault.seats.length < 2) {
    throw new Error("Heads-up promotion requires a vault that still has players");
  }
  return {
    ...vault,
    status: "frozen-for-heads-up",
    pendingConsent: null,
  };
}

export function hashStackVector(
  tableId: string,
  handId: string,
  stacks: Array<{ playerId: string; stackMojos: bigint }>,
): string {
  const payload = JSON.stringify({
    tableId,
    handId,
    stacks: [...stacks]
      .sort((a, b) => a.playerId.localeCompare(b.playerId))
      .map((seat) => ({ playerId: seat.playerId, stackMojos: seat.stackMojos.toString() })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Record one player's acceptance of the hand's stack vector.
 * The vector becomes authoritative only after every current seat has signed.
 */
export function recordVaultConsent(
  vault: TableVault,
  input: {
    playerId: string;
    handId: string;
    stateRootHash: string;
    stacks: Array<{ playerId: string; stackMojos: bigint }>;
  },
): TableVault {
  if (vault.status !== "open") {
    throw new Error("Vault is frozen; heads-up play continues on the chia-gaming channel");
  }
  if (!vault.seats.some((seat) => seat.playerId === input.playerId)) {
    throw new Error("Player is not in the vault");
  }

  const pending =
    vault.pendingConsent && vault.pendingConsent.handId === input.handId
      ? vault.pendingConsent
      : { handId: input.handId, stateRootHash: input.stateRootHash, signedBy: [] as string[] };

  if (pending.stateRootHash !== input.stateRootHash) {
    throw new Error("Stack vector does not match the open consent");
  }

  const signedBy = pending.signedBy.includes(input.playerId)
    ? pending.signedBy
    : [...pending.signedBy, input.playerId];
  const complete = vault.seats.every((seat) => signedBy.includes(seat.playerId));

  if (!complete) {
    return { ...vault, pendingConsent: { ...pending, signedBy } };
  }

  const stacks: Record<string, bigint> = {};
  for (const seat of input.stacks) {
    stacks[seat.playerId] = seat.stackMojos;
  }
  return {
    ...vault,
    pendingConsent: null,
    lastCoSigned: { handId: input.handId, stateRootHash: input.stateRootHash, stacks },
  };
}
