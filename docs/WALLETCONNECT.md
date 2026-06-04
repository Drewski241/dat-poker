# WalletConnect Setup

DAT POKER uses [WalletConnect v2](https://docs.walletconnect.com/) so the web client can pair with Chia wallets (Sage, official light wallet, etc.) for buy-ins and head-to-head state-channel flows via [chia-gaming](https://github.com/Chia-Network/chia-gaming).

## Prerequisites

1. A [WalletConnect Cloud](https://cloud.walletconnect.com/) project (free tier is fine for development).
2. A Chia wallet that supports WalletConnect on your target network (mainnet or testnet11).
3. Optional: local chia-gaming lobby/game services for head-to-head testing (see [CHIA_INTEGRATION.md](./CHIA_INTEGRATION.md)).

## Environment variables

Add these to `.env` (see `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `WALLETCONNECT_PROJECT_ID` | Production / live wallet testing | Project ID from WalletConnect Cloud |
| `CHIA_CHAIN_ID` | Recommended | CAIP-2 chain id (default `chia:mainnet`) |
| `CHIA_NETWORK` | Yes | `mainnet` or `testnet` |
| `DAT_GOVERNANCE_TOKEN_ASSET_ID` | Buy-ins | 64-char hex CAT asset ID for DAT |
| `DAT_ALLOW_DEV_BUYIN` | Dev only | Set `true` to skip on-chain buy-in checks locally |

### Example

```env
WALLETCONNECT_PROJECT_ID=your_project_id_here
CHIA_CHAIN_ID=chia:mainnet
CHIA_NETWORK=mainnet
DAT_GOVERNANCE_TOKEN_ASSET_ID=abc123...
DAT_ALLOW_DEV_BUYIN=true
```

## API endpoints

The REST API exposes wallet configuration for clients:

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/wallet/config` | WalletConnect project ID, chain id, chia-gaming URLs |
| `GET /v1/wallet/dat-token` | DAT CAT asset metadata and buy-in readiness |
| `GET /v1/wallet/status` | Combined wallet + chia-gaming health snapshot |

Example:

```bash
curl -s http://localhost:4000/v1/wallet/config | jq
curl -s http://localhost:4000/v1/wallet/dat-token | jq
```

When `WALLETCONNECT_PROJECT_ID` is unset, `/v1/wallet/config` returns `"walletConnect": null` — the web client should fall back to dev buy-in mode or prompt the operator to configure WalletConnect.

## Client integration (web)

1. Fetch `/v1/wallet/config` on app load.
2. If `walletConnect` is present, initialize the WalletConnect Sign Client with `projectId` and `chainId`.
3. Request a session from the user's Chia wallet; approved accounts become the active player address.
4. For DAT buy-ins, use `/v1/wallet/dat-token` to confirm `buyInReady` before calling `POST /v1/tables/:id/seat`.

Head-to-head flows delegate channel open/close to chia-gaming UI after the wallet session is established.

## Development vs production

| Mode | WalletConnect | Buy-in |
|------|---------------|--------|
| **Local dev** | Optional | `DAT_ALLOW_DEV_BUYIN=true` uses engine mojos without on-chain CAT |
| **Staging / prod** | Required | Real DAT CAT offers; `DAT_GOVERNANCE_TOKEN_ASSET_ID` must be set |

> **Alpha warning:** Live WalletConnect testing against mainnet can leave funds locked in state channels if sessions are not closed cleanly. Prefer chia-gaming simulator + testnet11 for development. See [CHIA_INTEGRATION.md](./CHIA_INTEGRATION.md).

## Related docs

- [DAT_TOKEN.md](./DAT_TOKEN.md) — DAT Governance Token buy-in architecture
- [CHIA_INTEGRATION.md](./CHIA_INTEGRATION.md) — chia-gaming modes and network URLs
- [ARCHITECTURE.md](./ARCHITECTURE.md) — wallet / treasury component in the platform diagram
