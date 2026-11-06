#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux beta host.
# Run as root in Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
set -euxo pipefail
echo "=== DAT POKER redeploy.sh (git pull + rebuild). Wait for: beta redeploy ok ==="
# A failed chia-rs source build can fill the disk before this script is reached.
echo "Clearing the failed chia-rs compile cache"
rm -rf /tmp/pip-* /tmp/tmp.* \
  /home/ec2-user/.cache/pip \
  /home/ec2-user/.cache/puccinialin \
  /home/ec2-user/.cargo \
  /home/ec2-user/.rustup \
  /root/.cache/pip \
  /root/.cache/puccinialin
df -h / /tmp || true

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
REPO_REF="${DAT_POKER_REPO_REF:-cursor/cat-channel-heads-up-11a7}"

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
  grep -q '^DAT_DAILY_REDEEM_MOJOS=' "$ENV_FILE" || echo 'DAT_DAILY_REDEEM_MOJOS=5000000' >> "$ENV_FILE"
  if [[ "${DAT_TREASURY_BANKROLL_MOJOS:-}" =~ ^[0-9]+$ ]]; then
    if grep -q '^DAT_TREASURY_BANKROLL_MOJOS=' "$ENV_FILE"; then
      sed -i "s|^DAT_TREASURY_BANKROLL_MOJOS=.*|DAT_TREASURY_BANKROLL_MOJOS=${DAT_TREASURY_BANKROLL_MOJOS}|" "$ENV_FILE"
    else
      echo "DAT_TREASURY_BANKROLL_MOJOS=${DAT_TREASURY_BANKROLL_MOJOS}" >> "$ENV_FILE"
    fi
  fi
  upsert_env_line() {
    local key="$1"
    local value="$2"
    local tmp
    tmp="$(mktemp)"
    if grep -q "^${key}=" "$ENV_FILE"; then
      grep -v "^${key}=" "$ENV_FILE" > "$tmp"
      printf '%s=%s\n' "$key" "$value" >> "$tmp"
      mv "$tmp" "$ENV_FILE"
    else
      rm -f "$tmp"
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }
  if [[ -n "${CHIA_CLOUD_WALLET_CLIENT_ID:-}" ]]; then
    upsert_env_line CHIA_CLOUD_WALLET_CLIENT_ID "$CHIA_CLOUD_WALLET_CLIENT_ID"
  fi
  if [[ -n "${CHIA_CLOUD_WALLET_REDIRECT_URI:-}" ]]; then
    upsert_env_line CHIA_CLOUD_WALLET_REDIRECT_URI "$CHIA_CLOUD_WALLET_REDIRECT_URI"
  fi
  if [[ -n "${CHIA_CLOUD_WALLET_CLIENT_SECRET:-}" ]]; then
    upsert_env_line CHIA_CLOUD_WALLET_CLIENT_SECRET "$CHIA_CLOUD_WALLET_CLIENT_SECRET"
  fi
  grep -q '^DAT_SPIN_COST_MOJOS=' "$ENV_FILE" || echo 'DAT_SPIN_COST_MOJOS=1000' >> "$ENV_FILE"
  upsert_env_line DAT_CAT_CHANNEL_TEST true
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
if ! grep -q paylineBaseSymbol "$INSTALL_ROOT/packages/slot-engine/dist/slot-engine.js" 2>/dev/null; then
  echo "ERROR: slot-engine dist missing paylineBaseSymbol (stale Spirit Slots math)" >&2
  exit 1
fi
# Puzzle prove needs the pure-Python clvm package plus a prebuilt chia-rs wheel.
# Python 3.9 on this host has no wheel for current chia-rs, so pin the last
# release that ships a cp39 manylinux wheel and refuse a source build.
if ! sudo -u ec2-user -H python3 -c 'import clvm, chia_rs' >/dev/null 2>&1; then
  dnf install -y python3-pip || yum install -y python3-pip
  sudo -u ec2-user -H python3 -m pip install --user --upgrade 'pip>=23'
  sudo -u ec2-user -H python3 -m pip install --user --only-binary=:all: \
    'clvm==0.9.15' 'chia-rs==0.34.0'
fi
export VITE_BUILD_ID="$(git rev-parse --short HEAD)"
export VITE_APP_STAGE="${DAT_POKER_STAGE:-beta}"
pnpm --filter @dat-poker/web build

rm -rf "${WEB_ROOT:?}/"*
cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
if ! grep -rq "Spirit Slots" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: Spirit Slots UI missing from web dist" >&2
  exit 1
fi
if ! grep -rq "/v1/slots/spin" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: /v1/slots/spin client missing from web dist" >&2
  exit 1
fi
if ! grep -rq "redeem-daily" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: daily play redeem client missing from web dist" >&2
  exit 1
fi
if ! grep -rq "Create account" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: account login UI missing from web dist (expected trust-rails AuthPanel)" >&2
  exit 1
fi
if ! grep -rq "Choose your game" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: post-login game chooser missing from web dist" >&2
  exit 1
fi
if ! grep -rq "Play heads-up DAT channel" "$WEB_ROOT" 2>/dev/null; then
  echo "ERROR: heads-up DAT channel UI missing from web dist" >&2
  exit 1
fi
echo "Web build ${VITE_BUILD_ID} → ${WEB_ROOT} (sign-in + play page + heads-up DAT channel OK)"
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
# Progressive jackpot persists in slots-jackpot.json (created on first spin if missing).
chown -R ec2-user:ec2-user "$INSTALL_ROOT/data"
if [[ -f "$INSTALL_ROOT/deploy/aws-ec2/dat-poker-api.service" ]]; then
  cp "$INSTALL_ROOT/deploy/aws-ec2/dat-poker-api.service" /etc/systemd/system/dat-poker-api.service
  systemctl daemon-reload
fi
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
    curl -fsS http://127.0.0.1:4000/v1/play/config 2>/dev/null | head -c 200 || true
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
echo "Homepage is sign-in. Play page is /play, including Play heads-up DAT channel."
