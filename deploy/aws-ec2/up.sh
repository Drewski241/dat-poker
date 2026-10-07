#!/bin/bash
# Update DAT POKER on an existing host (works even if redeploy.sh is missing locally).
# Phone / Session Manager: run short commands in docs/BETA.md § "Update from your phone".
set -euxo pipefail

REF="${DAT_POKER_REPO_REF:-cursor/phone-friendly-aws-redeploy-debb}"
ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
GITHUB_RAW="https://raw.githubusercontent.com/Drewski241/dat-poker"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "No git repo at $ROOT."
  echo "This box was never bootstrapped with DAT POKER user-data."
  echo "Use a desktop browser to paste console-user-data.sh on a new EC2 launch (see docs/BETA.md)."
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
