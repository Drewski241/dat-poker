#!/bin/bash
# Write WalletConnect + DAT CAT settings on the game host and restart the API.
# Player Sage stays on your phone/PC. Do not put treasury keys on this machine.
#
#   sudo WALLETCONNECT_PROJECT_ID=... DAT_GOVERNANCE_TOKEN_ASSET_ID=... \
#     bash /opt/dat-poker/deploy/aws-ec2/enable-sage.sh
#
# Optional: DAT_MIN_BUY_IN_MOJOS=1000  (1 DAT) if you funded less than 1000 DAT.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/.env}"
PROJECT_ID="${WALLETCONNECT_PROJECT_ID:-}"
ASSET_ID="${DAT_GOVERNANCE_TOKEN_ASSET_ID:-}"
MIN_BUY="${DAT_MIN_BUY_IN_MOJOS:-}"

if [[ -z "$PROJECT_ID" || -z "$ASSET_ID" ]]; then
  echo "Set WALLETCONNECT_PROJECT_ID and DAT_GOVERNANCE_TOKEN_ASSET_ID" >&2
  echo "See docs/BETA.md (Sage + WalletConnect)." >&2
  exit 1
fi

if [[ ! "$ASSET_ID" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "DAT_GOVERNANCE_TOKEN_ASSET_ID must be 64 hex characters" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — run bootstrap first" >&2
  exit 1
fi

set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# Do not trace secrets.
set_kv WALLETCONNECT_PROJECT_ID "$PROJECT_ID"
set_kv DAT_GOVERNANCE_TOKEN_ASSET_ID "$ASSET_ID"
if [[ -n "$MIN_BUY" ]]; then
  set_kv DAT_MIN_BUY_IN_MOJOS "$MIN_BUY"
fi
# Keep dev buy-in so the table still works if Sage pairing fails.
if ! grep -q '^DAT_ALLOW_DEV_BUYIN=' "$ENV_FILE"; then
  echo 'DAT_ALLOW_DEV_BUYIN=true' >> "$ENV_FILE"
fi

chown ec2-user:ec2-user "$ENV_FILE"
chmod 0640 "$ENV_FILE"

systemctl restart dat-poker-api

ok=0
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "API did not become healthy after Sage env update" >&2
  journalctl -u dat-poker-api -n 50 --no-pager >&2 || true
  exit 1
fi

curl -fsS http://127.0.0.1:4000/v1/wallet/status
echo
echo "Sage env applied. Open the HTTPS bookmark, Connect Sage, then Load DAT balance."
echo "Buy-in is a signed message + balance check — DAT does not leave Sage until escrow is wired."
