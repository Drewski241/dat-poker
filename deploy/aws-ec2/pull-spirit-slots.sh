#!/bin/bash
# Session Manager: deploy Spirit Slots + shared play session (poker + /slots).
# sudo bash /opt/dat-poker/deploy/aws-ec2/pull-spirit-slots.sh
set -euo pipefail
export DAT_POKER_REPO_REF="${DAT_POKER_REPO_REF:-cursor/fix-stampede-bigint-payout-6e1e}"
export INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
exec bash "$INSTALL_ROOT/deploy/aws-ec2/up.sh"
