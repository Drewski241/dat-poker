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
those methods are dropped on page load. After treasury builds a withdraw
`offer1…` string, copy it and import it in player Sage (Offers → Import).
WalletConnect Accept (`chia_takeOffer`) submits a take that mempool-conflicts
with import. Treasury already attached the XCH fee on `make_offer`
(`TREASURY_PAYOUT_FEE_MOJOS`).

Daily redeem and table stacks are **ledger credits**, not CAT sends. Account
DAT is stored on the game host (`data/ledger.json`) so a redeploy does not
wipe testers’ balances or play-through unlocks. Open tables still reset.
Treasury HTTP (`dat-poker-treasury`) runs on this website host
([TREASURY.md](./TREASURY.md)). Player Sage stays on the tester's device.

Testers should still **read Sage prompts**. Accept an offer only when you just
clicked withdraw and the site asked Sage to take the treasury DAT offer. If a
previous Accept is still pending, wait — tapping Accept again on the old offer
causes a mempool conflict. If Sage asks to send coins, tap reject and report it
on `/feedback`.

## Accounts

Play uses a username + password account (`POST /v1/auth/register` /
`/v1/auth/login`). Passwords are scrypt-hashed. Usernames persist on the
game host (`data/accounts.json`). A forgotten password can be reset with the
**username plus the email on the account** (`POST /v1/auth/password/forgot`
then `/reset`). This beta has no mailer, so a matching request returns a
15-minute one-time code in the response. Wrong pairs get no code. Signed-in
players can change a password they still know (`POST /v1/auth/password/change`).
In-game DAT balances persist in
`data/ledger.json`. Open tables still reset when the API restarts; seated
stacks are returned to the account ledger on a clean shutdown. Play-through
(one completed hand unlocks 1 DAT of the buy-in) is stored on that ledger too,
so already-unlocked DAT stays withdrawable after a redeploy.

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

1. Keep `dat-poker-treasury` enabled while the website is up. Bind it to
   `127.0.0.1:4200` (`DAT_TREASURY_PAYOUT_URL=http://127.0.0.1:4200/payout`).
   Do not expose `:4200` or Sage RPC `:9257` on the public security group.
2. Player Sage stays off this box. Treasury Sage on this host is a dedicated
   spend key in `.env` (`TREASURY_SAGE_PRIVATE_KEY` or `TREASURY_SAGE_MNEMONIC`,
   mode `640`). Load or rotate it with `deploy/aws-ec2/load-treasury-key.sh`
   (file or silent TTY — do not paste the secret into chat).
   `TREASURY_WALLET_KEY_PATH` / `wallet.key` is only the RPC TLS cert.
   Optional `TREASURY_SAGE_FINGERPRINT` / `TREASURY_XCH_ADDRESS`.
3. Accounts file: `data/accounts.json` (or `DAT_ACCOUNTS_PATH`). Ledger:
   `data/ledger.json` (or `DAT_LEDGER_PATH`). Keep mode `600`. Do not delete
   these on redeploy.
4. Read feedback: `ls /var/lib/dat-poker/feedback` (or `data/feedback` if
   `DAT_FEEDBACK_DIR` is unset).
