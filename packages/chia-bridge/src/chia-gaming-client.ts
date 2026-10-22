import type { ChiaBridgeConfig, LobbyRoom, StateChannelSession } from "./types.js";

/**
 * Optional HTTP adapter for Chia-Network/chia-gaming lobby + game health probes.
 * DAT POKER does not use chia-gaming state channels for play or settlement.
 * @see https://github.com/Chia-Network/chia-gaming
 */
export class ChiaGamingClient {
  constructor(private readonly config: ChiaBridgeConfig) {}

  get lobbyBaseUrl(): string {
    return this.config.lobbyUrl.replace(/\/$/, "");
  }

  get gameBaseUrl(): string {
    return this.config.gameUrl.replace(/\/$/, "");
  }

  /** Health check against lobby service. */
  async pingLobby(): Promise<boolean> {
    try {
      const res = await fetch(`${this.lobbyBaseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a head-to-head room against a local chia-gaming lobby (optional / unused by DAT flows).
   * Exact API shape may change with chia-gaming alpha releases.
   */
  async createHeadToHeadRoom(params: {
    variant: string;
    stakeMojos: bigint;
  }): Promise<LobbyRoom> {
    const res = await fetch(`${this.lobbyBaseUrl}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        variant: params.variant,
        stake_mojos: params.stakeMojos.toString(),
        network: this.config.network,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Lobby create room failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { room_id: string; invite_url: string };
    return {
      roomId: data.room_id,
      inviteUrl: data.invite_url,
      variant: params.variant,
      createdAt: new Date().toISOString(),
    };
  }

  /** Platform-side metadata record for an optional external lobby session. */
  createSessionRecord(room: LobbyRoom, playerA: string, playerB: string, stakeMojos: bigint): StateChannelSession {
    return {
      sessionId: `sc_${room.roomId}`,
      playerA,
      playerB,
      stakeMojos,
      lobbyRoomId: room.roomId,
      status: "opening",
      openedAt: new Date().toISOString(),
    };
  }
}
