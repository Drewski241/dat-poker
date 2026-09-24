#!/bin/bash
# Wire Sage RPC on the AWS website host so treasury can build real DAT offers.
# Treasury HTTP can be up while wallet.crt is missing — that is this 400.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_FINGERPRINT=1234567890 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_CREATE_KEY=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_PRIVATE_KEY=hex_or_secret bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo TREASURY_SAGE_MNEMONIC='word word …' bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
#   sudo SAGE_INSTALL=1 bash /opt/dat-poker/deploy/aws-ec2/enable-treasury-sage.sh
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
path, key = Path(sys.argv[1]), sys.argv[2]
if not path.exists():
    raise SystemExit(0)
for line in path.read_text().splitlines():
    if line.startswith(key + "="):
        print(line.split("=", 1)[1], end="")
        break
' "$ENV_FILE" "$1"
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

sage_rpc() {
  local method="$1" body="${2:-{}}"
  local bin
  bin="$(find_sage_bin)" || {
    echo "sage-cli is not installed" >&2
    return 1
  }
  sudo -u "$SAGE_USER" -H "$bin" rpc "$method" "$body"
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
  local out fingerprint
  echo "Importing dedicated treasury spend key from env into Sage RPC…"
  out="$(sage_rpc import_key "$(python3 -c 'import json,sys; print(json.dumps({"name":"treasury","key":sys.argv[1],"save_secrets":True,"login":True}))' "$secret")")"
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
  echo "Logging Sage RPC into fingerprint $fingerprint"
  sage_rpc login "{\"fingerprint\": ${fingerprint}}"
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

if [[ -z "${TREASURY_SAGE_FINGERPRINT:-}" ]]; then
  TREASURY_SAGE_FINGERPRINT="$(read_env_kv TREASURY_SAGE_FINGERPRINT)"
fi
if [[ -z "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
  TREASURY_SAGE_PRIVATE_KEY="$(read_env_kv TREASURY_SAGE_PRIVATE_KEY)"
fi
if [[ -z "${TREASURY_SAGE_MNEMONIC:-}" ]]; then
  TREASURY_SAGE_MNEMONIC="$(read_env_kv TREASURY_SAGE_MNEMONIC)"
fi

if find_sage_bin >/dev/null; then
  ensure_sage_rpc_running || true
  if [[ -n "${TREASURY_SAGE_PRIVATE_KEY:-}" ]]; then
    import_treasury_key "$TREASURY_SAGE_PRIVATE_KEY"
  elif [[ -n "${TREASURY_SAGE_MNEMONIC:-}" ]]; then
    import_treasury_key "$TREASURY_SAGE_MNEMONIC"
  elif [[ "${SAGE_CREATE_KEY:-}" == "1" ]]; then
    create_treasury_key
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
    if ADDR="$(sage_rpc get_wallet_address "{\"fingerprint\": ${TREASURY_SAGE_FINGERPRINT}, \"network_id\": \"${TREASURY_NETWORK_ID:-mainnet}\"}" | json_field address 2>/dev/null)"; then
      echo "Treasury receive address: $ADDR"
      echo "Fund this address with DAT and a little XCH for fees (not the player Sage)."
      if [[ -z "${TREASURY_XCH_ADDRESS:-}" ]]; then
        TREASURY_XCH_ADDRESS="$ADDR"
      fi
    fi
  else
    echo "No treasury spend key on this Sage yet. walletRpcReachable stays false until you import one."
    echo "Put the dedicated treasury private key or mnemonic in $ENV_FILE:"
    echo "  TREASURY_SAGE_PRIVATE_KEY=your_hex_or_bech32_secret"
    echo "  # or TREASURY_SAGE_MNEMONIC=word word …"
    echo "Then: sudo bash $0"
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
if [[ -n "${TREASURY_SAGE_FINGERPRINT:-}" ]]; then
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
  echo "Add TREASURY_SAGE_PRIVATE_KEY or TREASURY_SAGE_MNEMONIC to $ENV_FILE, then:" >&2
  echo "  sudo bash $0" >&2
  exit 1
fi
