#!/usr/bin/env bash
# Build the tester image and run it on this EC2 host. One container, port 80.
# Requires DAT_GOVERNANCE_TOKEN_ASSET_ID and DAT_TREASURY_BANKROLL_MOJOS.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DAT_GOVERNANCE_TOKEN_ASSET_ID:-}" || -z "${DAT_TREASURY_BANKROLL_MOJOS:-}" ]]; then
  echo "Set DAT_GOVERNANCE_TOKEN_ASSET_ID (64 hex) and DAT_TREASURY_BANKROLL_MOJOS (CAT mojos, 1000 = 1 DAT)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y docker
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y docker.io
  else
    echo "Docker is not installed and this host has neither dnf nor apt-get." >&2
    exit 1
  fi
  sudo systemctl enable --now docker
fi

if docker info >/dev/null 2>&1; then
  docker=(docker)
else
  docker=(sudo docker)
fi

"${docker[@]}" build -f docker/Dockerfile.api -t dat-poker:test .
"${docker[@]}" rm -f dat-poker >/dev/null 2>&1 || true
"${docker[@]}" run -d --name dat-poker --restart unless-stopped -p 80:4000 \
  -e API_HOST=0.0.0.0 \
  -e API_PORT=4000 \
  -e DAT_ALLOW_DEV_BUYIN="${DAT_ALLOW_DEV_BUYIN:-true}" \
  -e DAT_MIN_BUY_IN_MOJOS="${DAT_MIN_BUY_IN_MOJOS:-1000000}" \
  -e DAT_GOVERNANCE_TOKEN_ASSET_ID="$DAT_GOVERNANCE_TOKEN_ASSET_ID" \
  -e DAT_TREASURY_PAYOUT_URL= \
  -e DAT_TREASURY_BANKROLL_MOJOS="$DAT_TREASURY_BANKROLL_MOJOS" \
  -e DAT_WITHDRAW_PAYOUT_MODE=net \
  -e CHIA_NETWORK="${CHIA_NETWORK:-mainnet}" \
  -e CHIA_GAMING_LOBBY_URL="${CHIA_GAMING_LOBBY_URL:-http://localhost:3001}" \
  -e CHIA_GAMING_GAME_URL="${CHIA_GAMING_GAME_URL:-http://localhost:3000}" \
  -e COINSET_URL="${COINSET_URL:-https://coinset.org}" \
  dat-poker:test

echo "DAT Poker is on port 80. House bankroll ${DAT_TREASURY_BANKROLL_MOJOS} mojos."
