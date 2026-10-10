#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux beta host.
# Run as root in Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
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
REPO_REF="${DAT_POKER_REPO_REF:-cursor/fix-final-table-deal-stuck-7c36}"

cd "$INSTALL_ROOT"
ENV_FILE="$INSTALL_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  grep -q '^DAT_POKER_STAGE=' "$ENV_FILE" || echo 'DAT_POKER_STAGE=beta' >> "$ENV_FILE"
  grep -q '^DAT_MTT_FIELD_SIZE=' "$ENV_FILE" || echo 'DAT_MTT_FIELD_SIZE=500' >> "$ENV_FILE"
  grep -q '^DAT_MTT500_NFT_REWARD_ID=' "$ENV_FILE" || \
    echo 'DAT_MTT500_NFT_REWARD_ID=nft1vg5alplpueqgmrq5t4nuy0gemyn2zu43l9g9udz2jz60e6m45ncq76dsnc' >> "$ENV_FILE"
  grep -q '^DAT_MTT500_NFT_WINS_REQUIRED=' "$ENV_FILE" || echo 'DAT_MTT500_NFT_WINS_REQUIRED=5' >> "$ENV_FILE"
  grep -q '^DAT_HAND_HISTORY_PATH=' "$ENV_FILE" || \
    echo 'DAT_HAND_HISTORY_PATH=/opt/dat-poker/data/hand-history.jsonl' >> "$ENV_FILE"
  if grep -q '^DAT_POKER_REPO_REF=' "$ENV_FILE"; then
    sed -i "s|^DAT_POKER_REPO_REF=.*|DAT_POKER_REPO_REF=${REPO_REF}|" "$ENV_FILE"
  else
    echo "DAT_POKER_REPO_REF=${REPO_REF}" >> "$ENV_FILE"
  fi
fi
export DAT_POKER_REPO_REF="$REPO_REF"
export CI=true
export DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"
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
export VITE_BUILD_ID="$(git rev-parse --short HEAD)"
export VITE_APP_STAGE="${DAT_POKER_STAGE:-beta}"
pnpm --filter @dat-poker/web build

rm -rf "${WEB_ROOT:?}/"*
cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
if grep -rq "16-player MTT" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: lobby still mislabels 16-player as MTT — fetch a newer branch" >&2
  exit 1
fi
if ! grep -rq "join-mtt16" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: join-mtt16 client missing from web dist" >&2
  exit 1
fi
if ! grep -rq "Join tournament" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: expected large-MTT Join tournament CTA missing from web dist" >&2
  exit 1
fi
echo "Web build ${VITE_BUILD_ID} → ${WEB_ROOT} (16-player SNG + large MTT lobby OK)"
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
    curl -fsS http://127.0.0.1:4000/health | head -c 400 || true
    echo
    curl -fsS http://127.0.0.1:4000/v1/lobby/mtt500-nft-promo 2>/dev/null | head -c 200 || true
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
