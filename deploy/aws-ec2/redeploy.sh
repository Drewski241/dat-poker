#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux beta host.
# Run as root in Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
# Always starts dat-poker-treasury with the website (127.0.0.1:4200).
set -euxo pipefail
echo "=== DAT POKER redeploy.sh (git pull + rebuild). Wait for: beta redeploy ok ==="

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
WEB_ROOT="${WEB_ROOT:-/usr/share/nginx/html}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/.env}"
REPO_REF="${DAT_POKER_REPO_REF:-main}"

set_env_kv() {
  local key="$1" val="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

cd "$INSTALL_ROOT"
export CI=true
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
export VITE_APP_STAGE="${DAT_POKER_STAGE:-beta}"

# bash already loaded this file. After checkout, re-exec so health checks
# and Caddy/nginx handling come from the fetched script, not the old one.
if [[ "${DAT_POKER_REDEPLOY_REEXEC:-}" != "1" ]]; then
  git fetch --depth 1 origin "$REPO_REF"
  git -c advice.detachedHead=false checkout -f FETCH_HEAD
  export DAT_POKER_REDEPLOY_REEXEC=1
  exec bash "$INSTALL_ROOT/deploy/aws-ec2/redeploy.sh"
fi

corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @dat-poker/api^... build
pnpm --filter @dat-poker/api build
pnpm --filter @dat-poker/treasury-payout^... build
pnpm --filter @dat-poker/treasury-payout build
pnpm --filter @dat-poker/web build

rm -rf "${WEB_ROOT:?}/"*
cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
chown -R ec2-user:ec2-user "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT/data/feedback"
if [[ ! -f "$INSTALL_ROOT/data/accounts.json" ]]; then
  printf '%s\n' '{"users":[]}' > "$INSTALL_ROOT/data/accounts.json"
  chmod 600 "$INSTALL_ROOT/data/accounts.json"
fi
if [[ ! -f "$INSTALL_ROOT/data/ledger.json" ]]; then
  printf '%s\n' '{"balances":[],"redeemed":[]}' > "$INSTALL_ROOT/data/ledger.json"
  chmod 600 "$INSTALL_ROOT/data/ledger.json"
fi
chown -R ec2-user:ec2-user "$INSTALL_ROOT/data"
set_env_kv DAT_TREASURY_PAYOUT_URL "http://127.0.0.1:4200/payout"
set_env_kv DAT_ENABLE_ONCHAIN_WITHDRAW true
set_env_kv TREASURY_HOST "127.0.0.1"
set_env_kv TREASURY_PORT "4200"
if [[ -f "$ENV_FILE" ]] && { ! grep -q '^TREASURY_PAYOUT_FEE_MOJOS=' "$ENV_FILE" || grep -qE '^TREASURY_PAYOUT_FEE_MOJOS=(0|1000000)$' "$ENV_FILE"; }; then
  set_env_kv TREASURY_PAYOUT_FEE_MOJOS 9000000
fi
if [[ -f "$ENV_FILE" ]] && { ! grep -q '^DAT_WITHDRAW_FEE_MOJOS=' "$ENV_FILE" || grep -q '^DAT_WITHDRAW_FEE_MOJOS=1000000$' "$ENV_FILE"; }; then
  set_env_kv DAT_WITHDRAW_FEE_MOJOS 0
fi
if [[ -f "$ENV_FILE" ]]; then
  chown ec2-user:ec2-user "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi
cp "$INSTALL_ROOT/deploy/aws-ec2/dat-poker-treasury.service" /etc/systemd/system/dat-poker-treasury.service
systemctl daemon-reload
systemctl enable dat-poker-treasury
systemctl reset-failed dat-poker-treasury 2>/dev/null || true
systemctl restart dat-poker-treasury
systemctl reset-failed dat-poker-api 2>/dev/null || true
systemctl restart dat-poker-api
# Parse KEY=VALUE; do not `source` caddy.env. An unquoted
# DAT_POKER_SITE=host, www.host is an assignment plus a command, and
# `set -e` would abort after the API restart.
CADDY_SITE=""
if [[ -f /etc/caddy/caddy.env ]]; then
  CADDY_SITE="$(sed -n 's/^DAT_POKER_SITE=//p' /etc/caddy/caddy.env | tail -n1 || true)"
  CADDY_SITE="${CADDY_SITE#\"}"
  CADDY_SITE="${CADDY_SITE%\"}"
  CADDY_SITE="${CADDY_SITE#\'}"
  CADDY_SITE="${CADDY_SITE%\'}"
fi
if [[ -n "${CADDY_SITE:-}" && -f "$INSTALL_ROOT/deploy/aws-ec2/Caddyfile" ]]; then
  cp "$INSTALL_ROOT/deploy/aws-ec2/Caddyfile" /etc/caddy/Caddyfile
  sed -i "s|{\$DAT_POKER_SITE}|${CADDY_SITE}|g" /etc/caddy/Caddyfile
  chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || true
fi
if systemctl is-active --quiet caddy; then
  /usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
    || systemctl reload caddy || true
elif command -v nginx >/dev/null 2>&1; then
  nginx -s reload || systemctl reload nginx || true
fi

ok=0
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "API healthy after ${i}s at :4000/health"
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "API did not become healthy within 30s" >&2
  systemctl status dat-poker-api --no-pager >&2 || true
  journalctl -u dat-poker-api -n 80 --no-pager >&2 || true
  exit 1
fi
ok=0
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4200/health >/dev/null 2>&1; then
    echo "Treasury healthy after ${i}s at :4200/health"
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "Treasury did not become healthy within 30s" >&2
  systemctl status dat-poker-treasury --no-pager >&2 || true
  journalctl -u dat-poker-treasury -n 80 --no-pager >&2 || true
  exit 1
fi
echo "beta redeploy ok"
