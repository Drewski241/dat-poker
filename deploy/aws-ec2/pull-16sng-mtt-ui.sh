#!/bin/bash
# Session Manager: sudo bash /opt/dat-poker/deploy/aws-ec2/pull-16sng-mtt-ui.sh
# If that path is missing, run the curl line in deploy/aws-ec2/DEPLOY.md § "Quick redeploy".
set -euo pipefail
export DAT_POKER_REPO_REF="${DAT_POKER_REPO_REF:-cursor/hand-history-pot-audit-423d}"
ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
SCRIPT="$ROOT/deploy/aws-ec2/redeploy.sh"
if [[ -x "$SCRIPT" ]] || [[ -f "$SCRIPT" ]]; then
  exec bash "$SCRIPT"
fi
exec bash "$ROOT/deploy/aws-ec2/up.sh"
