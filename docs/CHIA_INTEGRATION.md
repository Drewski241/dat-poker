# Chia Integration

## Official stack

This platform integrates with **[Chia-Network/chia-gaming](https://github.com/Chia-Network/chia-gaming)**:

- **State channels** — Shared on-chain coin; gameplay off-chain via signed messages (potato protocol).
- **Referee puzzles** — Chialisp validators for moves and slashing on dispute.
- **Calpoker** — Reference poker variant with commit-reveal randomness.

Developer guide: [Chia Gaming Developers Guide](https://docs.chia.net/guides/gaming-developers-guide)

## Running chia-gaming locally (optional)

```bash
git clone https://github.com/Chia-Network/chia-gaming.git
cd chia-gaming
./build-docker-images.sh
# Frontend :3000, Lobby :3001, Simulator :5800
```

Point this monorepo at those services:

```env
CHIA_GAMING_LOBBY_URL=http://localhost:3001
CHIA_GAMING_GAME_URL=http://localhost:3000
```

> **Alpha warning:** Live WalletConnect testing can leave funds on-chain after shutdown. Prefer the simulator for development.

## Integration modes

Player wagers are **DAT only**. `xchWagerMojos` is always `0`. XCH may pay a Chia network fee; it is not a pot. chia-gaming's channel coin is still an XCH primitive upstream, and CAT stakes inside that coin are not available yet, so DAT stays in this platform's bonds. The hub (`/ws/game`) relays potato messages and does not hold the pot.

`resolveHybridPlay()` in `@dat-poker/shared` picks the mode from who is seated. Every variant sets `headsUpViaChiaGaming`. Only Calpoker sets `chiaGamingNative` (the upstream referee). Other variants run on the DAT POKER engine; the channel carries the co-signed result.

### Heads-up channel (exactly 2 players)

Used for every variant, including the heads-up stretch of a Sit & Go or tournament.

- `POST /v1/tables` with `maxSeats: 2` (or any table once two players remain)
- Session relay is `{CHIA_GAMING_LOBBY_URL}` → `ws://…/ws/game`
- `ChiaGamingClient.createHeadToHeadRoom()` records the DAT stake and refuses `unit: "xch"`
- Calpoker uses the upstream referee. NLHE and the other variants use `engine-result-on-channel`

### DAT table vault (3–10 players)

chia-gaming channels are pairwise, so a multiway pot cannot live in one channel. This vault is our table solution. It does not wait on upstream multi-table tournament work.

- Each seat's DAT stack is the bond
- After a hand, `POST /v1/tables/:id/vault/cosign` records acceptance of the stack vector
- The vector sticks when every seated player has co-signed
- A player who withholds a signature leaves balances on the last co-signed vector
- Cash rings, Sit & Gos, and tournament tables all use this while three or more players remain

### Heads-up promotion

When a vault table drops to two players, the vault freezes (`frozen-for-heads-up`) and the same DAT stacks open a chia-gaming session. A later third player reopens a fresh vault. Tournament payouts stay DAT.

### Not a wager

`POST /v1/tables` with `unit: "xch"` or `unit: "cat"` returns 400. The only accepted unit is `dat`.

## Network configuration

| Network | coinset URL |
|---------|-------------|
| mainnet | `https://coinset.org` |
| testnet11 | `https://testnet11.api.coinset.org` |

WalletConnect project ID is required for production wallet flows. See [WALLETCONNECT.md](./WALLETCONNECT.md) for setup and API endpoints.

## Next implementation steps

1. Move DAT bonds into the channel coin when chia-gaming ships CAT stakes. Until then the channel records a zero XCH wager and DAT stays in the vault or session bond.
2. Install per-variant referees so heads-up PLO, stud, and mixed games validate inside the channel, not only as an engine result.
3. Add settlement worker service consuming hand-complete events.
4. Simulator E2E test harness in CI (Docker compose profile).
