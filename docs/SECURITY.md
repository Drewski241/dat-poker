# Beta security (website + Sage)

Closed beta on **https://datspiritpoker.com/**. Testers create an **account** to
play. Sage WalletConnect is optional and only needed to withdraw DAT to a
wallet. Pairing must not drain testers or the operator Sage.

## What cannot drain Sage

WalletConnect pairing for DAT Poker **only** requests:

- `chia_getAddress`, `chip0002_getPublicKeys`, `chip0002_getAssetBalance`
- `chia_signMessageByAddress`, `chip0002_signMessage`

CHIP-0002 `signMessage` hashes with the `"Chia Signed Message"` prefix, so a
signed link / withdraw **text** cannot be reused as a spend.

The site **does not request** `chia_send`, `chia_createOffer`,
`chia_takeOffer`, or `chip0002_signCoinSpends`. Old sessions that still have
those methods are dropped on page load. On-chain `takeOffer` after withdraw
is disabled on the game host.

Daily redeem and table stacks are **ledger credits**, not CAT sends. Account
DAT is stored on the game host (`data/ledger.json`) so a redeploy does not
wipe testers’ balances. Open tables still reset. Treasury Sage stays on a
separate machine ([TREASURY.md](./TREASURY.md)).

Testers should still **read Sage prompts**. If Sage ever asks to send coins or
take an offer during this beta, tap reject and report it on `/feedback`.

## Accounts

Play uses a username + password account (`POST /v1/auth/register` /
`/v1/auth/login`). Passwords are scrypt-hashed. Usernames persist on the
game host (`data/accounts.json`). In-game DAT balances persist in
`data/ledger.json`. Open tables still reset when the API restarts; seated
stacks are returned to the account ledger on a clean shutdown.

- Hole cards and actions require the account bearer token.
- Spoofing someone else's username in JSON does not work.
- Sage is linked later with a CHIP-0002 signature and does **not** change
  the account id (credits stay on the same player).
- **Cash out to account** returns table stack to the in-game ledger. Sage is
  not required for that path.

`DAT_ALLOW_DEV_BUYIN=true` skips on-chain CAT checks for table buy-in. It
does not move on-chain DAT.

## Website controls

- HTTPS via Caddy; HTTP-only IP will not pair Sage.
- Content-Security-Policy, `X-Frame-Options DENY`, nosniff.
- Feedback images: JPEG/PNG/WebP magic bytes only, stored on disk, **not**
  served back on the website (no stored XSS).
- Reown Cloud **Allowed domains** must be exactly
  `https://datspiritpoker.com` and `https://www.datspiritpoker.com`.
- Register / login / redeem / join are rate-limited per IP.

## Operator checklist

1. No `TREASURY_*` or Sage RPC certs on this EC2 box.
2. Leave `DAT_TREASURY_PAYOUT_URL` empty on the game host.
3. Accounts file: `data/accounts.json` (or `DAT_ACCOUNTS_PATH`). Ledger:
   `data/ledger.json` (or `DAT_LEDGER_PATH`). Keep mode `600`. Do not delete
   these on redeploy.
4. Read feedback: `ls /var/lib/dat-poker/feedback` (or `data/feedback` if
   `DAT_FEEDBACK_DIR` is unset).
