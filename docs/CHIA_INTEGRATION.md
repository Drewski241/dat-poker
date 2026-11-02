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

### Mode A — Native state channel (2 players)

Best for: Calpoker, heads-up NLHE, high-trust P2P stakes.

- Use `ChiaGamingClient.createHeadToHeadRoom()`
- Wallets open/close channel via chia-gaming UI
- Platform records session metadata only

### Mode B — Platform escrow + batch settlement (3–10 players)

Best for: cash games, SNGs.

- Buy-ins tracked in platform treasury service (future Chialisp escrow coins)
- Hand ends → `buildSettlementProof()` → settlement worker submits Chia tx
- Event log + `stateRootHash` enable third-party audit

### Mode C — Tournament pools

Best for: sit-and-gos and MTTs. See [TOURNAMENT_POOL.md](./TOURNAMENT_POOL.md).

- Each paid entry is its own DAT CAT locked to `puzzles/tournament_pool.clsp`
- The prize pool is the set of those coins, not one coin that grows
- Wallet signature is required to join
- Free site DAT redeems are a separate ledger and do not create a pool coin
- Settlement spends every entry coin; odd mojos go to first place

## Network configuration

| Network | coinset URL |
|---------|-------------|
| mainnet | `https://coinset.org` |
| testnet11 | `https://testnet11.api.coinset.org` |

WalletConnect project ID is required for production wallet flows. See [WALLETCONNECT.md](./WALLETCONNECT.md) for setup and API endpoints.

## Next implementation steps

1. Wire real lobby API paths from chia-gaming OpenAPI (alpha APIs may change).
2. Add settlement worker service consuming Kafka hand-complete events.
3. Broadcast tournament pool spends (lock, refund, settle) through a wallet or coinset client. The puzzle and spend builder are in `puzzles/tournament_pool.clsp`.
4. Simulator E2E test harness in CI (Docker compose profile).
