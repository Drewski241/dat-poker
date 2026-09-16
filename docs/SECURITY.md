# Beta security (website + Sage)

Closed beta on **https://datspiritpoker.com/**. Goal: testers can pair Sage
without DAT or XCH leaving the wallet, and operators do not put treasury keys
on the game host.

## What cannot drain Sage

WalletConnect pairing for DAT Poker **only** requests:

- `chia_getAddress`, `chip0002_getPublicKeys`, `chip0002_getAssetBalance`
- `chia_signMessageByAddress`, `chip0002_signMessage`

CHIP-0002 `signMessage` hashes with the `"Chia Signed Message"` prefix, so a
signed buy-in / redeem / withdraw **text** cannot be reused as a spend.

The site **does not request** `chia_send`, `chia_createOffer`,
`chia_takeOffer`, or `chip0002_signCoinSpends`. Old sessions that still have
those methods are dropped on page load. On-chain `takeOffer` after withdraw
is disabled on the game host.

Daily redeem and table stacks are **in-memory ledger credits**, not CAT
sends. Treasury Sage stays on a separate machine ([TREASURY.md](./TREASURY.md)).

Testers should still **read Sage prompts**. If Sage ever asks to send coins or
take an offer during this beta, tap reject and report it on `/feedback`.

## What testers should still know

In-game seats use the Chia address as `playerId` **without a login cookie**.
A closed invite list is the current control. Hole cards on `GET /v1/tables`
can leak if someone knows your address and table id. Keep the tester group
small. Cryptographic session binding is the next hardening step.

`DAT_ALLOW_DEV_BUYIN=true` on the public host lets the table work without a
verified Sage signature. That does not move on-chain DAT.

## Website controls

- HTTPS via Caddy; HTTP-only IP will not pair Sage.
- Content-Security-Policy, `X-Frame-Options DENY`, nosniff.
- Feedback images: JPEG/PNG/WebP magic bytes only, stored on disk, **not**
  served back on the website (no stored XSS).
- Reown Cloud **Allowed domains** must be exactly
  `https://datspiritpoker.com` and `https://www.datspiritpoker.com`.

## Operator checklist

1. No `TREASURY_*` or Sage RPC certs on this EC2 box.
2. Leave `DAT_TREASURY_PAYOUT_URL` empty on the game host.
3. After pairing changes, testers should **Disconnect** in Sage and scan a
   new QR so old spend permissions are gone.
4. Read feedback: `ls /var/lib/dat-poker/feedback` (or `data/feedback` if
   `DAT_FEEDBACK_DIR` is unset).
