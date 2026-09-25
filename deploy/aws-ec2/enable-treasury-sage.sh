#!/bin/bash
# Wire Sage RPC on the AWS website host so treasury can build real DAT offers.
# Treasury HTTP can be up while wallet.crt is missing — that is this 400.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_FINGERPRINT=1234567890 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_CREATE_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_LOAD_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
#   sudo TREASURY_SAGE_PRIVATE_KEY_FILE=/root/treasury.hex bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh
#   sudo SAGE_PASTE_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_PRIVATE_KEY=hex_or_secret bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_MNEMONIC='word word …' bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_INSTALL=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_RELEASE_OFFERS=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#
# SAGE_INSTALL copies the prebuilt sage-cli shipped in this repo. Do not compile
# on the t3.small — cargo fills the 20 GB root volume.
# SAGE_COMPILE=1 is an emergency fallback only (needs ~15 GB free).
#
# Do not expose :9257. Import a dedicated treasury key (not the player Sage).
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/.env}"
SAGE_USER="${SAGE_USER:-ec2-user}"
SAGE_HOME="$(getent passwd "$SAGE_USER" | cut -d: -f6)"
SAGE_HOME="${SAGE_HOME:-/home/ec2-user}"
SAGE_DATA="${SAGE_HOME}/.local/share/sage"
SAGE_SSL="${SAGE_DATA}/ssl"
SAGE_VERSION="${SAGE_VERSION:-v0.13.1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — run bootstrap first" >&2
  exit 1
fi

set_kv() {
  local key="$1" val="$2"
  python3 -c '
from pathlib import Path
import sys
path, key, val = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = path.read_text().splitlines() if path.exists() else []
out, found = [], False
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={val}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={val}")
path.write_text("\n".join(out) + ("\n" if out else ""))
' "$ENV_FILE" "$key" "$val"
}

read_env_kv() {
  python3 -c '
from pathlib import Path
import sys

def parse_env(path: Path) -> dict[str, str]:
    data = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in (chr(34), chr(39)):
            val = val[1:-1]
        data[key] = val
    return data

print(parse_env(Path(sys.argv[1])).get(sys.argv[2], ""), end="")
' "$ENV_FILE" "$1"
}

apply_treasury_secret() {
  local secret="$1" hex_compact words
  secret="$(printf '%s' "$secret" | tr -d '\r' | tr '\n' ' ')"
  secret="${secret#"${secret%%[![:space:]]*}"}"
  secret="${secret%"${secret##*[![:space:]]}"}"
  if [[ -z "$secret" ]]; then
    echo "empty treasury spend key" >&2
    return 1
  fi
  hex_compact="$(printf '%s' "$secret" | tr -d '[:space:]')"
  if [[ "$hex_compact" =~ ^[0-9a-fA-F]{64}$ || "$hex_compact" =~ ^0[xX][0-9a-fA-F]{64}$ ]]; then
    secret="$hex_compact"
    if [[ "$secret" =~ ^0[xX] ]]; then
      secret="${secret:2}"
    fi
    TREASURY_SAGE_PRIVATE_KEY="$secret"
    TREASURY_SAGE_MNEMONIC=""
    set_kv TREASURY_SAGE_PRIVATE_KEY "$secret"
    set_kv TREASURY_SAGE_MNEMONIC ""
    echo "Wrote TREASURY_SAGE_PRIVATE_KEY to $ENV_FILE (${#secret} hex chars)."
    return 0
  fi
  words="$(printf '%s' "$secret" | wc -w)"
  if [[ "$words" -eq 12 || "$words" -eq 24 ]]; then
    TREASURY_SAGE_MNEMONIC="$secret"
    TREASURY_SAGE_PRIVATE_KEY=""
    set_kv TREASURY_SAGE_MNEMONIC "$secret"
    set_kv TREASURY_SAGE_PRIVATE_KEY ""
    echo "Wrote TREASURY_SAGE_MNEMONIC to $ENV_FILE ($words words)."
    return 0
  fi
  echo "That value is ${#secret} chars / $words words. Sage needs 64 hex chars or 12/24 words." >&2
  echo "An xch1 address or wallet.key path will not work." >&2
  return 1
}

load_treasury_secret_from_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "missing TREASURY_SAGE_PRIVATE_KEY_FILE: $file" >&2
    return 1
  fi
  echo "Loading treasury spend key from $file (value is not printed)."
  apply_treasury_secret "$(tr -d '\r' < "$file")"
}

paste_treasury_secret() {
  local secret
  echo "Paste the dedicated treasury Sage secret key (64 hex chars) or a 12/24-word mnemonic."
  if [[ "${SAGE_LOAD_KEY:-}" == "1" ]]; then
    echo "This replaces the spend key Sage is using now. Fund the new address after it prints."
  fi
  echo "It will not echo. Press Enter when done. Do not paste it into chat."
  if [[ -r /dev/tty ]]; then
    read -r -s -p "Treasury spend key: " secret </dev/tty
    echo >/dev/tty
  else
    read -r -s -p "Treasury spend key: " secret
    echo
  fi
  apply_treasury_secret "$secret"
}

load_or_replace_treasury_secret() {
  if [[ -n "${TREASURY_SAGE_PRIVATE_KEY_FILE:-}" ]]; then
    load_treasury_secret_from_file "$TREASURY_SAGE_PRIVATE_KEY_FILE"
    return
  fi
  if [[ -n "${CLI_TREASURY_PRIVATE_KEY:-}" ]]; then
    echo "Loading treasury spend key from the command-line environment (value is not printed)."
    apply_treasury_secret "$CLI_TREASURY_PRIVATE_KEY"
    return
  fi
  if [[ -n "${CLI_TREASURY_MNEMONIC:-}" ]]; then
    echo "Loading treasury mnemonic from the command-line environment (value is not printed)."
    apply_treasury_secret "$CLI_TREASURY_MNEMONIC"
    return
  fi
  if [[ "${SAGE_PASTE_KEY:-}" == "1" || -r /dev/tty ]]; then
    paste_treasury_secret
    return
  fi
  echo "SAGE_LOAD_KEY=1 needs a key file, a TTY paste, or TREASURY_SAGE_PRIVATE_KEY on the command line." >&2
  echo "  sudo TREASURY_SAGE_PRIVATE_KEY_FILE=/root/treasury.hex bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh" >&2
  echo "Do not paste the secret into chat." >&2
  return 1
}

delete_old_treasury_key() {
  local old="$1"
  if [[ "${SAGE_KEEP_OLD_KEY:-}" == "1" ]]; then
    echo "Keeping previous Sage fingerprint $old (SAGE_KEEP_OLD_KEY=1)."
    return 0
  fi
  if ! is_u32_fingerprint "$old"; then
    return 0
  fi
  echo "Removing previous Sage fingerprint $old from this host."
  if sage_rpc delete_key "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"fingerprint": int(sys.argv[1])}))' "$old")"; then
    echo "Deleted previous fingerprint $old."
  else
    echo "Could not delete previous fingerprint $old. Login uses the new key; remove the old one in Sage if it is still listed." >&2
  fi
}

describe_env_secret() {
  python3 -c '
from pathlib import Path
import string
import sys

path = Path(sys.argv[1])
wanted = [
    "TREASURY_SAGE_PRIVATE_KEY",
    "TREASURY_SAGE_SECRET_KEY",
    "TREASURY_SAGE_MNEMONIC",
]
text = path.read_text(encoding="utf-8-sig") if path.exists() else ""
found = []
names = []
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        continue
    key, val = line.split("=", 1)
    key = key.strip()
    val = val.strip().strip(chr(34) + chr(39))
    if key.startswith("TREASURY_"):
        names.append(key)
    if key not in wanted or not val:
        continue
    hexpart = val[2:] if val.lower().startswith("0x") else val
    words = val.split()
    if all(c in string.hexdigits for c in hexpart) and len(hexpart) == 64:
        kind = "bls-secret-hex"
    elif all(c in string.hexdigits for c in hexpart) and len(hexpart) == 96:
        kind = "public-key-hex-cannot-sign"
    elif len(words) in (12, 24):
        kind = "mnemonic"
    else:
        kind = "not-a-sage-secret"
    found.append(f"{key} is set ({len(val)} chars, looks like {kind})")
if found:
    print(" ; ".join(found))
else:
    listed = ", ".join(names) if names else "(none)"
    print(f"no TREASURY_SAGE_PRIVATE_KEY / TREASURY_SAGE_MNEMONIC in {path}. TREASURY_* names: {listed}")
' "$ENV_FILE"
}

find_certs() {
  local dir
  for dir in \
    "$SAGE_SSL" \
    "${SAGE_HOME}/.local/share/com.rigidnetwork.sage/ssl" \
    /opt/dat-poker/data/sage/ssl \
    /opt/sage/ssl \
    /var/lib/sage/ssl \
    /root/.local/share/sage/ssl
  do
    if [[ -f "$dir/wallet.crt" && -f "$dir/wallet.key" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
  done
  return 1
}

sage_runs() {
  local bin="$1"
  [[ -n "$bin" && -x "$bin" ]] || return 1
  "$bin" --help >/dev/null 2>&1
}

find_sage_bin() {
  local bin
  for bin in \
    "${SAGE_BIN:-}" \
    /usr/local/bin/sage \
    /usr/bin/sage \
    "${SAGE_HOME}/.cargo/bin/sage"
  do
    if sage_runs "$bin"; then
      printf '%s\n' "$bin"
      return 0
    fi
  done
  return 1
}

free_sage_build_space() {
  echo "Freeing leftover sage-cli compile files (they filled the disk)…"
  rm -rf /tmp/cargo-install* /tmp/cargo-installfFFTDp /tmp/sage-target /tmp/sage-cargo /tmp/sage-prefix
  rm -rf "${SAGE_HOME}/.cargo/registry" "${SAGE_HOME}/.cargo/git"
  rm -rf /root/.cargo/registry /root/.cargo/git
  df -h / /tmp || true
}

install_prebuilt_sage_cli() {
  local prebuilt="$INSTALL_ROOT/deploy/aws-ec2/bin/sage-linux-x86_64"
  if [[ ! -f "$prebuilt" ]]; then
    return 1
  fi
  echo "Installing prebuilt sage-cli ${SAGE_VERSION} from $prebuilt"
  install -m 0755 "$prebuilt" /usr/local/bin/sage
  if ! sage_runs /usr/local/bin/sage; then
    echo "prebuilt sage-cli cannot run on this host:" >&2
    /usr/local/bin/sage --help >&2 || true
    echo "This binary must be built for Amazon Linux 2023 (glibc 2.34)." >&2
    echo "Redeploy this branch, then re-run: sudo SAGE_INSTALL=1 bash $0" >&2
    return 1
  fi
  echo "sage-cli installed at /usr/local/bin/sage"
}

install_c_toolchain() {
  if command -v cc >/dev/null 2>&1 && command -v cmake >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing a C toolchain (Amazon Linux has no cc by default)…"
  dnf install -y gcc gcc-c++ make cmake openssl-devel clang perl pkgconf-pkg-config git
  if ! command -v cc >/dev/null 2>&1; then
    echo "cc is still missing after dnf install. Sage-cli cannot compile." >&2
    exit 1
  fi
}

install_sage_cli() {
  free_sage_build_space
  if install_prebuilt_sage_cli; then
    return 0
  fi
  if [[ "${SAGE_COMPILE:-}" != "1" ]]; then
    echo "Prebuilt sage-cli is missing. Redeploy this branch, then re-run:" >&2
    echo "  sudo SAGE_INSTALL=1 bash $0" >&2
    echo "Do not compile on this 20 GB host (cargo fills the disk)." >&2
    echo "Emergency only: sudo SAGE_INSTALL=1 SAGE_COMPILE=1 bash $0" >&2
    exit 1
  fi
  local avail_kb
  avail_kb="$(df -Pk /tmp | awk 'NR==2 {print $4}')"
  if [[ "${avail_kb:-0}" -lt 15000000 ]]; then
    echo "/tmp has less than 15 GB free. cargo install will fail with ENOSPC." >&2
    echo "Grow the EBS volume or use the prebuilt binary from this repo." >&2
    df -h / /tmp >&2 || true
    exit 1
  fi
  echo "Installing sage-cli ${SAGE_VERSION} as ${SAGE_USER} (Rust compile — can take a while)…"
  install_c_toolchain
  if ! command -v rustc >/dev/null 2>&1 && [[ ! -x "${SAGE_HOME}/.cargo/bin/rustc" ]]; then
    sudo -u "$SAGE_USER" -H bash -lc \
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal'
  fi
  sudo -u "$SAGE_USER" -H bash -lc \
    "source \"\$HOME/.cargo/env\" && cargo install --git https://github.com/xch-dev/sage --tag ${SAGE_VERSION} sage-cli"
  if [[ -x "${SAGE_HOME}/.cargo/bin/sage" && ! -e /usr/local/bin/sage ]]; then
    ln -s "${SAGE_HOME}/.cargo/bin/sage" /usr/local/bin/sage
  fi
}

is_u32_fingerprint() {
  python3 -c 'import sys
raw=sys.argv[1].strip()
if not raw.isdigit():
    raise SystemExit(1)
n=int(raw)
raise SystemExit(0 if 0 <= n <= 0xFFFFFFFF else 1)
' "${1:-}"
}

looks_like_secret_key() {
  python3 -c 'import sys
raw=sys.argv[1].strip()
if raw.lower().startswith("0x"):
    raw=raw[2:]
raise SystemExit(0 if len(raw)==64 and all(c in "0123456789abcdefABCDEF" for c in raw) else 1)
' "${1:-}"
}

sage_rpc() {
  local method="$1"
  local body="${2:-{}}"
  local bin
  # sage-cli serde rejects a trailing newline or extra "}".
  body="$(printf '%s' "$body" | tr -d '\r\n')"
  body="$(python3 -c 'import json,sys
raw=sys.argv[1]
data=json.loads(raw)
sys.stdout.write(json.dumps(data, separators=(",", ":")))
' "$body")" || {
    echo "sage rpc body is not valid JSON (not printed)" >&2
    return 1
  }
  bin="$(find_sage_bin)" || {
    echo "sage-cli is not installed" >&2
    return 1
  }
  sudo -u "$SAGE_USER" -H "$bin" rpc "$method" "$body"
}

build_import_key_body() {
  TREASURY_IMPORT_KEY="$1" python3 -c '
import json, os, sys
key = os.environ.get("TREASURY_IMPORT_KEY", "")
body = json.dumps(
    {"name": "treasury", "key": key, "save_secrets": True, "login": True},
    separators=(",", ":"),
)
parsed = json.loads(body)
if body.count("{") != 1 or body.count("}") != 1 or not body.endswith("}"):
    sys.stderr.write("import_key JSON brace mismatch\n")
    raise SystemExit(1)
if parsed.get("key") != key or parsed.get("name") != "treasury":
    raise SystemExit(1)
sys.stdout.write(body)
'
}

release_open_sage_offers() {
  echo "Cancelling pending/active Sage offers on-chain (invalidates leftover offer1):"
  local listed ids offer_id fee
  fee="$(read_env_kv TREASURY_PAYOUT_FEE_MOJOS || true)"
  if [[ -z "$fee" || "$fee" == "0" || ! "$fee" =~ ^[0-9]+$ ]]; then
    fee=1000000
  fi
  listed="$(sage_rpc get_offers '{}' || true)"
  ids="$(printf '%s' "$listed" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    raise SystemExit(0)
for offer in data.get("offers") or []:
    status = str(offer.get("status") or "").strip().lower()
    offer_id = offer.get("offer_id") or offer.get("offerId")
    if offer_id and status in ("pending", "active", "0", "1"):
        print(offer_id)
')"
  if [[ -z "$ids" ]]; then
    echo "No pending/active Sage offers to cancel."
    return 0
  fi
  while IFS= read -r offer_id; do
    [[ -z "$offer_id" ]] && continue
    echo "cancel_offer ${offer_id:0:12}… fee=${fee} (XCH mojos) auto_submit=true"
    sage_rpc cancel_offer "$(python3 -c 'import json,sys; sys.stdout.write(json.dumps({"offer_id": sys.argv[1], "fee": sys.argv[2], "auto_submit": True}))' "$offer_id" "$fee")" || true
  done <<< "$ids"
  echo "Wait 1–2 minutes before withdrawing again. Do not Accept the old offer."
}

json_field() {
  python3 -c 'import json,sys
raw=sys.stdin.read()
try:
  data=json.loads(raw)
except Exception:
  sys.exit(1)
key=sys.argv[1]
val=data.get(key)
if val is None:
  sys.exit(1)
if isinstance(val, (dict, list)):
  json.dump(val, sys.stdout)
else:
  print(val)
' "$1"
}

list_fingerprints() {
  sage_rpc get_keys '{}' 2>/dev/null | python3 -c 'import json,sys
try:
  data=json.loads(sys.stdin.read())
except Exception:
  sys.exit(0)
for key in data.get("keys") or []:
  fp=key.get("fingerprint")
  if fp is not None:
    print(fp)
'
}

ensure_sage_rpc_running() {
  if ! find_sage_bin >/dev/null; then
    return 1
  fi
  if ! systemctl is-active --quiet dat-poker-sage-rpc; then
    start_sage_rpc || true
  fi
  local i
  for i in $(seq 1 20); do
    if sage_rpc get_keys '{}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Sage RPC is not answering get_keys. Check: sudo systemctl status dat-poker-sage-rpc" >&2
  return 1
}

import_treasury_key() {
  local secret="$1"
  local out fingerprint body
  echo "Importing dedicated treasury spend key from env into Sage RPC…"
  body="$(build_import_key_body "$secret")" || {
    echo "import_key JSON was not valid (secret is not printed). Is Sage RPC up?" >&2
    return 1
  }
  out="$(sage_rpc import_key "$body")"
  fingerprint="$(printf '%s\n' "$out" | json_field fingerprint)" || {
    echo "import_key failed (do not paste the private key into chat). Is Sage RPC up?" >&2
    printf '%s\n' "$out" | python3 -c 'import json,sys
try:
  data=json.loads(sys.stdin.read())
  print(data.get("error") or data)
except Exception:
  print("Sage import_key returned a non-JSON error")
' >&2
    return 1
  }
  TREASURY_SAGE_FINGERPRINT="$fingerprint"
  echo "Imported treasury fingerprint $fingerprint"
}

create_treasury_key() {
  local out mnemonic
  echo "Creating a new dedicated treasury key (24-word mnemonic)…"
  out="$(sage_rpc generate_mnemonic '{"use_24_words":true}')"
  mnemonic="$(printf '%s\n' "$out" | json_field mnemonic)" || {
    echo "generate_mnemonic failed: $out" >&2
    return 1
  }
  echo
  echo "WRITE THIS TREASURY MNEMONIC DOWN. It is not stored again:"
  echo "$mnemonic"
  echo
  import_treasury_key "$mnemonic"
}

login_treasury_key() {
  local fingerprint="$1"
  if ! is_u32_fingerprint "$fingerprint"; then
    echo "TREASURY_SAGE_FINGERPRINT must be the integer Sage returns after import, not the 64-char secret key." >&2
    return 1
  fi
  echo "Logging Sage RPC into fingerprint $fingerprint"
  sage_rpc login "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"fingerprint": int(sys.argv[1])}))' "$fingerprint")"
}

start_sage_rpc() {
  local src="$INSTALL_ROOT/deploy/aws-ec2/dat-poker-sage-rpc.service"
  local start_src="$INSTALL_ROOT/deploy/aws-ec2/start-sage-rpc.sh"
  if [[ ! -f "$src" || ! -f "$start_src" ]]; then
    echo "missing Sage RPC unit — redeploy this branch first" >&2
    return 1
  fi
  chmod +x "$start_src"
  cp "$src" /etc/systemd/system/dat-poker-sage-rpc.service
  systemctl daemon-reload
  systemctl enable dat-poker-sage-rpc
  systemctl reset-failed dat-poker-sage-rpc 2>/dev/null || true
  systemctl restart dat-poker-sage-rpc
}

CERT_DIR=""
if CERT_DIR="$(find_certs)"; then
  echo "Found Sage RPC certs in $CERT_DIR"
else
  SAGE_BIN=""
  if SAGE_BIN="$(find_sage_bin)"; then
    echo "Found sage at $SAGE_BIN — starting RPC so it can write certs"
    start_sage_rpc
  elif [[ "${SAGE_INSTALL:-}" == "1" ]]; then
    install_sage_cli
    start_sage_rpc
  else
    echo "Sage RPC is not on this AWS host (no wallet.crt / wallet.key)." >&2
    echo "Treasury HTTP on :4200 cannot build a DAT offer until Sage RPC is here." >&2
    echo >&2
    echo "Install headless Sage, then re-run this script:" >&2
    echo "  sudo SAGE_INSTALL=1 bash $0" >&2
    echo >&2
    echo "That copies the prebuilt sage-cli (do not cargo-compile on this host)." >&2
    echo "After it starts, import the *treasury* key (not the player Sage):" >&2
    echo "  sudo -u ${SAGE_USER} -H sage rpc get_keys '{}'" >&2
    echo "  sudo TREASURY_SAGE_FINGERPRINT=<id> bash $0" >&2
    echo "Fund that key with DAT + a little XCH for fees." >&2
    exit 1
  fi

  ok=0
  for i in $(seq 1 40); do
    if CERT_DIR="$(find_certs)"; then
      ok=1
      break
    fi
    sleep 1
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "Sage RPC started but certs did not appear in ${SAGE_SSL} yet." >&2
    journalctl -u dat-poker-sage-rpc -n 40 --no-pager >&2 || true
    echo "Check: sudo systemctl status dat-poker-sage-rpc" >&2
    exit 1
  fi
  echo "Sage RPC wrote certs in $CERT_DIR"
fi

if find_sage_bin >/dev/null; then
  if ! systemctl is-active --quiet dat-poker-sage-rpc; then
    start_sage_rpc || true
  fi
fi

CLI_TREASURY_PRIVATE_KEY="${TREASURY_SAGE_PRIVATE_KEY:-}"
CLI_TREASURY_MNEMONIC="${TREASURY_SAGE_MNEMONIC:-}"
if [[ -z "${TREASURY_SAGE_FINGERPRINT:-}" ]]; then
  TREASURY_SAGE_FINGERPRINT="$(read_env_kv TREASURY_SAGE_FINGERPRINT)"
fi
if [[ -z "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
  TREASURY_SAGE_PRIVATE_KEY="$(read_env_kv TREASURY_SAGE_PRIVATE_KEY)"
fi
if [[ -z "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
  TREASURY_SAGE_PRIVATE_KEY="$(read_env_kv TREASURY_SAGE_SECRET_KEY)"
fi
if [[ -z "${TREASURY_SAGE_MNEMONIC:-}" ]]; then
  TREASURY_SAGE_MNEMONIC="$(read_env_kv TREASURY_SAGE_MNEMONIC)"
fi
if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]] && looks_like_secret_key "$TREASURY_SAGE_FINGERPRINT"; then
  echo "TREASURY_SAGE_FINGERPRINT is a 64-char spend key, not an integer fingerprint. Moving it to TREASURY_SAGE_PRIVATE_KEY."
  if [[ -z "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
    TREASURY_SAGE_PRIVATE_KEY="$TREASURY_SAGE_FINGERPRINT"
  fi
  TREASURY_SAGE_FINGERPRINT=""
  set_kv TREASURY_SAGE_PRIVATE_KEY "$TREASURY_SAGE_PRIVATE_KEY"
  set_kv TREASURY_SAGE_FINGERPRINT ""
fi
if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]] && ! is_u32_fingerprint "$TREASURY_SAGE_FINGERPRINT"; then
  echo "Ignoring TREASURY_SAGE_FINGERPRINT (not a Sage integer id)."
  TREASURY_SAGE_FINGERPRINT=""
fi
PREVIOUS_TREASURY_FINGERPRINT=""
if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]] && is_u32_fingerprint "$TREASURY_SAGE_FINGERPRINT"; then
  PREVIOUS_TREASURY_FINGERPRINT="$TREASURY_SAGE_FINGERPRINT"
fi
echo "Sage spend-key env: $(describe_env_secret)"
if [[ "${SAGE_LOAD_KEY:-}" == "1" || -n "${TREASURY_SAGE_PRIVATE_KEY_FILE:-}" ]]; then
  echo "Loading a new treasury spend key (replaces the one Sage is using now)."
  load_or_replace_treasury_secret
elif [[ -z "${TREASURY_SAGE_PRIVATE_KEY:-}" && -z "${TREASURY_SAGE_MNEMONIC:-}" ]]; then
  if [[ "${SAGE_PASTE_KEY:-}" == "1" || -r /dev/tty ]]; then
    paste_treasury_secret
  fi
fi

if find_sage_bin >/dev/null; then
  ensure_sage_rpc_running || true
  imported_treasury_key=0
  skip_import=0
  if [[ "${SAGE_RELEASE_OFFERS:-}" == "1" && "${SAGE_LOAD_KEY:-}" != "1" && "${SAGE_CREATE_KEY:-}" != "1" && "${SAGE_PASTE_KEY:-}" != "1" ]]; then
    skip_import=1
    echo "SAGE_RELEASE_OFFERS: not re-importing the spend key (Sage is already logged in)."
  fi
  if [[ "$skip_import" -eq 0 && -n "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
    if import_treasury_key "$TREASURY_SAGE_PRIVATE_KEY"; then
      imported_treasury_key=1
    elif [[ "${SAGE_RELEASE_OFFERS:-}" == "1" ]]; then
      echo "import_key failed; continuing so leftover offers can still be released."
    else
      echo "import_key failed (do not paste the private key into chat)." >&2
      exit 1
    fi
  elif [[ "$skip_import" -eq 0 && -n "${TREASURY_SAGE_MNEMONIC:-}" ]]; then
    if import_treasury_key "$TREASURY_SAGE_MNEMONIC"; then
      imported_treasury_key=1
    elif [[ "${SAGE_RELEASE_OFFERS:-}" == "1" ]]; then
      echo "import_key failed; continuing so leftover offers can still be released."
    else
      echo "import_key failed (do not paste the private key into chat)." >&2
      exit 1
    fi
  elif [[ "$skip_import" -eq 0 && "${SAGE_CREATE_KEY:-}" == "1" ]]; then
    create_treasury_key
    imported_treasury_key=1
  fi
  if [[ "$imported_treasury_key" -eq 1 && -n "${PREVIOUS_TREASURY_FINGERPRINT:-}" && -n "${TREASURY_SAGE_FINGERPRINT:-}" && "$PREVIOUS_TREASURY_FINGERPRINT" != "$TREASURY_SAGE_FINGERPRINT" ]]; then
    delete_old_treasury_key "$PREVIOUS_TREASURY_FINGERPRINT"
  fi
  if [[ -z "${TREASURY_SAGE_FINGERPRINT:-}" ]]; then
    mapfile -t SAGE_FPS < <(list_fingerprints)
    if [[ "${#SAGE_FPS[@]}" -eq 1 && -n "${SAGE_FPS[0]}" ]]; then
      TREASURY_SAGE_FINGERPRINT="${SAGE_FPS[0]}"
      echo "Using the only Sage key on this host as TREASURY_SAGE_FINGERPRINT=${TREASURY_SAGE_FINGERPRINT}"
    fi
  fi
  if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]]; then
    login_treasury_key "$TREASURY_SAGE_FINGERPRINT" || true
    if ADDR="$(sage_rpc get_wallet_address "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"fingerprint": int(sys.argv[1]), "network_id": sys.argv[2]}))' "$TREASURY_SAGE_FINGERPRINT" "${TREASURY_NETWORK_ID:-mainnet}")" | json_field address 2>/dev/null)"; then
      echo "Treasury receive address: $ADDR"
      echo "Fund this address with DAT and a little XCH for fees (not the player Sage)."
      if [[ -z "${TREASURY_XCH_ADDRESS:-}" || "${SAGE_LOAD_KEY:-}" == "1" || -n "${TREASURY_SAGE_PRIVATE_KEY_FILE:-}" ]]; then
        TREASURY_XCH_ADDRESS="$ADDR"
      fi
    fi
    echo "Sage sync / coins (DAT is not spendable until these are non-zero):"
    sage_rpc get_sync_status '{}' || true
    DAT_ASSET_ID="${DAT_GOVERNANCE_TOKEN_ASSET_ID:-}"
    if [[ -z "$DAT_ASSET_ID" ]]; then
      DAT_ASSET_ID="$(read_env_kv DAT_GOVERNANCE_TOKEN_ASSET_ID)"
    fi
    if [[ "$DAT_ASSET_ID" =~ ^[0-9a-fA-F]{64}$ ]]; then
      echo "DAT CAT get_token (50000 DAT should be 50000000 mojos after sync):"
      sage_rpc get_token "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"asset_id": sys.argv[1]}))' "$DAT_ASSET_ID")" || true
      sage_rpc get_spendable_coin_count "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"asset_id": sys.argv[1]}))' "$DAT_ASSET_ID")" || true
    else
      echo "DAT_GOVERNANCE_TOKEN_ASSET_ID is not set — Sage cannot select DAT coins."
    fi
    echo "Pending Sage offers (an unused withdraw offer locks DAT until cancelled on-chain):"
    sage_rpc get_offers '{}' || true
    if [[ "${SAGE_RELEASE_OFFERS:-}" == "1" ]]; then
      release_open_sage_offers
      sage_rpc get_offers '{}' || true
      if [[ "$DAT_ASSET_ID" =~ ^[0-9a-fA-F]{64}$ ]]; then
        sage_rpc get_token "$(python3 -c 'import json,sys
sys.stdout.write(json.dumps({"asset_id": sys.argv[1]}))' "$DAT_ASSET_ID")" || true
      fi
    fi
  else
    echo "No treasury spend key on this Sage yet. walletRpcReachable stays false until you import one."
    echo "Load the dedicated treasury private key (do not paste it into chat):"
    echo "  sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh"
    echo "  sudo TREASURY_SAGE_PRIVATE_KEY_FILE=/root/treasury.hex bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh"
    echo "wallet.key in Sage ssl/ is only the RPC TLS cert — it is not this spend key."
  fi
fi

set_kv TREASURY_OFFER_MODE rpc
set_kv TREASURY_WALLET_BACKEND sage
set_kv TREASURY_WALLET_RPC_URL "https://127.0.0.1:9257"
set_kv TREASURY_WALLET_CERT_PATH "${CERT_DIR}/wallet.crt"
set_kv TREASURY_WALLET_KEY_PATH "${CERT_DIR}/wallet.key"
set_kv TREASURY_HOST "127.0.0.1"
set_kv TREASURY_PORT "4200"
set_kv DAT_TREASURY_PAYOUT_URL "http://127.0.0.1:4200/payout"
set_kv DAT_ENABLE_ONCHAIN_WITHDRAW true
# Sage Accept has no fee box. Treasury pays the XCH fee on make_offer.
if ! grep -q '^TREASURY_PAYOUT_FEE_MOJOS=' "$ENV_FILE" || grep -q '^TREASURY_PAYOUT_FEE_MOJOS=0$' "$ENV_FILE"; then
  set_kv TREASURY_PAYOUT_FEE_MOJOS 1000000
fi
if ! grep -q '^DAT_WITHDRAW_FEE_MOJOS=' "$ENV_FILE" || grep -q '^DAT_WITHDRAW_FEE_MOJOS=1000000$' "$ENV_FILE"; then
  set_kv DAT_WITHDRAW_FEE_MOJOS 0
fi
if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]] && is_u32_fingerprint "$TREASURY_SAGE_FINGERPRINT"; then
  set_kv TREASURY_SAGE_FINGERPRINT "$TREASURY_SAGE_FINGERPRINT"
fi
if [[ -n "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
  set_kv TREASURY_SAGE_PRIVATE_KEY "$TREASURY_SAGE_PRIVATE_KEY"
fi
if [[ -n "${TREASURY_SAGE_MNEMONIC:-}" && -z "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
  set_kv TREASURY_SAGE_MNEMONIC "$TREASURY_SAGE_MNEMONIC"
fi
if [[ -n "${TREASURY_XCH_ADDRESS:-}" ]]; then
  set_kv TREASURY_XCH_ADDRESS "$TREASURY_XCH_ADDRESS"
fi
chown "${SAGE_USER}:${SAGE_USER}" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

systemctl reset-failed dat-poker-treasury 2>/dev/null || true
systemctl restart dat-poker-treasury
systemctl restart dat-poker-api

ok=0
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4200/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "Treasury HTTP did not come up after writing Sage cert paths" >&2
  journalctl -u dat-poker-treasury -n 40 --no-pager >&2 || true
  exit 1
fi

echo "Treasury health:"
HEALTH="$(curl -fsS http://127.0.0.1:4200/health)"
printf '%s\n' "$HEALTH"
echo
if printf '%s' "$HEALTH" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("walletRpcReachable") is True else 1)'; then
  echo "walletConfigured and walletRpcReachable are true. Refresh /play and withdraw again."
  echo "Keep DAT + fee XCH on the treasury address. Player Sage is a different key."
else
  echo "walletRpcReachable is still false. Sage has TLS certs but no logged-in spend key." >&2
  echo "Load the dedicated treasury spend key (do not paste it into chat):" >&2
  echo "  sudo bash /opt/dat-poker/deploy/aws-ec2/load-treasury-key.sh" >&2
  exit 1
fi
