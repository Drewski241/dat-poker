#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux beta host.
# Run as root in Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
set -euxo pipefail
echo "=== DAT POKER redeploy.sh (git pull + rebuild). Wait for: beta redeploy ok ==="

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
WEB_ROOT="${WEB_ROOT:-/usr/share/nginx/html}"
REPO_REF="${DAT_POKER_REPO_REF:-main}"

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
systemctl restart dat-poker-api
if [[ -f /etc/caddy/caddy.env && -f "$INSTALL_ROOT/deploy/aws-ec2/Caddyfile" ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/caddy/caddy.env
  set +a
  if [[ -n "${DAT_POKER_SITE:-}" ]]; then
    cp "$INSTALL_ROOT/deploy/aws-ec2/Caddyfile" /etc/caddy/Caddyfile
    sed -i "s|{\$DAT_POKER_SITE}|${DAT_POKER_SITE}|g" /etc/caddy/Caddyfile
    chown root:caddy /etc/caddy/Caddyfile 2>/dev/null || true
  fi
fi
if systemctl is-active --quiet caddy; then
  /usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
    || systemctl reload caddy
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
echo "beta redeploy ok"
