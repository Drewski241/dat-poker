#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux host.
# Run as root: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
set -euxo pipefail
echo "=== DAT POKER redeploy.sh (git pull + rebuild). Wait for: beta redeploy ok ==="

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
if [[ -z "${WEB_ROOT:-}" ]]; then
  if [[ -d /usr/share/nginx/html ]]; then
    WEB_ROOT="/usr/share/nginx/html"
  elif [[ -d /var/www/html ]]; then
    WEB_ROOT="/var/www/html"
  else
    WEB_ROOT="/usr/share/nginx/html"
  fi
fi
REPO_REF="${DAT_POKER_REPO_REF:-cursor/hybrid-dat-chia-gaming-3c03}"

cd "$INSTALL_ROOT"
ENV_FILE="$INSTALL_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^DAT_POKER_REPO_REF=' "$ENV_FILE"; then
    sed -i "s|^DAT_POKER_REPO_REF=.*|DAT_POKER_REPO_REF=${REPO_REF}|" "$ENV_FILE"
  else
    echo "DAT_POKER_REPO_REF=${REPO_REF}" >> "$ENV_FILE"
  fi
  if [[ -n "${DAT_TREASURY_BANKROLL_MOJOS:-}" ]]; then
    if grep -q '^DAT_TREASURY_BANKROLL_MOJOS=' "$ENV_FILE"; then
      sed -i "s|^DAT_TREASURY_BANKROLL_MOJOS=.*|DAT_TREASURY_BANKROLL_MOJOS=${DAT_TREASURY_BANKROLL_MOJOS}|" "$ENV_FILE"
    else
      echo "DAT_TREASURY_BANKROLL_MOJOS=${DAT_TREASURY_BANKROLL_MOJOS}" >> "$ENV_FILE"
    fi
  fi
fi
export DAT_POKER_REPO_REF="$REPO_REF"
export CI=true
export DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}"

# bash already loaded this file. After checkout, re-exec so the rebuild
# comes from the fetched script, not the old one.
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
pnpm --filter @dat-poker/web build

mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}/"*
cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
echo "Web build $(git rev-parse --short HEAD) → ${WEB_ROOT}"

if id ec2-user >/dev/null 2>&1; then
  chown -R ec2-user:ec2-user "$INSTALL_ROOT"
fi

systemctl reset-failed dat-poker-api 2>/dev/null || true
systemctl restart dat-poker-api

if systemctl is-active --quiet caddy; then
  systemctl reload caddy || true
elif command -v nginx >/dev/null 2>&1; then
  nginx -s reload || systemctl reload nginx || true
fi

ok=0
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
    echo "API healthy after ${i}s at :4000/health"
    curl -fsS http://127.0.0.1:4000/health || true
    echo
    curl -fsS http://127.0.0.1:4000/v1/treasury/house || true
    echo
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
echo "beta redeploy ok"
