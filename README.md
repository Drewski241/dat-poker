# DAT POKER

Global-scale poker on the **Chia blockchain** with off-chain gameplay and on-chain settlement via [chia-gaming](https://github.com/Chia-Network/chia-gaming) state channels.

**Account funding:** player buy-ins and bankrolls use the **DAT Governance Token** (Chia CAT). See [docs/DAT_TOKEN.md](./docs/DAT_TOKEN.md).

## Quick start

```bash
git clone https://github.com/Drewski241/dat-poker.git
cd dat-poker
corepack enable
pnpm install
pnpm build
pnpm test

# Terminal 1 — REST API
pnpm dev:api

# Terminal 2 — WebSocket gateway
pnpm dev:gateway

# Terminal 3 — Web client (Vite)
pnpm dev:web
```

Copy `.env.example` to `.env` and set your DAT Governance Token `asset_id`.

## Monorepo layout

| Path | Purpose |
|------|---------|
| `packages/game-engine` | NLHE engine, commit-reveal shuffle, hand evaluation |
| `packages/chia-bridge` | chia-gaming adapter, CAT payout offers, settlement proofs |
| `packages/shared` | Types, variant catalog, DAT units, bet sizing |
| `services/api` | REST API (tables, hands, wallet, withdraw) |
| `services/treasury-payout` | Treasury offer builder for on-chain DAT payouts |
| `services/gateway` | WebSocket realtime |
| `apps/web` | Web client — Sage WalletConnect, NLHE vs house |
| `docs/` | Architecture, DAT token, Chia integration, roadmap |

## Create this repo on GitHub

Step-by-step: **[docs/CREATE_REPOSITORY.md](./docs/CREATE_REPOSITORY.md)**

## License

MIT
