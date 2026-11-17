# Chia Cloud Wallet withdraw (operators only)

This document is for **server operators**, not for the public website. Players should not see OAuth registration steps in the UI.

Treasury **Sage** still builds the DAT offer. **Chia Cloud Wallet** is only where that offer is delivered.

## Register the OAuth app

In Chia Cloud Wallet → **Settings → OAuth Apps**. New apps may stay pending until Cloud Wallet approves them.

Production redirect URI (exact):

`https://datspiritpoker.com/v1/wallet/cloud/callback`

Scopes: `wallet.read`, `offer.read`, `offer.accept`, `offline_access`

On the API host set `CHIA_CLOUD_WALLET_CLIENT_ID`. Add `CHIA_CLOUD_WALLET_CLIENT_SECRET` only if the portal issued one (server only).

Until the client id is set and approved, the web app **hides** the Cloud Wallet withdraw panel (`configured: false` on `GET /v1/wallet/cloud`).

See [TREASURY.md](./TREASURY.md) for Sage payout offer creation.