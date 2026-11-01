#!/bin/bash
# Paste on EC2 when /opt/dat-poker has no pull-spirit-slots.sh yet.
# sudo bash -c 'curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/cursor/spirit-slots-game-4501/deploy/aws-ec2/bootstrap-spirit-slots-from-github.sh" | bash'
set -euo pipefail
export DAT_POKER_REPO_REF="${DAT_POKER_REPO_REF:-cursor/spirit-slots-game-4501}"
export INSTALL_ROOT="${INSTALL_ROOT:-/opt/dat-poker}"
curl -fsSL "https://raw.githubusercontent.com/Drewski241/dat-poker/${DAT_POKER_REPO_REF}/deploy/aws-ec2/up.sh" | bash
