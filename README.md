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

# Terminal 2 — Web client (Sage WalletConnect + DAT buy-in)
pnpm dev:web

# Optional — treasury payout offers for withdraw (see .env.example)
pnpm dev:treasury
```

Configure `.env` from `.env.example`:

- `WALLETCONNECT_PROJECT_ID` — Sage WalletConnect
- `DAT_GOVERNANCE_TOKEN_ASSET_ID` — your DAT CAT asset id
- `DAT_MIN_BUY_IN_MOJOS=1000000` — 1000 DAT (1000 mojos per whole token)

See [docs/WALLETCONNECT.md](./docs/WALLETCONNECT.md) for the Sage + DAT flow (connect → buy in → play vs house → withdraw).

## AWS EC2 (Free Tier $20 credit)

The email tutorial is [Deploy a web server to the cloud](https://builder.aws.com/content/3BfvbBpwbonTDicuPTMLZBTt4Br/deploy-a-web-server-to-the-cloud)
(Apache + Session Manager, not nginx). Follow [docs/AWS_EC2.md](./docs/AWS_EC2.md)
in **your** AWS Console. After the $20 credit posts and that tutorial box is
gone, launch the public beta with [docs/BETA.md](./docs/BETA.md).

For **on-chain withdraw payouts**, run treasury Sage + `pnpm dev:treasury` on a **separate treasury host**; copy `.env.treasury.example` → `.env`, run `pnpm treasury:check`, then point the game API at it with `DAT_TREASURY_PAYOUT_URL`. See [docs/TREASURY.md](./docs/TREASURY.md).

## Monorepo layout

| Path | Purpose |
|------|---------|
| `packages/game-engine` | NLHE engine, commit-reveal shuffle, hand evaluation |
| `packages/chia-bridge` | chia-gaming adapter, CAT payout offers, settlement proofs |
| `packages/shared` | Types, variant catalog, DAT units, bet sizing |
| `services/api` | REST API (tables, hands, wallet, withdraw) |
| `services/treasury-payout` | Treasury offer builder for on-chain DAT payouts |
| `services/gateway` | WebSocket realtime |
| `apps/web` | Public website (`/` landing, `/play` table) — Sage, NLHE 6-max |
| `docs/` | Architecture, DAT token, Chia integration, roadmap |

## Create this repo on GitHub

Step-by-step: **[docs/CREATE_REPOSITORY.md](./docs/CREATE_REPOSITORY.md)**

## License

MIT
