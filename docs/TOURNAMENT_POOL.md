# Tournament pool coin

Sit-and-gos and multi-table tournaments lock **one DAT CAT per entry**. The inner puzzle is [`puzzles/tournament_pool.clsp`](../puzzles/tournament_pool.clsp).

Compiled mod hash:

```text
6e28b139a89c029cd0ea2caf8ee3bd9c08241e4315b336220bacfb9d28540c44
```

Cash and ring games stay on the treasury-offer path in [TREASURY.md](./TREASURY.md). This puzzle is a one-shot entry coin, not a table that pays players out as they leave.

## Why it is not one growing coin

DAT is a CAT. A CAT parent cannot create children worth more than its own amount unless a CAT ring balances the difference. The pool is the **set** of entry coins that share a tournament id. Prize-pool mojos are `entries × buy-in`.

Each coin is curried with:

| Parameter | Role |
|-----------|------|
| `TOURNAMENT_ID` | sha256 of the off-chain tournament id |
| `BUY_IN` | exact CAT mojos |
| `PLAYER_PUZZLE_HASH` | wallet puzzle hash from the player's `xch1` / `txch1` address; refunds go here |
| `AUTHORIZER_PK` | operator BLS key (`TOURNAMENT_AUTHORIZER_PUBLIC_KEY`) |
| `REFUND_AFTER_SECONDS` | permissionless refund delay from the coin's birth |

`ASSERT_MY_AMOUNT` binds the coin to `BUY_IN`, so a smaller or larger CAT cannot be spent as that entry.

## Wallet signature to join

Joining is two signatures:

1. **Entry.** Sage signs `dat-poker:v1:tournament-join:{tournamentId}:{address}:{puzzleHash}:{buyInMojos}:pool_coin`. The API derives the puzzle hash from the address and records the entry as `awaiting_lock`. Nothing is debited from the site ledger.
2. **Coin id.** The player spends a DAT CAT of exactly the buy-in whose **inner** puzzle hash is the curried pool puzzle (the API returns that hash and, when `DAT_GOVERNANCE_TOKEN_ASSET_ID` is set, the CAT v2 outer puzzle hash). They sign `dat-poker:v1:tournament-lock:{tournamentId}:{entryId}:{coinId}` and the API marks the entry `locked`.

The on-chain spend is not broadcast by the API. The coin id is the player's claim that the lock exists. The settle and refund responses are the CLVM solutions and the `AGG_SIG_ME` message the authorizer must sign.

## Free site DAT redeems

Site DAT is a **promotional ledger inside the API**. It is not a CAT, so it cannot sit in the pool puzzle.

- Enable with `DAT_ALLOW_SITE_REDEEM=true`. Default is off.
- The player signs `dat-poker:v1:site-dat-redeem:{address}:{amountMojos}:{nonce}`.
- Caps: `DAT_SITE_REDEEM_MAX_MOJOS` per call (default 100 DAT) and `DAT_SITE_REDEEM_CAP_MOJOS` per address (default 1000 DAT).
- Joining with `custody: "site_ledger"` debits that balance and seats the player immediately. There is no inner puzzle hash and no coin id.
- Cancel credits the buy-in back. Settlement credits whatever share of the prize is paid from site collateral.

Leave the faucet off on a public host. Redeem and join signatures are required and bound to the server message, and they are not BLS-verified yet (same as cash-game buy-in proofs).

## Settlement

`POST /v1/tournaments/:id/settle` takes a finish order (one address per payout place) or an explicit prize list. Prizes must equal locked pool coins plus site-ledger entries.

Collateral is spent in that order:

1. Pool coins pay the front of the prize list. The driver slices prizes so **each coin's outputs sum to its buy-in**, which is what the puzzle enforces (`mode` 1, at most 16 outputs).
2. Remaining prizes are credited to the site ledger, including a prize that straddles the two rails.

Odd mojos from integer percentage splits go to first place. The authorizer message for each coin is the tree hash of:

```text
("DAT_POKER_TOURNAMENT_SETTLE" tournament_id player_puzzle_hash payouts)
```

`AGG_SIG_ME` also binds the coin id. A signature for one entry cannot be replayed onto another.

## Refunds

`POST /v1/tournaments/:id/cancel` returns site DAT immediately. For each locked coin it returns:

- **Timeout refund** (`mode` 0). After `REFUND_AFTER_SECONDS`, anyone can spend the coin back to `PLAYER_PUZZLE_HASH`. No authorizer key.
- **Immediate refund** (`mode` 1). The authorizer signs a single output of the full buy-in to the same puzzle hash.

## What is still off-chain

Blinds, seating, and the final standings stay in the game server. This coin locks the buy-in and pays the signed prize list. It does not shuffle the deck. Cash-game withdraws still use treasury offers.
