#!/usr/bin/env python3
"""Compile and run the DAT CAT channel puzzles.

stdin JSON for one spend, or `--self-test` for the puzzle suite.
Requires `clvm` and the `run` compiler from clvm-tools on PATH.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

from clvm import SExp, run_program
from clvm.operators import OPERATOR_LOOKUP
from clvm.serialize import sexp_from_stream

HERE = Path(__file__).resolve().parent
RUN = os.environ.get("CLVM_RUN", "run")
CAT_MOD_HASH = bytes.fromhex(
    "37bef360ee858133b69d595a906dc45d01af50379dad515eb9518abb7c1d2a7a"
)

_COMPILED: dict[str, SExp] = {}


def tree_hash(sexp: SExp) -> bytes:
    if sexp.pair:
        left, right = sexp.pair
        return hashlib.sha256(b"\x02" + tree_hash(left) + tree_hash(right)).digest()
    atom = sexp.atom if sexp.atom is not None else b""
    return hashlib.sha256(b"\x01" + atom).digest()


def compile_puzzle(name: str) -> SExp:
    cached = _COMPILED.get(name)
    if cached is not None:
        return cached
    path = HERE / f"{name}.clsp"
    env = os.environ.copy()
    env["PATH"] = os.path.expanduser("~/.local/bin") + os.pathsep + env.get("PATH", "")
    try:
        hex_out = subprocess.check_output([RUN, "-d", str(path)], text=True, env=env).strip()
    except (OSError, subprocess.CalledProcessError):
        hex_out = (HERE / f"{name}.hex").read_text().strip()
    prog = sexp_from_stream(io.BytesIO(bytes.fromhex(hex_out)), SExp.to)
    _COMPILED[name] = prog
    return prog


def curry(mod: SExp, args: list[SExp]) -> SExp:
    fixed: SExp = SExp.to(1)
    for arg in reversed(args):
        fixed = SExp.to([4, (1, arg), fixed])
    return SExp.to([2, (1, mod), fixed])


def load_cat_mod() -> SExp:
    raw = (HERE / "cat.hex").read_text().strip()
    return sexp_from_stream(io.BytesIO(bytes.fromhex(raw)), SExp.to)


def cat_puzzle_hash(tail: bytes, inner: SExp) -> bytes:
    mod = load_cat_mod()
    curried = curry(mod, [SExp.to(CAT_MOD_HASH), SExp.to(tail), inner])
    return tree_hash(curried)


def as_int(value: int | str) -> int:
    return int(value)


def as_bytes(hex_str: str) -> bytes:
    raw = bytes.fromhex(hex_str)
    if len(raw) == 0:
        raise ValueError("expected hex bytes")
    return raw


def run(puzzle: SExp, solution: SExp) -> SExp:
    _cost, result = run_program(puzzle, solution, OPERATOR_LOOKUP, 11_000_000_000)
    return result


def iter_list(sexp: SExp):
    while sexp.pair is not None:
        yield sexp.first()
        sexp = sexp.rest()


def condition_json(cond: SExp) -> dict:
    parts = list(iter_list(cond))
    if not parts:
        return {"opcode": None}
    opcode = int.from_bytes(parts[0].atom or b"", "big", signed=True)
    out: dict = {"opcode": opcode}
    if opcode in (49, 50) and len(parts) >= 3:
        out["pubkey"] = (parts[1].atom or b"").hex()
        out["message"] = (parts[2].atom or b"").hex()
    elif opcode == 51 and len(parts) >= 3:
        out["puzzleHash"] = (parts[1].atom or b"").hex()
        out["amount"] = str(int.from_bytes(parts[2].atom or b"", "big", signed=True))
    elif opcode in (73, 82) and len(parts) >= 2:
        out["value"] = str(int.from_bytes(parts[1].atom or b"", "big", signed=True))
    return out


def channel_puzzle(curry_args: dict) -> SExp:
    mod = compile_puzzle("dat_channel")
    unroll_hash = tree_hash(compile_puzzle("dat_unroll"))
    return curry(
        mod,
        [
            SExp.to(as_bytes(curry_args["alicePk"])),
            SExp.to(as_bytes(curry_args["bobPk"])),
            SExp.to(as_int(curry_args["timeout"])),
            SExp.to(as_bytes(curry_args["nonce"])),
            SExp.to(unroll_hash),
        ],
    )


def unroll_puzzle(curry_args: dict) -> SExp:
    mod = compile_puzzle("dat_unroll")
    unroll_hash = tree_hash(mod)
    return curry(
        mod,
        [
            SExp.to(as_bytes(curry_args["alicePk"])),
            SExp.to(as_bytes(curry_args["bobPk"])),
            SExp.to(as_int(curry_args["timeout"])),
            SExp.to(as_bytes(curry_args["nonce"])),
            SExp.to(as_int(curry_args["sequence"])),
            SExp.to(as_bytes(curry_args["alicePh"])),
            SExp.to(as_int(curry_args["aliceAmt"])),
            SExp.to(as_bytes(curry_args["bobPh"])),
            SExp.to(as_int(curry_args["bobAmt"])),
            SExp.to(unroll_hash),
        ],
    )


def solution_from(body: dict, fields: list[str]) -> SExp:
    values = []
    for name in fields:
        value = body[name]
        if name.endswith("Ph") or name in ("alicePk", "bobPk"):
            values.append(as_bytes(value))
        else:
            values.append(as_int(value))
    return SExp.to(values)


def spend(payload: dict) -> dict:
    kind = payload["puzzle"]
    try:
        if kind == "channel":
            puzzle = channel_puzzle(payload["curry"])
            solution = solution_from(
                payload["solution"],
                ["mode", "sequence", "alicePh", "aliceAmt", "bobPh", "bobAmt"],
            )
        elif kind == "unroll":
            puzzle = unroll_puzzle(payload["curry"])
            solution = solution_from(
                payload["solution"],
                [
                    "mode",
                    "newSequence",
                    "newAlicePh",
                    "newAliceAmt",
                    "newBobPh",
                    "newBobAmt",
                ],
            )
        else:
            return {"ok": False, "error": f"unknown puzzle {kind}"}
        result = run(puzzle, solution)
        return {"ok": True, "conditions": [condition_json(c) for c in iter_list(result)]}
    except Exception as exc:  # EvalError and input errors
        return {"ok": False, "error": str(exc)}


def expect_ok(result: dict, label: str) -> dict:
    if not result["ok"]:
        raise SystemExit(f"{label} failed: {result['error']}")
    return result


def expect_fail(result: dict, label: str) -> None:
    if result["ok"]:
        raise SystemExit(f"{label} unexpectedly succeeded")


def self_test() -> None:
    alice_pk = bytes(range(48))
    bob_pk = bytes(range(48, 96))
    alice_ph = hashlib.sha256(b"alice-ph").digest()
    bob_ph = hashlib.sha256(b"bob-ph").digest()
    nonce = hashlib.sha256(b"nonce").digest()
    tail = hashlib.sha256(b"dat-tail").digest()
    base = {
        "alicePk": alice_pk.hex(),
        "bobPk": bob_pk.hex(),
        "timeout": 32,
        "nonce": nonce.hex(),
    }
    close = spend(
        {
            "puzzle": "channel",
            "curry": base,
            "solution": {
                "mode": 0,
                "sequence": 0,
                "alicePh": alice_ph.hex(),
                "aliceAmt": 60,
                "bobPh": bob_ph.hex(),
                "bobAmt": 40,
            },
        }
    )
    close = expect_ok(close, "cooperative close")
    opcodes = [c["opcode"] for c in close["conditions"]]
    if opcodes != [50, 50, 73, 51, 51]:
        raise SystemExit(f"close opcodes {opcodes}")
    if close["conditions"][2]["value"] != "100":
        raise SystemExit("close amount")
    if close["conditions"][3]["amount"] != "60" or close["conditions"][4]["amount"] != "40":
        raise SystemExit("close split")
    if close["conditions"][3]["puzzleHash"] != alice_ph.hex():
        raise SystemExit("close pays inner puzzle hash, CAT layer wraps it")

    negative = spend(
        {
            "puzzle": "channel",
            "curry": base,
            "solution": {
                "mode": 0,
                "sequence": 0,
                "alicePh": alice_ph.hex(),
                "aliceAmt": -1,
                "bobPh": bob_ph.hex(),
                "bobAmt": 10,
            },
        }
    )
    expect_fail(negative, "negative close")

    opened = spend(
        {
            "puzzle": "channel",
            "curry": base,
            "solution": {
                "mode": 1,
                "sequence": 0,
                "alicePh": alice_ph.hex(),
                "aliceAmt": 60,
                "bobPh": bob_ph.hex(),
                "bobAmt": 40,
            },
        }
    )
    opened = expect_ok(opened, "open unroll")
    if [c["opcode"] for c in opened["conditions"]] != [49, 49, 73, 51]:
        raise SystemExit("unroll open opcodes")
    unroll_ph = opened["conditions"][3]["puzzleHash"]
    expected = tree_hash(
        unroll_puzzle(
            {
                **base,
                "sequence": 0,
                "alicePh": alice_ph.hex(),
                "aliceAmt": 60,
                "bobPh": bob_ph.hex(),
                "bobAmt": 40,
            }
        )
    ).hex()
    if unroll_ph != expected:
        raise SystemExit("channel unroll puzzle hash does not match curry")

    unroll_curry = {
        **base,
        "sequence": 0,
        "alicePh": alice_ph.hex(),
        "aliceAmt": 60,
        "bobPh": bob_ph.hex(),
        "bobAmt": 40,
    }
    settle = expect_ok(
        spend(
            {
                "puzzle": "unroll",
                "curry": unroll_curry,
                "solution": {
                    "mode": 0,
                    "newSequence": 0,
                    "newAlicePh": alice_ph.hex(),
                    "newAliceAmt": 0,
                    "newBobPh": bob_ph.hex(),
                    "newBobAmt": 0,
                },
            }
        ),
        "settle",
    )
    if settle["conditions"][0] != {"opcode": 82, "value": "32"}:
        raise SystemExit(f"timeout condition {settle['conditions'][0]}")
    if settle["conditions"][2]["amount"] != "60" or settle["conditions"][3]["amount"] != "40":
        raise SystemExit("settle split")

    alice_ph_2 = hashlib.sha256(b"alice-ph-2").digest()
    bob_ph_2 = hashlib.sha256(b"bob-ph-2").digest()
    preempt = expect_ok(
        spend(
            {
                "puzzle": "unroll",
                "curry": unroll_curry,
                "solution": {
                    "mode": 1,
                    "newSequence": 1,
                    "newAlicePh": alice_ph_2.hex(),
                    "newAliceAmt": 10,
                    "newBobPh": bob_ph_2.hex(),
                    "newBobAmt": 90,
                },
            }
        ),
        "preempt",
    )
    if preempt["conditions"][0]["opcode"] != 49:
        raise SystemExit("preempt sig")
    if "82" in [str(c["opcode"]) for c in preempt["conditions"]]:
        raise SystemExit("preempt must not wait for the timeout")
    if preempt["conditions"][3]["amount"] != "100":
        raise SystemExit("preempt keeps the full pot in the new unroll")

    expect_fail(
        spend(
            {
                "puzzle": "unroll",
                "curry": unroll_curry,
                "solution": {
                    "mode": 1,
                    "newSequence": 2,
                    "newAlicePh": alice_ph_2.hex(),
                    "newAliceAmt": 10,
                    "newBobPh": bob_ph_2.hex(),
                    "newBobAmt": 90,
                },
            }
        ),
        "same parity",
    )
    expect_fail(
        spend(
            {
                "puzzle": "unroll",
                "curry": unroll_curry,
                "solution": {
                    "mode": 1,
                    "newSequence": 0,
                    "newAlicePh": alice_ph.hex(),
                    "newAliceAmt": 60,
                    "newBobPh": bob_ph.hex(),
                    "newBobAmt": 40,
                },
            }
        ),
        "not higher",
    )

    inner = channel_puzzle(base)
    wrapped = cat_puzzle_hash(tail, inner)
    if len(wrapped) != 32:
        raise SystemExit("cat hash")
    # Currying the inner hash instead of the puzzle must not collide.
    inner_hash_only = curry(
        load_cat_mod(),
        [SExp.to(CAT_MOD_HASH), SExp.to(tail), SExp.to(tree_hash(inner))],
    )
    if tree_hash(inner_hash_only) == wrapped:
        raise SystemExit("CAT wrap must commit to the inner puzzle, not only its hash")

    print(
        json.dumps(
            {
                "ok": True,
                "closeMessage": close["conditions"][0]["message"],
                "stateMessage": opened["conditions"][0]["message"],
                "catPuzzleHash": wrapped.hex(),
                "channelModHash": tree_hash(compile_puzzle("dat_channel")).hex(),
                "unrollModHash": tree_hash(compile_puzzle("dat_unroll")).hex(),
            }
        )
    )


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        self_test()
        return
    payload = json.load(sys.stdin)
    json.dump(spend(payload), sys.stdout)


if __name__ == "__main__":
    main()
