#!/bin/bash
# Start the treasury payout service on this host at 127.0.0.1:4200 and point
# the game API at it. Treasury Sage must be open on THIS machine with RPC on
# :9257 (Settings → Advanced). Do not expose :4200 or :9257 publicly.
#
#   sudo bash /opt/dat-poker/deploy/aws-ec2/start-treasury.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/.env}"
UNIT_SRC="$INSTALL_ROOT/deploy/aws-ec2/dat-poker-treasury.service"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — run bootstrap first" >&2
  exit 1
fi
if [[ ! -f "$UNIT_SRC" ]]; then
  echo "missing $UNIT_SRC" >&2
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

export CI=true
cd "$INSTALL_ROOT"
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --filter @dat-poker/treasury-payout^... build
pnpm --filter @dat-poker/treasury-payout build

set_kv DAT_TREASURY_PAYOUT_URL "http://127.0.0.1:4200/payout"
set_kv DAT_ENABLE_ONCHAIN_WITHDRAW true
set_kv TREASURY_HOST "127.0.0.1"
set_kv TREASURY_PORT "4200"
chown ec2-user:ec2-user "$ENV_FILE"
chmod 0640 "$ENV_FILE"

cp "$UNIT_SRC" /etc/systemd/system/dat-poker-treasury.service
systemctl daemon-reload
systemctl enable dat-poker-treasury
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
  echo "Treasury HTTP did not come up on 127.0.0.1:4200" >&2
  journalctl -u dat-poker-treasury -n 50 --no-pager >&2 || true
  exit 1
fi

echo "Treasury payout is listening on 127.0.0.1:4200"
curl -fsS http://127.0.0.1:4200/health
echo
curl -fsS http://127.0.0.1:4000/v1/wallet/status
echo
echo "Open the play page and click Check treasury again."
echo "If walletRpcReachable is false: open Sage on this host, enable RPC :9257, set TREASURY_SAGE_FINGERPRINT, restart treasury."
