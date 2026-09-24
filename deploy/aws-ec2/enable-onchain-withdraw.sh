#!/bin/bash
# Point the game API at a running treasury payout service so testers can
# withdraw unlocked DAT to a *player* Sage wallet (import the offer).
# Do not put treasury Sage keys on this machine.
#
#   sudo DAT_TREASURY_PAYOUT_URL=http://TREASURY_HOST:4200/payout \
#        TREASURY_XCH_ADDRESS=xch1treasury… \
#        bash /opt/dat-poker/deploy/aws-ec2/enable-onchain-withdraw.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/.env}"
PAYOUT_URL="${DAT_TREASURY_PAYOUT_URL:-}"
TREASURY_ADDR="${TREASURY_XCH_ADDRESS:-}"

if [[ -z "$PAYOUT_URL" ]]; then
  echo "Set DAT_TREASURY_PAYOUT_URL (example http://10.0.0.50:4200/payout)" >&2
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

set_kv DAT_TREASURY_PAYOUT_URL "$PAYOUT_URL"
set_kv DAT_ENABLE_ONCHAIN_WITHDRAW true
if [[ -n "$TREASURY_ADDR" ]]; then
  set_kv TREASURY_XCH_ADDRESS "$TREASURY_ADDR"
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
  echo "API did not become healthy after on-chain withdraw env update" >&2
  journalctl -u dat-poker-api -n 50 --no-pager >&2 || true
  exit 1
fi

echo "On-chain withdraw enabled. Treasury Sage must be running on the payout host."
echo "Player test: link a *player* Sage address, withdraw unlocked DAT, import the offer in that Sage."
curl -fsS http://127.0.0.1:4000/v1/wallet/status
echo
