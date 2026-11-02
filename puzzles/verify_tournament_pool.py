#!/usr/bin/env python3
"""Compile tournament_pool.clsp and check the vectors the TypeScript driver locks.

Requires clvm_tools and chia_rs (pip install clvm_tools). Not part of pnpm test.
"""

from __future__ import annotations

from pathlib import Path

from chia_rs import Program
from clvm_tools.clvmc import compile_clvm_text
from clvm_tools.curry import curry
from stages.stage_0 import run_program

ROOT = Path(__file__).resolve().parent
MOD_HASH = "6e28b139a89c029cd0ea2caf8ee3bd9c08241e4315b336220bacfb9d28540c44"
CURRIED = "0cff93f4dc20021d4718b67c0bd590ab2bfbdaeafc58bfecfb80cca3becd6669"
SPLIT_MESSAGE = "1991982f73476d3bd8e0c02361941ba5baa9f549c6b39ce65526181b609d5cb5"


def main() -> None:
    source = (ROOT / "tournament_pool.clsp").read_text()
    compiled = compile_clvm_text(source, [])
    serialized = compiled.as_bin()
    (ROOT / "tournament_pool.hex").write_text(serialized.hex() + "\n")
    mod_hash = Program.from_bytes(serialized).get_tree_hash().hex()
    if mod_hash != MOD_HASH:
        raise SystemExit(f"mod hash changed: {mod_hash}")

    tid = bytes.fromhex("11" * 32)
    player = bytes.fromhex("22" * 32)
    authorizer = bytes.fromhex("33" * 48)
    args = compiled.to([tid, 1_000_000, player, authorizer, 3600])
    _cost, curried = curry(compiled, args)
    curried_hash = Program.from_bytes(curried.as_bin()).get_tree_hash().hex()
    if curried_hash != CURRIED:
        raise SystemExit(f"curried hash changed: {curried_hash}")

    refund_solution = curried.to([0, []])
    if refund_solution.as_bin().hex() != "ff80ff8080":
        raise SystemExit("refund solution changed")
    run_program(curried, refund_solution, max_cost=11_000_000)

    w1 = bytes.fromhex("aa" * 32)
    w2 = bytes.fromhex("bb" * 32)
    _cost, settled = run_program(
        curried,
        curried.to([1, [(w1, 600_000), (w2, 400_000)]]),
        max_cost=11_000_000,
    )
    message = settled.rest().first().rest().rest().first().as_atom().hex()
    if message != SPLIT_MESSAGE:
        raise SystemExit(f"settle message changed: {message}")

    try:
        run_program(curried, curried.to([1, [(w1, 1)]]), max_cost=11_000_000)
    except Exception:
        pass
    else:
        raise SystemExit("bad sum was accepted")

    print("tournament_pool.clsp ok", mod_hash)


if __name__ == "__main__":
    main()
