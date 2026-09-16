# Beta security (website + Sage)

Closed beta on **https://datspiritpoker.com/**. Goal: testers can pair Sage
without DAT or XCH leaving the wallet, and testers cannot steal each other's
hole cards or table credits.

## What cannot drain Sage

WalletConnect pairing for DAT Poker **only** requests:

- `chia_getAddress`, `chip0002_getPublicKeys`, `chip0002_getAssetBalance`
- `chia_signMessageByAddress`, `chip0002_signMessage`

CHIP-0002 `signMessage` hashes with the `"Chia Signed Message"` prefix, so a
signed login / buy-in / redeem / withdraw **text** cannot be reused as a spend.

The site **does not request** `chia_send`, `chia_createOffer`,
`chia_takeOffer`, or `chip0002_signCoinSpends`. Old sessions that still have
those methods are dropped on page load. On-chain `takeOffer` after withdraw
is disabled on the game host.

Daily redeem and table stacks are **in-memory ledger credits**, not CAT
sends. Treasury Sage stays on a separate machine ([TREASURY.md](./TREASURY.md)).

Testers should still **read Sage prompts**. If Sage ever asks to send coins or
take an offer during this beta, tap reject and report it on `/feedback`.

## Tester identity (signed session)

**Load wallet** asks Sage to sign `dat-poker:v1:session:…`. The API verifies
that CHIP-0002 BLS signature and issues a short-lived bearer token.

- Hole cards are returned only for the seated player who holds that token.
- `playerId` in join / action / redeem / withdraw is taken from the token,
  not from the JSON body. Spoofing someone else's Chia address does nothing.
- Table credits are keyed by the verified wallet public key, not a guessed
  `xch1…` string.
- A Chia address can bind to one public key for the life of the API process.

`DAT_ALLOW_DEV_BUYIN=true` still skips on-chain CAT checks so the table works
without a configured asset id. It does **not** skip the login signature.
That flag does not move on-chain DAT.

## Website controls

- HTTPS via Caddy; HTTP-only IP will not pair Sage.
- Content-Security-Policy, `X-Frame-Options DENY`, nosniff.
- Feedback images: JPEG/PNG/WebP magic bytes only, stored on disk, **not**
  served back on the website (no stored XSS).
- Reown Cloud **Allowed domains** must be exactly
  `https://datspiritpoker.com` and `https://www.datspiritpoker.com`.
- Redeem / join / login are rate-limited per IP.

## Operator checklist

1. No `TREASURY_*` or Sage RPC certs on this EC2 box.
2. Leave `DAT_TREASURY_PAYOUT_URL` empty on the game host.
3. After pairing changes, testers should **Disconnect** in Sage and scan a
   new QR so old spend permissions are gone. Then **Load wallet** again to
   sign a login (API restart also drops tokens, same as in-memory tables).
4. Read feedback: `ls /var/lib/dat-poker/feedback` (or `data/feedback` if
   `DAT_FEEDBACK_DIR` is unset).
