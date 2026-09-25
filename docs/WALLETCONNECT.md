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

Public beta on AWS: [docs/BETA.md](./BETA.md) (HTTPS on `datspiritpoker.com` + Reown Cloud project).

## Client integration (web)

The Vite web client (`apps/web`) implements Sage WalletConnect:

1. Fetch `/v1/wallet/config` on app load.
2. **Create account / sign in** — username and password. This is the play identity.
3. **Redeem** funded DAT and **join a table** with the account token. Sage is not required.
4. **Connect Sage** only to withdraw DAT to a wallet. On **desktop**, scan the QR with
   Sage mobile. On **iPhone Safari**, tap **Open Sage** in the modal (same phone — do not
   scan the QR on this device). Then **Link Sage address** (CHIP-0002 sign-only). The
   account id does not change.
5. **Start hand** — commit-reveal deal; you act when prompted. Solo vs house,
   the house bot bets, raises, and folds from its cards (it is not a check/call
   station).
6. **Cash out** table stack to the account, then **withdraw to player Sage**.
   Treasury builds an `offer1…` string with the XCH network fee already on
   `make_offer` (`TREASURY_PAYOUT_FEE_MOJOS`). The site calls `chia_takeOffer`
   so Sage shows Accept. Sage Accept has no fee box — tap Accept. If the
   pairing is older, disconnect and Connect Sage again, or import the offer
   (Offers → Import). See [SECURITY.md](./SECURITY.md) and [TREASURY.md](./TREASURY.md).

### Mainnet test checklist

```bash
# .env (API)
WALLETCONNECT_PROJECT_ID=your_project_id
DAT_GOVERNANCE_TOKEN_ASSET_ID=your_64_char_asset_id
CHIA_CHAIN_ID=chia:mainnet
CHIA_NETWORK=mainnet
DAT_ALLOW_DEV_BUYIN=false

pnpm dev:api    # terminal 1
pnpm dev:treasury  # terminal 2 — treasury offers for withdraw (see docs/TREASURY.md)
pnpm dev:web    # terminal 3 — open http://localhost:5173
```

### QR did not appear / `Failed to publish custom payload`

The QR is only drawn after WalletConnect returns a pairing URI. If
`client.connect()` cannot publish that proposal to
`wss://relay.walletconnect.com`, you see the Reown error
`Failed to publish custom payload … tag:undefined` and the modal never
gets a URI.

That is a **relay / domain allowlist** failure, not a Sage scan failure.

1. Reown Cloud → project → **Allowed domains** must include the exact
   origin of the page (`https://datspiritpoker.com` and www).
2. The web client waits for `relayer.confirmOnlineStateOrThrow()` before
   `connect()`, drops inactive pairings (chia-gaming `forgetSessions`
   equivalent), and retries once with `restartTransport`.
3. Reload `/play` and click **Connect Sage** again.

chia-gaming ([Chia-Network/chia-gaming](https://github.com/Chia-Network/chia-gaming)
`front-end/src/constants/wallet-connect.ts`) documents WalletConnect for
the **official Chia wallet** and Calpoker state channels
(`chia_getWallets`, `chia_selectCoins`, `chia_createOfferForIds`). DAT
Poker Sage pairing matches
[xch-dev/sage-dapp-example](https://github.com/xch-dev/sage-dapp-example):
`SignClient.init({ projectId, relayUrl, metadata })` then
`client.connect({ requiredNamespaces, optionalNamespaces })` with CHIP-0002
methods (`chip0002_getAssetBalance`, `chia_getAddress`,
`chia_signMessageByAddress`).

## Development vs production

| Mode | WalletConnect | Buy-in |
|------|---------------|--------|
| **Local dev** | Optional | `DAT_ALLOW_DEV_BUYIN=true` uses engine mojos without on-chain CAT |
| **Staging / prod** | Required | Real DAT CAT offers; `DAT_GOVERNANCE_TOKEN_ASSET_ID` must be set |

> **Alpha warning:** Live WalletConnect testing against mainnet can leave funds locked in state channels if sessions are not closed cleanly. Prefer chia-gaming simulator + testnet11 for development. See [CHIA_INTEGRATION.md](./CHIA_INTEGRATION.md).

## Related docs

- [TREASURY.md](./TREASURY.md) — treasury wallet + on-chain DAT withdraw setup
- [DAT_TOKEN.md](./DAT_TOKEN.md) — DAT Governance Token buy-in architecture
- [CHIA_INTEGRATION.md](./CHIA_INTEGRATION.md) — chia-gaming modes and network URLs
- [ARCHITECTURE.md](./ARCHITECTURE.md) — wallet / treasury component in the platform diagram
- [SECURITY.md](./SECURITY.md) — Sage pairing permissions and beta drain protections
