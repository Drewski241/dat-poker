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

### Mode A — DAT CAT channel (2 players)

Best for: heads-up NLHE where the pot is DAT and neither player can move it alone.

- Create a table with `custody: "cat-channel"` (2 seats only)
- The channel coin is a DAT CAT. Its inner puzzle is the 2-of-2 balance channel in `packages/chia-bridge/puzzles/`
- After each hand both players sign the new stacks. The game server does not custody the pot
- Cooperative close pays both wallet inner puzzle hashes immediately. A unilateral close spends to an unroll coin that pays the latest co-signed balance after a relative timeout. A newer opposite-parity state preempts a stale unroll immediately
- XCH is only the network fee
- chia-gaming's own channel still accepts XCH only. This mode does not wait on that upstream change. See [CAT_CHANNEL.md](./CAT_CHANNEL.md)

### Mode A2 — chia-gaming state channel (2 players, XCH)

Best for: Calpoker experiments that can stake XCH.

- Use `ChiaGamingClient.createHeadToHeadRoom()`
- Wallets open/close the channel via chia-gaming
- Platform records session metadata only

### Mode B — Platform escrow + batch settlement (3–10 players)

Best for: cash games, SNGs.

- Buy-ins tracked in platform treasury service (future Chialisp escrow coins)
- Hand ends → `buildSettlementProof()` → settlement worker submits Chia tx
- Event log + `stateRootHash` enable third-party audit

### Mode C — Tournament pools (100k+ players)

Best for: MTTs.

- Registration opens tournament pool coin on Chia
- Payout table executed after final table settlement
- Off-chain blind/level schedule with on-chain prize pool lock

## Network configuration

| Network | coinset URL |
|---------|-------------|
| mainnet | `https://coinset.org` |
| testnet11 | `https://testnet11.api.coinset.org` |

WalletConnect project ID is required for production wallet flows. See [WALLETCONNECT.md](./WALLETCONNECT.md) for setup and API endpoints.

## Next implementation steps

1. Wire real lobby API paths from chia-gaming OpenAPI (alpha APIs may change).
2. Add settlement worker service consuming Kafka hand-complete events.
3. Implement Chialisp escrow puzzle templates for ring-game buy-ins.
4. Simulator E2E test harness in CI (Docker compose profile).
