#!/bin/bash
# Rebuild DAT POKER on an existing Amazon Linux beta host.
# Run as root in Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/redeploy.sh
set -euxo pipefail

INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
WEB_ROOT="${WEB_ROOT:-/usr/share/nginx/html}"
REPO_REF="${DAT_POKER_REPO_REF:-main}"

cd "$INSTALL_ROOT"
export CI=true
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
export VITE_APP_STAGE="${DAT_POKER_STAGE:-beta}"

git fetch --depth 1 origin "$REPO_REF"
git checkout -f FETCH_HEAD

corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @dat-poker/api^... build
pnpm --filter @dat-poker/api build
pnpm --filter @dat-poker/web build

rm -rf "${WEB_ROOT:?}/"*
cp -a "$INSTALL_ROOT/apps/web/dist/." "$WEB_ROOT/"
chown -R ec2-user:ec2-user "$INSTALL_ROOT"
systemctl restart dat-poker-api
nginx -s reload || systemctl reload nginx
curl -fsS http://127.0.0.1/health
echo "beta redeploy ok"
