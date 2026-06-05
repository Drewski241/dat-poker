# Treasury wallet setup (Sage + DAT withdraw)

Players withdraw table winnings through the web app. The **treasury payout service** uses **Sage wallet RPC** to build a Chia offer; the player accepts it in their **player Sage wallet** via WalletConnect (`chia_takeOffer`).

```mermaid
sequenceDiagram
  participant Player as Sage (player)
  participant Web as DAT Poker web
  participant API as DAT Poker API
  participant Treasury as Treasury service
  participant Sage as Sage (treasury)

  Player->>Web: Withdraw stack (signed message)
  Web->>API: POST /v1/wallet/withdraw
  API->>Treasury: POST /payout { address, amountMojos }
  Treasury->>Sage: make_offer (RPC :9257)
  Sage-->>Treasury: offer1...
  Treasury-->>API: { offer }
  Web->>Player: chia_takeOffer
  Player->>Player: Receive DAT CAT
```

## Two Sage wallets

| Wallet | Role | How it connects |
|--------|------|-----------------|
| **Treasury Sage** | Holds DAT pool, creates payout offers | Local RPC on `https://127.0.0.1:9257` |
| **Player Sage** | Buy-in, play, take offers | WalletConnect from web app |

Use a **separate Sage key/fingerprint** for treasury — not the same profile players use to play.

---

## Step 1 — Treasury Sage wallet

### Desktop (recommended to start)

1. Install [Sage](https://github.com/xch-dev/sage/releases) on the machine running the treasury service.
2. Create or import a **dedicated treasury key** (new fingerprint).
3. Add your **DAT CAT** (`DAT_GOVERNANCE_TOKEN_ASSET_ID`).
4. Fund the wallet:
   - **DAT** for net winnings payouts
   - **XCH** for offer/mempool fees
5. **Enable RPC:** Sage → **Settings → Advanced** → start RPC server (port **9257**).
6. Optional: enable **start RPC automatically** when Sage opens.

### Headless server (production)

Install Sage CLI and run RPC in the foreground (do **not** run GUI RPC at the same time):

```bash
cargo install --git https://github.com/xch-dev/sage --tag v0.11.1 sage-cli
sage rpc start
# In another terminal, login to treasury fingerprint:
sage rpc login '{"fingerprint": YOUR_TREASURY_FINGERPRINT}'
```

See [Sage RPC setup](https://docs.xch.dev/rpc/setup/).

### SSL certificates (auto-detected on Linux)

The treasury service auto-finds Sage certs at:

```text
~/.local/share/sage/ssl/wallet.crt
~/.local/share/sage/ssl/wallet.key
```

Also checked: `~/.local/share/com.rigidnetwork.sage/ssl/`

Override with `TREASURY_WALLET_CERT_PATH` / `TREASURY_WALLET_KEY_PATH` if needed.

---

## Step 2 — Configure `.env`

```env
DAT_GOVERNANCE_TOKEN_ASSET_ID=your_64_char_asset_id

# API → treasury service
DAT_TREASURY_PAYOUT_URL=http://localhost:4200/payout
DAT_WITHDRAW_PAYOUT_MODE=net

# Treasury service → Sage RPC
TREASURY_WALLET_BACKEND=sage
TREASURY_OFFER_MODE=rpc
TREASURY_WALLET_RPC_URL=https://127.0.0.1:9257
TREASURY_SAGE_FINGERPRINT=1234567890
# Certs auto-detected; override if needed:
# TREASURY_WALLET_CERT_PATH=~/.local/share/sage/ssl/wallet.crt
# TREASURY_WALLET_KEY_PATH=~/.local/share/sage/ssl/wallet.key
TREASURY_PAYOUT_FEE_MOJOS=0
```

| Variable | Notes |
|----------|--------|
| `TREASURY_SAGE_FINGERPRINT` | Treasury key fingerprint — service calls `login` before `make_offer` |
| `TREASURY_OFFER_MODE=mock` | Dev only — fake offers, no on-chain DAT |
| `DAT_WITHDRAW_PAYOUT_MODE=net` | Pay winnings only (virtual buy-in): stack − buy-in |
| `TREASURY_WALLET_BACKEND=chia` | Legacy reference wallet only (not recommended) |

---

## Step 3 — Start services

```bash
pnpm install && pnpm build

# Terminal 1 — keep Sage running with RPC enabled
# (Sage desktop or: sage rpc start)

# Terminal 2 — game API
pnpm dev:api

# Terminal 3 — treasury offer builder
pnpm dev:treasury

# Terminal 4 — web UI
pnpm dev:web
```

---

## Step 4 — Verify

```bash
curl -s http://localhost:4200/health | jq
```

Expected:

```json
{
  "status": "ok",
  "offerMode": "rpc",
  "walletBackend": "sage",
  "walletRpcUrl": "https://127.0.0.1:9257",
  "walletConfigured": true,
  "walletRpcReachable": true,
  "sageFingerprint": 1234567890
}
```

Test offer creation:

```bash
curl -s -X POST http://localhost:4200/payout \
  -H 'content-type: application/json' \
  -d '{"address":"xch1yourplayeraddress…","amountMojos":"50000"}' | jq
```

Should return `"offer": "offer1…"`.

List Sage fingerprints:

```bash
# With sage-cli while RPC is running:
sage rpc get_keys '{}'
```

---

## Step 5 — Player withdraw

1. Player connects **their own Sage** via WalletConnect → buy in → play → win.
2. Click **Withdraw … to Sage** → sign withdraw message.
3. Accept **treasury offer** in Sage → DAT arrives on-chain.

Net payout example: 1000 DAT buy-in, 1050 stack → treasury offers **50 DAT** (`50000` mojos).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `walletRpcReachable: false` | Enable RPC in Sage Settings → Advanced; keep Sage open |
| Certs not found | Check `~/.local/share/sage/ssl/` or set cert paths in `.env` |
| Login / fingerprint errors | Set `TREASURY_SAGE_FINGERPRINT`; run `sage rpc login` manually |
| No offer returned | Treasury Sage needs spendable DAT + XCH for fees |
| GUI + CLI RPC conflict | Run only one Sage RPC at a time |
| Player sees no offer | Set `DAT_TREASURY_PAYOUT_URL`; ensure treasury service is up |

---

## Security

- Never expose port **9257** to the internet — local/trusted network only.
- Restrict treasury service port **4200** to the API host.
- Use a dedicated treasury fingerprint with limited DAT balance.

## Related

- [WALLETCONNECT.md](./WALLETCONNECT.md) — player Sage + WalletConnect
- [Sage RPC docs](https://docs.xch.dev/rpc/setup/)
