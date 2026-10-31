#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="${VITE_API_URL:-https://datspiritpoker.com}"
WEB_ROOT="${WEB_ROOT:-/var/www/datspiritpoker}"
SERVICE_NAME="${API_SERVICE:-dat-poker-api}"

echo "==> Pull latest"
git pull --ff-only

echo "==> Install & build"
corepack enable
pnpm install
pnpm build

echo "==> Build web (VITE_API_URL=$API_URL)"
VITE_API_URL="$API_URL" pnpm --filter @dat-poker/web build

echo "==> Publish static site to $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete apps/web/dist/ "$WEB_ROOT/"

echo "==> Restart API ($SERVICE_NAME)"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  sudo systemctl restart "$SERVICE_NAME"
else
  echo "Service $SERVICE_NAME not found — start manually (see docs/DEPLOY_EC2.md)"
fi

echo "==> Done"
