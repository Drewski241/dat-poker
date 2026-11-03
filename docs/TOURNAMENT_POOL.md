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

## Field size

Sit-and-gos are 8-player or 16-player. The API rejects any other size. A sit-and-go settles only when every seat is paid.

Multi-table tournaments take any field from 2 players up. There is no product cap at 18 or 500. The process stops accepting entries at 100,000 so one tournament cannot grow without a bound. The registration screen calls that an open tournament. Payouts use the number of paid entries at settle time, not the cap. A tournament settles once at least two entries are paid.

## Payouts

Paid places are the top 20% of that field, and at least one place is always paid. `round(field × 0.2)` uses integer half-up rounding. Place weights are `places, places − 1, …, 1`, scaled to 10,000 basis points, with leftover points added to first.

| Field | Paid places | Basis points |
|-------|-------------|--------------|
| 2–7 | 1 | 10000 |
| 8 (sit-and-go) | 2 | 6667 / 3333 |
| 16 (sit-and-go) | 3 | 5001 / 3333 / 1666 |
| 100 | 20 | linear, 20 weights |

A sit-and-go shows the table for its full field as soon as it is created. An open tournament shows the table for the current paid field, and shows “top 20% at settle” before anyone has entered. The table is not chosen at create.

Odd mojos from the integer split go to first place.

## One player, no other testers

`POST /v1/tournaments/:id/fill-house` seats the operator in the empty chairs. On a sit-and-go it fills every remaining seat. On a tournament the body is `{ "seats": N }` and it adds that many seats (default 1). It does not fill an open tournament up to 100,000.

A house seat is collateral the operator is fronting. It is not a wallet signature, not a DAT CAT, and not a site-ledger debit. Cancel does not credit it. Settlement does not credit it either: that share stays with the operator.

`POST /v1/tournaments/:id/settle` with `{ "playerWinsAddress": "<xch1…>" }` places that paid player first, then any other real entries, then the house, and keeps only the paid places. The real pool coin is spent to the winner. First place is larger than one buy-in, so the coin’s solution is a single output of the buy-in and the rest of first place is a site-ledger credit. House puzzle hashes are `sha256` of `dat-poker:house:{id}:{index}`. They are not wallet hashes, so a finish order that puts the house first would aim a CAT at an address nobody can spend. Use the test payout, which puts the real player first.

The puzzle still allows at most 16 outputs on one coin. An 8-max, a 16-max, and a 100-player field paid entirely with pool coins stay inside that limit. A solo test with one real coin and house collateral uses one output on that coin.

## Settlement

`POST /v1/tournaments/:id/settle` takes a finish order (one address per paid place), `playerWinsAddress` for the solo test, or an explicit prize list. Prizes must equal locked pool coins plus site-ledger entries plus house collateral.

Collateral is spent in that order:

1. Pool coins pay the front of the prize list. The driver slices prizes so **each coin's outputs sum to its buy-in**, which is what the puzzle enforces (`mode` 1, at most 16 outputs).
2. Remaining prizes are credited to the site ledger, including a prize that straddles the two rails.

The authorizer message for each coin is the tree hash of:

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
