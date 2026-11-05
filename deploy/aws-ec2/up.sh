#!/bin/bash
# Update DAT POKER on an existing host (works even if redeploy.sh is missing locally).
# Session Manager:
#   sudo bash -c 'export DAT_POKER_REPO_REF=cursor/hybrid-dat-chia-gaming-3c03; curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/hybrid-dat-chia-gaming-3c03/deploy/aws-ec2/up.sh" | bash'
set -euxo pipefail

REF="${DAT_POKER_REPO_REF:-cursor/hybrid-dat-chia-gaming-3c03}"
ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
GITHUB_RAW="https://raw.githubusercontent.com/Drewski241/dat-poker"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "No git repo at $ROOT."
  echo "This box was never bootstrapped with DAT POKER user-data."
  exit 1
fi

cd "$ROOT"
git fetch --depth 1 origin "$REF"
git checkout -f FETCH_HEAD

export DAT_POKER_REPO_REF="$REF"
export DAT_POKER_STAGE="${DAT_POKER_STAGE:-beta}"

if [[ -f "$ROOT/deploy/aws-ec2/redeploy.sh" ]]; then
  export DAT_POKER_REDEPLOY_REEXEC=1
  exec bash "$ROOT/deploy/aws-ec2/redeploy.sh"
fi

echo "Local redeploy.sh missing; running from GitHub at $REF"
curl -fsSL "$GITHUB_RAW/$REF/deploy/aws-ec2/redeploy.sh" | bash
