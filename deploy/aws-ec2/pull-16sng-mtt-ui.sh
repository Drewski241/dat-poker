#!/bin/bash
# Legacy name — forwards to pull-spirit-slots.sh (Spirit Slots + daily redeem branch).
# sudo bash /opt/dat-poker/deploy/aws-ec2/pull-16sng-mtt-ui.sh
set -euo pipefail
ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
exec bash "$ROOT/deploy/aws-ec2/pull-spirit-slots.sh"
