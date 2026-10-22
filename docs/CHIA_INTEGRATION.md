# Chia Integration

## How DAT POKER uses Chia

DAT POKER settles value on Chia with the **DAT Governance Token** (CAT):

- **Buy-in / bankroll** — Sage WalletConnect (`docs/WALLETCONNECT.md`)
- **Withdraw** — treasury payout service builds DAT CAT offers; players take them in Sage (`docs/TREASURY.md`)
- **Gameplay** — authoritative off-chain game servers (not per-action on-chain writes)

DAT POKER does **not** use [chia-gaming](https://github.com/Chia-Network/chia-gaming) **state channels** for play or settlement.

## Optional health probe

The API can probe optional chia-gaming lobby/game URLs for operators who run those services locally. This is unrelated to the DAT buy-in / treasury path:

```env
CHIA_GAMING_LOBBY_URL=http://localhost:3001
CHIA_GAMING_GAME_URL=http://localhost:3000
```

```bash
curl -s http://localhost:4000/health/chia-gaming
```

If those env vars are unset, the probe simply reports unreachable — that does not affect tables, hands, or DAT settlement.

## Settlement model (current)

| Layer | Mechanism |
|-------|-----------|
| Off-chain | Game engine + platform ledger (stacks, hands, events) |
| On-chain | DAT CAT via WalletConnect buy-in checks and treasury `make_offer` / `chia_takeOffer` withdraws |
| Audit | `SettlementProof` / `stateRootHash` helpers in `packages/chia-bridge` (batch anchoring planned) |

## Network configuration

| Network | coinset URL |
|---------|-------------|
| mainnet | `https://coinset.org` |
| testnet11 | `https://testnet11.api.coinset.org` |

WalletConnect project ID is required for production wallet flows. See [WALLETCONNECT.md](./WALLETCONNECT.md).

## Related docs

- [TREASURY.md](./TREASURY.md) — treasury Sage + on-chain DAT withdraw
- [DAT_TOKEN.md](./DAT_TOKEN.md) — DAT CAT configuration
- [ARCHITECTURE.md](./ARCHITECTURE.md) — platform diagram
