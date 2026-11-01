#!/usr/bin/env bash
# Local/dev helper — on EC2 use deploy/aws-ec2/up.sh instead.
set -euo pipefail
echo "On the server, run:"
echo "  sudo bash -c 'export DAT_POKER_REPO_REF=cursor/spirit-slots-game-4501; bash /opt/dat-poker/deploy/aws-ec2/up.sh'"
exit 1
