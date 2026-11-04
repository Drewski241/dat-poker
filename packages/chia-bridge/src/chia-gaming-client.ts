import { randomUUID } from "node:crypto";
import type { PokerVariant } from "@dat-poker/shared";
import { openDatHeadsUpSession, toGameRelayUrl } from "./hybrid-session.js";
import type { ChiaBridgeConfig, LobbyRoom, StateChannelSession } from "./types.js";

/**
 * HTTP adapter for Chia-Network/chia-gaming lobby + game services.
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
   * Describe a heads-up chia-gaming session denominated in DAT.
   *
   * The hub (`/ws/game`) relays potato messages. It does not custody the pot.
   * chia-gaming's channel coin is still an XCH primitive upstream, and CAT
   * stakes are not in that coin yet, so this room records an XCH wager of zero.
   * Player value stays in DAT bonds. Matchmaking is the hub page plus the
   * game relay, not a fictional REST room create.
   */
  async createHeadToHeadRoom(params: {
    variant: PokerVariant;
    stakeMojos: bigint;
    playerA?: string;
    playerB?: string;
    assetId?: string | null;
    tableId?: string;
    unit?: string | null;
  }): Promise<LobbyRoom> {
    const session = openDatHeadsUpSession({
      tableId: params.tableId ?? randomUUID(),
      variant: params.variant,
      playerA: params.playerA ?? "unassigned-a",
      playerB: params.playerB ?? "unassigned-b",
      playerAStakeMojos: params.stakeMojos,
      playerBStakeMojos: params.stakeMojos,
      assetId: params.assetId ?? null,
      hubPageUrl: `${this.lobbyBaseUrl}/`,
      gameRelayUrl: toGameRelayUrl(this.lobbyBaseUrl),
      unit: params.unit,
    });
    return {
      roomId: session.sessionId,
      inviteUrl: session.hubPageUrl,
      variant: session.variant,
      createdAt: session.openedAt,
      wagerAsset: session.wagerAsset,
      xchWagerMojos: session.xchWagerMojos,
      gameRelayUrl: session.gameRelayUrl,
      rules: session.rules,
    };
  }

  /** Track an active state channel session (platform-side metadata). */
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
