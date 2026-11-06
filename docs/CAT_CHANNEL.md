# Heads-up DAT channel

Heads-up tables can lock the pot in a DAT CAT. The CAT's inner puzzle is a 2-of-2 channel. Poker rules stay in the game engine. The chain only enforces the signed balances.

chia-gaming still stakes XCH. This channel is ours until an upstream CAT channel can replace the inner puzzle. The game engine does not need to change when that happens.

## What the puzzle allows

The inner puzzle is `packages/chia-bridge/puzzles/dat_channel.clsp`.

- **Cooperative close.** Both players produce an `AGG_SIG_ME` over the payout message, bound to this coin id and genesis. The coin splits into two CAT children aimed at the players' ordinary inner puzzle hashes.
- **Unroll.** Either player spends the channel to an unroll coin for a balance both already signed (`AGG_SIG_UNSAFE`, with the channel nonce inside the message). `dat_unroll.clsp` pays that balance after `TIMEOUT` blocks.
- **Preempt.** A later state with the opposite sequence parity replaces a published unroll immediately. Same-parity and older states are rejected, so the player who published the stale state cannot roll it forward to another stale state they fully signed.

Even sequences are fully held by Bob. Odd sequences are fully held by Alice. The opening balance is sequence 0.

XCH pays the mempool fee. It is not part of the pot.

## Local test (one person vs house)

Set `DAT_CAT_CHANNEL_TEST=true` on the API. The web button **Play test channel vs house** generates a BLS key in the browser and a house key in the API process. The house key is memory-only. Both keys sign each balance. This is a real 2-of-2: the API cannot invent a balance the browser key did not sign, and the browser cannot move the house's share.

The CAT puzzle hash shown in the panel is the address that must be funded before the coin exists. Until you spend a real DAT parent into it, the coin id is marked simulated. Close signatures use that id, so replace the parent (pass `parentCoinId` to open) before broadcasting a mainnet close.

Funding the coin still needs a normal CAT spend to that puzzle hash (Sage or a wallet RPC). The channel code checks the inner puzzle. It does not push the funding transaction.

```bash
python3 -m pip install --user -r packages/chia-bridge/puzzles/requirements.txt
export PATH="$HOME/.local/bin:$PATH"
export DAT_CAT_CHANNEL_TEST=true
pnpm dev:api
pnpm dev:web
```

On the existing EC2 beta host, Session Manager:

```bash
sudo bash -c 'export DAT_POKER_REPO_REF=cursor/cat-channel-heads-up-11a7; curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/cat-channel-heads-up-11a7/deploy/aws-ec2/up.sh" | bash'
```

That sets `DAT_CAT_CHANNEL_TEST=true`, rebuilds, and restarts the API. Open `/` and use **Play test channel vs house**.

Puzzle checks:

```bash
pnpm --filter @dat-poker/chia-bridge test
pnpm --filter @dat-poker/api test
```

## Signature bytes

State updates sign the 32-byte tree hash with Chia `AugSchemeMPL` (no coin id). That matches `AGG_SIG_UNSAFE`.

Cooperative close signs `close_hash || coin_id || genesis`. That matches `AGG_SIG_ME`.

`coin_id` is `sha256(parent || cat_puzzle_hash || amount_u64_be)`. `amount` is the sum of the two buy-ins.
